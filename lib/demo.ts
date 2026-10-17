// Fake game data for /demo, so screens can be designed without Spotify or Supabase.
import type { Answer, Card, Player, RoomState } from "./game";
import { yearHue } from "./colors";

export const DEMO_SONGS = [
  { title: "Bohemian Rhapsody", artist: "Queen", year: 1975 },
  { title: "Billie Jean", artist: "Michael Jackson", year: 1982 },
  { title: "Smells Like Teen Spirit", artist: "Nirvana", year: 1991 },
  { title: "Crazy in Love", artist: "Beyoncé, JAY-Z", year: 2003 },
  { title: "Blinding Lights", artist: "The Weeknd", year: 2019 },
  { title: "Respect", artist: "Aretha Franklin", year: 1967 },
  { title: "Wonderwall", artist: "Oasis", year: 1995 },
  { title: "Hey Ya!", artist: "Outkast", year: 2003 },
  { title: "Johnny B. Goode", artist: "Chuck Berry", year: 1958 },
  { title: "Espresso", artist: "Sabrina Carpenter", year: 2024 },
];

/** A stand-in album cover: a gradient square in the song's year colour with its initials. */
export function demoCover(title: string, year: number): string {
  const h = yearHue(year);
  const initials = title.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h} 80% 60%)"/><stop offset="1" stop-color="hsl(${(h + 60) % 360} 70% 30%)"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><text x="32" y="40" font-family="sans-serif" font-size="22" font-weight="700" fill="white" text-anchor="middle">${initials}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const DEMO_ME = "p-me";

const players: Player[] = [
  { id: DEMO_ME, room_id: "demo", uid: "u-me", nickname: "You", created_at: "2026-01-01T00:00:00Z" },
  { id: "p-alex", room_id: "demo", uid: "u-alex", nickname: "Alex", created_at: "2026-01-01T00:00:01Z" },
  { id: "p-sam", room_id: "demo", uid: "u-sam", nickname: "Sam", created_at: "2026-01-01T00:00:02Z" },
  { id: "p-jordan", room_id: "demo", uid: "u-jordan", nickname: "Jordan", created_at: "2026-01-01T00:00:03Z" },
];

function card(playerId: string, song: (typeof DEMO_SONGS)[number], i: number): Card {
  return {
    id: `c-${playerId}-${i}`,
    player_id: playerId,
    round_id: `r-${i}`,
    year: song.year,
    title: song.title,
    artist: song.artist,
    image_url: demoCover(song.title, song.year),
  };
}

export function demoInitialState(): RoomState {
  const seed = (playerId: string, year: number): Card => ({
    id: `seed-${playerId}`,
    player_id: playerId,
    round_id: null,
    year,
    title: "Starting card",
    artist: "",
  });
  return {
    room: { id: "demo", code: "DEMO", host_uid: "u-host", status: "lobby", target_cards: 10, winner_player_id: null },
    players,
    round: null,
    secret: null,
    answers: [],
    cards: [
      seed(DEMO_ME, 1988),
      card(DEMO_ME, DEMO_SONGS[5], 100),
      card(DEMO_ME, DEMO_SONGS[4], 101),
      seed("p-alex", 1972),
      card("p-alex", DEMO_SONGS[6], 102),
      card("p-alex", DEMO_SONGS[8], 103),
      card("p-alex", DEMO_SONGS[9], 104),
      seed("p-sam", 2001),
      seed("p-jordan", 1979),
      card("p-jordan", DEMO_SONGS[1], 105),
    ],
  };
}

export function demoOpenRound(state: RoomState, n: number): RoomState {
  const song = DEMO_SONGS[n % 5];
  const roundId = `round-${n}`;
  return {
    ...state,
    room: { ...state.room, status: "playing" },
    round: { id: roundId, room_id: "demo", number: n + 1, status: "open" },
    secret: { round_id: roundId, spotify_track_id: null, ...song, image_url: demoCover(song.title, song.year) },
    // The other players lock in a moment later in a real game; here they already have.
    answers: players.filter((p) => p.id !== DEMO_ME).map((p) => ({ round_id: roundId, player_id: p.id, slot: 0, is_correct: null })),
  };
}

export function demoLockIn(state: RoomState, slot: number): RoomState {
  if (!state.round) return state;
  const others = state.answers.filter((a) => a.player_id !== DEMO_ME);
  const mine: Answer = { round_id: state.round.id, player_id: DEMO_ME, slot, is_correct: null };
  return { ...state, answers: [...others, mine] };
}

/** Scores the round the same way the server does and hands out cards. */
export function demoReveal(state: RoomState): RoomState {
  const { round, secret } = state;
  if (!round || !secret) return state;
  const cards = [...state.cards];
  const answers = state.answers.map((a, i) => {
    const years = cards.filter((c) => c.player_id === a.player_id).map((c) => c.year).sort((x, y) => x - y);
    const ok =
      a.player_id === DEMO_ME
        ? (a.slot === 0 || years[a.slot - 1] <= secret.year) && (a.slot === years.length || secret.year <= years[a.slot])
        : (round.number + i) % 2 === 0;
    if (ok) {
      cards.push({
        id: `c-${a.player_id}-${round.id}`,
        player_id: a.player_id,
        round_id: round.id,
        year: secret.year,
        title: secret.title,
        artist: secret.artist,
        image_url: secret.image_url,
      });
    }
    return { ...a, is_correct: ok };
  });
  return { ...state, round: { ...round, status: "closed" }, answers, cards };
}

export function demoFinish(state: RoomState): RoomState {
  return { ...state, room: { ...state.room, status: "finished", winner_player_id: DEMO_ME } };
}
