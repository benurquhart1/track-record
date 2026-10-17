/** "Song - Remastered 2011" / "Song (2009 Remaster)" -> "Song", so remasters don't leak a wrong year or title. */
export function cleanTitle(title: string): string {
  return title
    .replace(/\s+-\s+.*\b(remaster(ed)?|mono|stereo|version|edit|mix|live|anniversary|deluxe)\b.*$/i, "")
    .replace(/\s*[([][^)\]]*\b(remaster(ed)?|mono|stereo|anniversary|deluxe)\b[^)\]]*[)\]]/gi, "")
    .trim();
}

export function firstArtist(artist: string): string {
  return artist.split(",")[0].trim();
}
