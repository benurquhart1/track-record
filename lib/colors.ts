/** Rainbow by year: violet for 1930, red for 2030, hue interpolated linearly in between. */
export function yearHue(year: number): number {
  const t = Math.min(1, Math.max(0, (year - 1930) / 100));
  return Math.round(275 * (1 - t));
}

export function yearColor(year: number, lightness = 60): string {
  return `hsl(${yearHue(year)} 85% ${lightness}%)`;
}
