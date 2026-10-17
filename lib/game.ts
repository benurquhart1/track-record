"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

export type Room = {
  id: string;
  code: string;
  host_uid: string;
  status: "lobby" | "playing" | "finished";
  /** null = no card limit; the host ends the game. */
  target_cards: number | null;
  starting_cards: number;
  winner_player_id: string | null;
};
export type Player = { id: string; room_id: string; uid: string; nickname: string; created_at: string };
export type Round = { id: string; room_id: string; number: number; status: "open" | "closed"; opened_at: string };
export type Secret = { round_id: string; spotify_track_id: string | null; title: string; artist: string; /** null until the host's lookup finds it. */ year: number | null; image_url: string | null };
export type Answer = {
  round_id: string;
  player_id: string;
  slot: number;
  is_correct: boolean | null;
  /** The years either side of the gap the player picked (null = open-ended). */
  lower_year: number | null;
  upper_year: number | null;
};
export type Card = {
  id: string;
  player_id: string;
  round_id: string | null;
  year: number;
  title: string;
  artist: string;
  /** Album cover, filled in from the revealed round (starting cards have none). */
  image_url?: string | null;
};

export type RoomState = {
  room: Room;
  players: Player[];
  round: Round | null;
  /** Only visible to players once the round is revealed; the host always sees it. */
  secret: Secret | null;
  /** This round's answers. Players see their own straight away, everyone's once the round closes. */
  answers: Answer[];
  /** Every round so far, oldest first. */
  rounds: Round[];
  /** Every answer this player can see, across all rounds (for stats). */
  history: Answer[];
  /** Real year of every round whose song this player can see. */
  years: Record<string, number>;
  /** Players who've guessed the current song (everyone can see who, not what). */
  lockedIn?: string[];
  cards: Card[];
};

// Listed out because the table also holds a column players aren't allowed to read.
const SECRET_COLUMNS = "round_id, spotify_track_id, title, artist, year, image_url";

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const createRoom = (targetCards: number | null, startingCards: number) =>
  rpc<Room>("create_room", { p_target_cards: targetCards, p_starting_cards: startingCards });
export const joinRoom = (code: string, nickname: string) => rpc<Player>("join_room", { p_code: code, p_nickname: nickname });
export const submitAnswer = (roundId: string, slot: number) => rpc<Answer>("submit_answer", { p_round: roundId, p_slot: slot });
export const endGame = (roomId: string) => rpc<void>("end_game", { p_room: roomId });
export const closeRound = (roundId: string) => rpc<void>("close_round", { p_round: roundId });
export const setRoundYear = (roundId: string, year: number) => rpc<void>("set_round_year", { p_round: roundId, p_year: year });
export const openRound = (
  roomId: string,
  song: { spotifyTrackId: string | null; title: string; artist: string; year: number | null; imageUrl: string | null },
  /** Lets the server fill in the year later (see /api/round-year). */
  fillToken?: string,
) =>
  rpc<Round | null>("open_round", {
    p_room: roomId,
    p_spotify_track_id: song.spotifyTrackId,
    p_title: song.title,
    p_artist: song.artist,
    p_year: song.year,
    p_image_url: song.imageUrl,
    ...(fillToken ? { p_fill_token: fillToken } : {}),
  });

export async function findRoomByCode(code: string): Promise<Room | null> {
  const { data } = await supabase().from("rooms").select("*").eq("code", code.toUpperCase()).maybeSingle();
  return data;
}

async function loadRoom(roomId: string): Promise<RoomState | null> {
  const sb = supabase();
  const [room, players, rounds, cards, history] = await Promise.all([
    sb.from("rooms").select("*").eq("id", roomId).maybeSingle(),
    sb.from("players").select("*").eq("room_id", roomId).order("created_at"),
    sb.from("rounds").select("*").eq("room_id", roomId).order("number"),
    sb.from("timeline_cards").select("*").eq("room_id", roomId).order("year"),
    sb.from("answers").select("*").eq("room_id", roomId),
  ]);
  if (!room.data) return null;
  const roundList: Round[] = rounds.data ?? [];
  const round = { data: roundList.at(-1) ?? null };
  const answerList: Answer[] = history.data ?? [];
  const cardList: Card[] = cards.data ?? [];
  // Covers for won cards and years for stats. Only songs this player may already see come back.
  const years: Record<string, number> = {};
  if (roundList.length) {
    const { data: revealed } = await sb
      .from("round_secrets")
      .select("round_id, year, image_url")
      .in("round_id", roundList.map((r) => r.id));
    const covers = new Map((revealed ?? []).map((s) => [s.round_id, s.image_url]));
    for (const s of revealed ?? []) if (s.year !== null) years[s.round_id] = s.year;
    for (const c of cardList) c.image_url = c.round_id ? covers.get(c.round_id) ?? null : null;
  }
  let secret: Secret | null = null;
  if (round.data) {
    const s = await sb.from("round_secrets").select(SECRET_COLUMNS).eq("round_id", round.data.id).maybeSingle();
    secret = s.data;
  }
  const answers = round.data ? answerList.filter((a) => a.round_id === round.data!.id) : [];
  let lockedIn = answers.map((a) => a.player_id);
  if (round.data?.status === "open") {
    const { data, error } = await sb.rpc("locked_in", { p_round: round.data.id });
    if (!error && Array.isArray(data)) lockedIn = data as string[];
  }
  return {
    room: room.data,
    players: players.data ?? [],
    round: round.data,
    secret,
    answers,
    rounds: roundList,
    history: answerList,
    years,
    lockedIn,
    cards: cardList,
  };
}

const BUILT = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;

/**
 * Reloads the page when a newer version of the site is live, so nobody plays a game with old
 * rules after an update (phones keep tabs open for days).
 */
async function reloadIfOutdated() {
  if (!BUILT || document.visibilityState !== "visible") return;
  try {
    const { version } = await (await fetch("/api/version", { cache: "no-store" })).json();
    if (version && version !== BUILT) window.location.reload();
  } catch {
    // offline: try again next time
  }
}

/** Live view of a room: loads everything, then reloads whenever anything in the room changes. */
export function useRoom(roomId: string | null) {
  const [state, setState] = useState<RoomState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (!roomId) return;
    const next = await loadRoom(roomId);
    if (next) setState(next);
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    refresh();
    const soon = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(refresh, 150);
    };
    const channel = supabase().channel(`room:${roomId}`);
    for (const table of ["players", "rounds", "answers", "timeline_cards"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `room_id=eq.${roomId}` }, soon);
    }
    channel.on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, soon);
    channel.subscribe();
    // Safety net in case a realtime event is missed (phones sleeping, flaky wifi).
    let ticks = 0;
    const poll = setInterval(() => {
      refresh();
      if (++ticks % 3 === 0) reloadIfOutdated();
    }, 10_000);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      supabase().removeChannel(channel);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [roomId, refresh]);

  return { state, refresh };
}

export function lockedInIds(state: RoomState): Set<string> {
  return new Set(state.lockedIn ?? state.answers.map((a) => a.player_id));
}

export function cardsOf(state: RoomState, playerId: string): Card[] {
  return state.cards.filter((c) => c.player_id === playerId).sort((a, b) => a.year - b.year);
}

export function standings(state: RoomState) {
  return state.players
    .map((p) => ({ player: p, cards: state.cards.filter((c) => c.player_id === p.id).length }))
    .sort((a, b) => b.cards - a.cards || a.player.created_at.localeCompare(b.player.created_at));
}
