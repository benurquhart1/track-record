import { NextResponse } from "next/server";
import { cleanTitle, firstArtist } from "@/lib/year";

// Spotify reports the year of the album version playing, so remasters, compilations and reissues
// come out too late. MusicBrainz knows every release by an artist, so the earliest release of this
// song by this artist is the real year. Spotify's year is only a last resort.
//
// Search results are ranked by text match, not date, and big songs have hundreds of versions, so
// rather than trusting a search page we pin down the artist first, then:
//   1. the exact recording Spotify is playing (by ISRC),
//   2. every single the artist released (browsed, not searched) whose title is this song,
//   3. every recording of the song credited to that exact artist.

// A lookup is several MusicBrainz calls a second apart; give it room past the default timeout.
export const maxDuration = 30;

const UA = "track-record/0.3 (private party game; github.com/benurquhart1/track-record)";

type Credit = { name?: string; artist?: { id?: string; name?: string } }[];
type Release = {
  title?: string;
  date?: string;
  status?: string;
  "release-group"?: { "primary-type"?: string; "secondary-types"?: string[] };
};
type Recording = {
  title?: string;
  disambiguation?: string;
  "first-release-date"?: string;
  releases?: Release[];
  "artist-credit"?: Credit;
};
type ReleaseGroup = { title?: string; "first-release-date"?: string };
type Artist = { id: string; name: string; score?: number };
type Found = { from: string; title: string; year: number; release?: string; kind?: string };

function yearOf(date?: string): number | null {
  const y = parseInt((date ?? "").slice(0, 4), 10);
  return y > 1900 ? y : null;
}

const norm = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

const cache = new Map<string, { year: number | null; source: string; matched: string | null }>();

// MusicBrainz allows about one request a second, so every call waits its turn in one queue.
let queue: Promise<unknown> = Promise.resolve();
let lastCall = 0;
const gap = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** null = not found; throws when MusicBrainz couldn't be reached, so a partial answer isn't cached. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mb(path: string): Promise<any | null> {
  const run = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = lastCall + 1100 * (attempt + 1) - Date.now();
      if (wait > 0) await gap(wait);
      lastCall = Date.now();
      try {
        const res = await fetch(`https://musicbrainz.org/ws/2/${path}`, {
          headers: { "User-Agent": UA, Accept: "application/json" },
          signal: AbortSignal.timeout(6000),
          cache: "no-store",
        });
        if (res.ok) return await res.json();
        if (res.status === 404 || res.status === 400) return null;
      } catch {
        // timeout or network error: try again
      }
    }
    throw new Error("MusicBrainz unavailable");
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

/**
 * Years a recording came out, counting only official releases: demos and bootlegs often carry
 * dates from before the song was really released (Mr. Brightside demos show up as 2001).
 */
type Dated = { year: number; release?: string; kind?: string };
function recordingYears(r: Recording): Dated[] {
  if (/\b(demo|rehearsal|outtake)\b/i.test(r.disambiguation ?? "")) return [];
  if (r.releases?.length) {
    return r.releases
      .filter((rel) => !rel.status || rel.status === "Official")
      .map((rel) => {
        const g = rel["release-group"];
        const kind = [g?.["primary-type"], ...(g?.["secondary-types"] ?? [])].filter(Boolean).join("+");
        return { year: yearOf(rel.date) ?? 0, release: rel.title, kind: kind || undefined };
      })
      .filter((d) => d.year > 0);
  }
  const y = yearOf(r["first-release-date"]);
  return y ? [{ year: y }] : [];
}

