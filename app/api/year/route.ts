import { NextResponse } from "next/server";
import { cleanTitle, firstArtist } from "@/lib/year";

// Spotify reports the year of the album version playing, so remasters and compilations
// come out too late. MusicBrainz knows every release a recording appeared on, so the earliest
// of those is the song's real release year. Spotify's year is only a last resort.

const UA = "track-record/0.2 (private party game; github.com/benurquhart1/track-record)";

type Release = { date?: string };
type Recording = {
  "first-release-date"?: string;
  score?: number;
  releases?: Release[];
  "artist-credit"?: { name?: string; artist?: { name?: string } }[];
};

function yearOf(date?: string): number | null {
  const y = parseInt((date ?? "").slice(0, 4), 10);
  return y > 1900 ? y : null;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

// Results don't change, so keep them for the life of the server instance.
let lastCall = 0;
const cache = new Map<string, { year: number | null; source: string }>();

type ReleaseGroup = { "first-release-date"?: string; score?: number; "artist-credit"?: Recording["artist-credit"] };

async function mb(path: string): Promise<{ recordings?: Recording[]; "release-groups"?: ReleaseGroup[] } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    // Stay under MusicBrainz's limit of about one request a second.
    const wait = lastCall + 1050 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    try {
      const res = await fetch(`https://musicbrainz.org/ws/2/${path}`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      });
      if (res.ok) return await res.json();
      // MusicBrainz allows about one request a second and answers 503 when busy.
      if (res.status !== 503) return null;
    } catch {
      // timeout or network error: retry once
    }
  }
  return null;
}

function earliest(recordings: Recording[]): number[] {
  const years: number[] = [];
  for (const r of recordings) {
    const first = yearOf(r["first-release-date"]);
    if (first) years.push(first);
    for (const rel of r.releases ?? []) {
      const y = yearOf(rel.date);
      if (y) years.push(y);
    }
  }
  return years;
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const isrc = q.get("isrc");
  const title = cleanTitle(q.get("title") ?? "");
  const artist = firstArtist(q.get("artist") ?? "");
  const spotifyYear = yearOf(q.get("spotifyYear") ?? undefined);

  const key = `${isrc}|${norm(title)}|${norm(artist)}`;
  const hit = cache.get(key);
  if (hit && !q.get("debug")) return NextResponse.json(hit);

  const years: number[] = [];
  const found: Record<string, number[]> = {};

  // 1. The exact recording Spotify is playing, by its ISRC code.
  if (isrc) {
    const data = await mb(`isrc/${encodeURIComponent(isrc)}?fmt=json&inc=releases`);
    found.isrc = earliest(data?.recordings ?? []);
    years.push(...found.isrc);
  }

  const t = title.replace(/"/g, "");
  const a = artist.replace(/"/g, "");
  const byArtist = (credits: Recording["artist-credit"]) =>
    (credits ?? []).some((c) => norm(c.name ?? c.artist?.name ?? "").includes(norm(artist)));

  if (title && artist) {
    // 2. Singles and albums with the song's title by the artist: hits were almost always singles,
    // and a release group's date is its first-ever release.
    const groups = await mb(
      `release-group?fmt=json&limit=50&query=${encodeURIComponent(`releasegroup:"${t}" AND artist:"${a}"`)}`,
    );
    found.releaseGroups = (groups?.["release-groups"] ?? [])
      .filter((g) => (g.score ?? 0) >= 90 && byArtist(g["artist-credit"]))
      .map((g) => yearOf(g["first-release-date"]))
      .filter((y): y is number => y !== null);
    years.push(...found.releaseGroups);

    // 3. Every recording of the song by the artist (the original single, album cuts, etc.).
    // Popular songs have hundreds, so ask for the maximum page.
    const recs = await mb(
      `recording?fmt=json&limit=100&query=${encodeURIComponent(`recording:"${t}" AND artist:"${a}"`)}`,
    );
    found.recordings = earliest((recs?.recordings ?? []).filter((r) => (r.score ?? 0) >= 90 && byArtist(r["artist-credit"])));
    years.push(...found.recordings);
  }

  const result =
    years.length > 0
      ? { year: Math.min(...years), source: "musicbrainz" }
      : { year: spotifyYear, source: spotifyYear ? "spotify" : "none" };
  if (years.length > 0) cache.set(key, result);
  if (q.get("debug")) {
    const min = (ys: number[] = []) => (ys.length ? Math.min(...ys) : null);
    return NextResponse.json({ ...result, earliest: { isrc: min(found.isrc), releaseGroups: min(found.releaseGroups), recordings: min(found.recordings) } });
  }
  return NextResponse.json(result);
}
