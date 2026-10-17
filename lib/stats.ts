import type { Answer, RoomState } from "./game";

/** The oldest edge of the timeline when a guess is open-ended at the old end. */
const OLDEST = 1950;
/** The smallest gap counted for a guess older than all of a player's cards. */
const MIN_OLD_GAP = 10;

export type PlayerStats = {
  guessed: number;
  correct: number;
  skipped: number;
  /** How wide the gaps of correct guesses were, on average (smaller is sharper). */
  avgGap: number | null;
  /** How far wrong guesses missed by, on average: distance from the real year to the nearest edge of the gap. */
  avgMiss: number | null;
};

/**
 * Width of the gap a guess was placed in. Above the newest card the gap runs to the current year;
 * below the oldest it runs to 1950, but counts as at least 10 years (a guess before 1952 is 10).
 */
export function gapWidth(a: Pick<Answer, "lower_year" | "upper_year">, currentYear: number): number | null {
  const { lower_year: lo, upper_year: hi } = a;
  if (lo === null && hi === null) return null;
  if (lo === null) return Math.max(hi! - OLDEST, MIN_OLD_GAP);
  if (hi === null) return Math.max(currentYear - lo, 0);
  return hi - lo;
}

/** How many years outside the chosen gap the real year was (0 if it was inside). */
export function missBy(a: Pick<Answer, "lower_year" | "upper_year">, year: number): number {
  if (a.lower_year !== null && year < a.lower_year) return a.lower_year - year;
  if (a.upper_year !== null && year > a.upper_year) return year - a.upper_year;
  return 0;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export function playerStats(state: RoomState, playerId: string, currentYear = new Date().getFullYear()): PlayerStats {
  const mine = state.history.filter((a) => a.player_id === playerId);
  const player = state.players.find((p) => p.id === playerId);
  const answered = new Set(mine.map((a) => a.round_id));
  const skipped = state.rounds.filter(
    (r) => r.status === "closed" && !answered.has(r.id) && (!player || player.created_at <= r.opened_at),
  ).length;

  // Answers from before bounds were recorded have neither edge; leave them out of the averages.
  const bounded = mine.filter((a) => a.lower_year !== null || a.upper_year !== null);
  const gaps = bounded.filter((a) => a.is_correct).map((a) => gapWidth(a, currentYear)!);
  const misses = bounded
    .filter((a) => a.is_correct === false)
    .filter((a) => state.years[a.round_id] !== undefined)
    .map((a) => missBy(a, state.years[a.round_id]));

  return {
    guessed: mine.length,
    correct: mine.filter((a) => a.is_correct).length,
    skipped,
    avgGap: avg(gaps),
    avgMiss: avg(misses),
  };
}
