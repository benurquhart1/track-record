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

const UA = "track-record/0.3 (private party game; github.com/benurquhart1/track-record)";

type Credit = { name?: string; artist?: { id?: string; name?: string } }[];
type Recording = { title?: string; "first-release-date"?: string; releases?: { date?: string }[]; "artist-credit"?: Credit };
type ReleaseGroup = { title?: string; "first-release-date"?: string };
type Artist = { id: string; name: string; score?: number };
type Found = { from: string; title: string; year: number };

function yearOf(date?: string): number | null {
  const y = parseInt((date ?? "").slice(0, 4), 10);
  return y > 1900 ? y : null;
}

const norm = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

let lastCall = 0;
const cache = new Map<string, { year: number | null; source: string; matched: string | null }>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mb(path: string): Promise<any | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    // Stay under MusicBrainz's limit of about one request a second.
    const wait = lastCall + 1050 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    try {
      const res = await fetch(`https://musicbrainz.org/ws/2/${path}`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(6000),
        cache: "no-store",
      });
      if (res.ok) return await res.json();
      if (res.status !== 503) return null;
    } catch {
      // timeout or network error: retry once
    }
  }
  return null;
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
  // "Good Golly, Miss Molly" matches "Good Golly Miss Molly"; a single "A-side / B-side" matches either side.
  const sameSong = (t?: string) => !!t && t.split(/\s+\/\s+/).some((part) => norm(cleanTitle(part)) === songKey);

  // 1. The exact recording Spotify is playing.
  if (isrc) {
    const data = await mb(`isrc/${encodeURIComponent(isrc)}?fmt=json&inc=releases`);
    for (const r of (data?.recordings ?? []) as Recording[]) {
      add("isrc", r.title, r["first-release-date"]);
      for (const rel of r.releases ?? []) add("isrc", r.title, rel.date);
    }
  }

  // Pin down the artist: the best-scoring artist whose name matches what Spotify says.
  let artistId: string | null = null;
  if (artist) {
    const data = await mb(`artist?fmt=json&limit=5&query=${encodeURIComponent(`artist:"${lucene(artist)}"`)}`);
    const artists = (data?.artists ?? []) as Artist[];
    artistId = (artists.find((a) => norm(a.name) === norm(artist)) ?? artists[0])?.id ?? null;
  }

  if (artistId && songKey) {
    // 2. Every single by the artist, oldest first, looking for this song's title.
    for (let offset = 0; offset < 300; offset += 100) {
      const data = await mb(`release-group?fmt=json&artist=${artistId}&type=single&limit=100&offset=${offset}`);
      const groups = (data?.["release-groups"] ?? []) as ReleaseGroup[];
      for (const g of groups) if (sameSong(g.title)) add("single", g.title, g["first-release-date"]);
      if (groups.length < 100) break;
    }

    // 3. Every recording of the song credited to this exact artist.
    const query = `recording:"${lucene(title)}" AND arid:${artistId}`;
    for (let offset = 0; offset < 300; offset += 100) {
      const data = await mb(`recording?fmt=json&limit=100&offset=${offset}&query=${encodeURIComponent(query)}`);
      const recs = (data?.recordings ?? []) as Recording[];
      for (const r of recs) if (sameSong(r.title)) add("recording", r.title, r["first-release-date"]);
      if (recs.length < 100 || offset + 100 >= (data?.count ?? 0)) break;
    }
  }

  const first = [...found].sort((a, b) => a.year - b.year)[0];
  const year = first?.year ?? null;
  const result = first
    ? { year: first.year, source: "musicbrainz", matched: first.title }
    : { year: spotifyYear, source: spotifyYear ? "spotify" : "none", matched: null };
  if (year) cache.set(key, result);

  if (debug) {
    const earliestFrom = (from: string) => {
      const ys = found.filter((f) => f.from === from).map((f) => f.year);
      return ys.length ? Math.min(...ys) : null;
    };
    return NextResponse.json({
      ...result,
      artistId,
      earliest: { isrc: earliestFrom("isrc"), single: earliestFrom("single"), recording: earliestFrom("recording") },
      oldest: [...found].sort((a, b) => a.year - b.year).slice(0, 5),
    });
  }
  return NextResponse.json(result);
}
