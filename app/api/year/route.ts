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
const cache = new Map<string, { year: number | null; source: string }>();

async function mb(path: string): Promise<{ recordings?: Recording[] } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
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
    await new Promise((r) => setTimeout(r, 1100));
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
  if (hit) return NextResponse.json(hit);

  const years: number[] = [];

  // 1. The exact recording Spotify is playing, by its ISRC code.
  if (isrc) {
    const data = await mb(`isrc/${encodeURIComponent(isrc)}?fmt=json&inc=releases`);
    years.push(...earliest(data?.recordings ?? []));
  }

  // 2. Other recordings of the same song by the same artist (the original single, album, etc.).
  if (title && artist) {
    const query = `recording:"${title.replace(/"/g, "")}" AND artist:"${artist.replace(/"/g, "")}" AND status:official`;
    const data = await mb(`recording?fmt=json&limit=25&query=${encodeURIComponent(query)}`);
    const matches = (data?.recordings ?? []).filter(
      (r) =>
        (r.score ?? 0) >= 90 &&
        (r["artist-credit"] ?? []).some((c) => norm(c.name ?? c.artist?.name ?? "").includes(norm(artist))),
    );
    years.push(...earliest(matches));
  }

  const result =
    years.length > 0
      ? { year: Math.min(...years), source: "musicbrainz" }
      : { year: spotifyYear, source: spotifyYear ? "spotify" : "none" };
  if (years.length > 0) cache.set(key, result);
  return NextResponse.json(result);
}
