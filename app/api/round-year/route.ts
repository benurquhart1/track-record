import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { lookupYear } from "@/lib/yearLookup";

// Looks up a round's year and fills it in on the server, so it lands even if the host's phone
// locks or switches apps while MusicBrainz is being asked.
export const maxDuration = 30;

export async function POST(req: Request) {
  const body = await req.json();
  const answer = await lookupYear({
    isrc: body.isrc ?? null,
    title: String(body.title ?? ""),
    artist: String(body.artist ?? ""),
    spotifyYear: body.spotifyYear ? String(body.spotifyYear) : null,
  });
  let filled = false;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (answer.year && body.roundId && body.token && url && key) {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { data } = await sb.rpc("fill_round_year", { p_round: body.roundId, p_token: body.token, p_year: answer.year });
    filled = data === true;
  }
  return NextResponse.json({ year: answer.year, source: answer.source, filled });
}
