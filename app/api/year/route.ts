import { NextResponse } from "next/server";
import { lookupYear } from "@/lib/yearLookup";

// A lookup is several MusicBrainz calls a second apart; give it room past the default timeout.
export const maxDuration = 30;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  return NextResponse.json(
    await lookupYear({
      isrc: q.get("isrc"),
      title: q.get("title") ?? "",
      artist: q.get("artist") ?? "",
      spotifyYear: q.get("spotifyYear"),
      debug: !!q.get("debug"),
    }),
  );
}
