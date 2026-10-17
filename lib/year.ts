/**
 * Strips the version info Spotify adds to titles, so it doesn't leak a wrong year and searches
 * match the plain song name:
 *   "Song - Remastered 2011", "Song - From "Saturday Night Fever" Soundtrack", "Song - Mono Version",
 *   "Song (2009 Remaster)", "Song (feat. Someone)", "Song [Live]" -> "Song"
 */
export function cleanTitle(title: string): string {
  return title
    .replace(/\s+-\s+.*$/, "")
    .replace(/\s*\((feat\.?|ft\.?|featuring|with)\s[^)]*\)/gi, "")
    .replace(/\s*[([][^)\]]*\b(remaster(ed)?|mono|stereo|version|edit|mix|live|anniversary|deluxe|bonus|demo|acoustic)\b[^)\]]*[)\]]/gi, "")
    .trim();
}

export function firstArtist(artist: string): string {
  return artist.split(",")[0].trim();
}