const lucene = (s: string) => s.replace(/["\\]/g, "");

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const debug = !!q.get("debug");
  const isrc = q.get("isrc");
  const title = cleanTitle(q.get("title") ?? "");
  const artist = firstArtist(q.get("artist") ?? "");
  const spotifyYear = yearOf(q.get("spotifyYear") ?? undefined);
  const songKey = norm(title);

  const key = `${isrc}|${songKey}|${norm(artist)}`;
  const hit = cache.get(key);
  if (hit && !debug) return NextResponse.json(hit);

  const found: Found[] = [];
  const add = (from: string, t: string | undefined, date: string | undefined) => {
    const year = yearOf(date);
    if (year) found.push({ from, title: t ?? "", year });
  };
  const addYears = (from: string, t: string | undefined, dated: Dated[]) => {
    for (const d of dated) found.push({ from, title: t ?? "", ...d });
  };
  // Any step MusicBrainz didn't answer makes the result incomplete: use it, but don't cache it.
  let incomplete = false;
  const ask = (path: string) =>
    mb(path).catch(() => {
      incomplete = true;
      return null;
    });
  // "Good Golly, Miss Molly" matches "Good Golly Miss Molly"; a single "A-side / B-side" matches either side.
  // Bracketed subtitles are ignored too: "Fly Me to the Moon (In Other Words)" is "Fly Me to the Moon".
  const bare = (t: string) => norm(t.replace(/\s*[([][^)\]]*[)\]]/g, ""));
  const sameSong = (t?: string) =>
    !!t &&
    t.split(/\s+\/\s+/).some((part) => norm(cleanTitle(part)) === songKey || bare(part) === bare(title));

  // 1. The exact recording Spotify is playing.
  if (isrc) {
    const data = await ask(`isrc/${encodeURIComponent(isrc)}?fmt=json&inc=releases`);
    for (const r of (data?.recordings ?? []) as Recording[]) addYears("isrc", r.title, recordingYears(r));
  }

  // Pin down the artist: the best-scoring artist whose name matches what Spotify says.
  let artistId: string | null = null;
  if (artist) {
    const data = await ask(`artist?fmt=json&limit=5&query=${encodeURIComponent(`artist:"${lucene(artist)}"`)}`);
    const artists = (data?.artists ?? []) as Artist[];
    artistId = (artists.find((a) => norm(a.name) === norm(artist)) ?? artists[0])?.id ?? null;
  }

  if (artistId && songKey) {
    // 2. Every single by the artist, oldest first, looking for this song's title.
    for (let offset = 0; offset < 200; offset += 100) {
      const data = await ask(`release-group?fmt=json&artist=${artistId}&type=single&limit=100&offset=${offset}`);
      const groups = (data?.["release-groups"] ?? []) as ReleaseGroup[];
      for (const g of groups) if (sameSong(g.title)) add("single", g.title, g["first-release-date"]);
      if (groups.length < 100) break;
    }

    // 3. Every recording of the song credited to this exact artist.
    const query = `recording:"${lucene(title)}" AND arid:${artistId}`;
    for (let offset = 0; offset < 200; offset += 100) {
      const data = await ask(`recording?fmt=json&limit=100&offset=${offset}&query=${encodeURIComponent(query)}`);
      const recs = (data?.recordings ?? []) as Recording[];
      for (const r of recs) if (sameSong(r.title)) addYears("recording", r.title, recordingYears(r));
      if (recs.length < 100 || offset + 100 >= (data?.count ?? 0)) break;
    }
  }

  // The earliest trustworthy year: a single by the artist, or a year at least two releases agree
  // on. One mis-dated compilation shouldn't win (Crazy in Love has a lone "1999" entry), but a
  // lone original single should (What a Wonderful World's 1967 single vs its 1988 re-release).
  const sorted = [...found].sort((a, b) => a.year - b.year);
  const trusted = (f: Found) => f.from === "single" || found.filter((g) => g.year === f.year).length >= 2;
  const first = sorted.find(trusted) ?? sorted[0];
  const year = first?.year ?? null;
  // Very old records often only show up on later compilations (Joseíto Fernández's 1929
  // Guantanamera is only in MusicBrainz from 1997), so flag those for the host to check.
  const onlyCompilations = found.length > 0 && found.every((f) => f.kind?.includes("Compilation"));
  const result = first
    ? { year: first.year, source: onlyCompilations ? "compilation" : "musicbrainz", matched: first.title }
    : { year: spotifyYear, source: spotifyYear ? "spotify" : "none", matched: null };
  if (year && !incomplete) cache.set(key, result);

  if (debug) {
    const earliestFrom = (from: string) => {
      const ys = found.filter((f) => f.from === from).map((f) => f.year);
      return ys.length ? Math.min(...ys) : null;
    };
    return NextResponse.json({
      ...result,
      artistId,
      incomplete,
      earliest: { isrc: earliestFrom("isrc"), single: earliestFrom("single"), recording: earliestFrom("recording") },
      oldest: sorted.slice(0, 8),
    });
  }
  return NextResponse.json(result);
}
