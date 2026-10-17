/**
 * Rainbow by year: violet for 1930, red for 2030. The hue moves slowly through the older
 * decades (fewer songs) and quickly from the mid-70s to the 2000s, where most songs are, and
 * hurries through green, where the eye sees the least change.
 */
const STOPS: [year: number, hue: number][] = [
  [1930, 275],
  [1960, 250],
  [1970, 220],
  [1978, 190],
  [1985, 160],
  [1991, 120],
  [1997, 75],
  [2003, 50],
  [2010, 32],
  [2018, 15],
  [2030, 0],
];

export function yearHue(year: number): number {
  if (year <= STOPS[0][0]) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) {
    const [y1, h1] = STOPS[i];
    if (year <= y1) {
      const [y0, h0] = STOPS[i - 1];
      return Math.round(h0 + ((year - y0) / (y1 - y0)) * (h1 - h0));
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export function yearColor(year: number, lightness = 60): string {
  return `hsl(${yearHue(year)} 85% ${lightness}%)`;
}
