import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** The commit currently deployed, so open pages can tell when they're out of date. */
export function GET() {
  return NextResponse.json({ version: process.env.VERCEL_GIT_COMMIT_SHA ?? null });
}
