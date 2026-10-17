import { NextResponse } from "next/server";
import { cleanTitle, firstArtist } from "@/lib/year";

// Spotify reports the year of the album version playing, so remasters and compilations
// come out too late. MusicBrainz knows each recording's first release; take the earliest.

const UA = "hitster-party/0.1 (private party game)";

type Recording = { "first-release-date"?: string; score?: number };

function yearOf(date?: string): number | null {
  const y = parseInt((date ?? "").slice(0, 4), 10);
  return y > 1900 ? y : null;
}

async function mb(path: string): Promise<{ recordings?: Recording[] } | null> {
  try {
    const res = await fetch(`https://musicbrainz.org/ws/2/${path}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(4000),
      next: { revalidate: 60 * 60 * 24 * 30 },
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const isrc = q.get("isrc");
  const title = cleanTitle(q.get("title") ?? "");
  const artist = firstArtist(q.get("artist") ?? "");
  const spotifyYear = yearOf(q.get("spotifyYear") ?? undefined);

  const years: number[] = [];
  if (isrc) {
    const data = await mb(`isrc/${encodeURIComponent(isrc)}?fmt=json`);
    for (const r of data?.recordings ?? []) {
      const y = yearOf(r["first-release-date"]);
      if (y) years.push(y);
    }
  }
  if (years.length === 0 && title && artist) {
    const query = `recording:"${title.replace(/"/g, "")}" AND artist:"${artist.replace(/"/g, "")}"`;
    const data = await mb(`recording?fmt=json&limit=10&query=${encodeURIComponent(query)}`);
    for (const r of data?.recordings ?? []) {
      const y = yearOf(r["first-release-date"]);
      if (y && (r.score ?? 0) >= 95) years.push(y);
    }
  }
  if (spotifyYear) years.push(spotifyYear);

  const year = years.length ? Math.min(...years) : null;
  return NextResponse.json({ year, source: year && year !== spotifyYear ? "musicbrainz" : "spotify" });
}
