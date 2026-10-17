"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

export type Room = {
  id: string;
  code: string;
  host_uid: string;
  status: "lobby" | "playing" | "finished";
  target_cards: number;
  winner_player_id: string | null;
};
export type Player = { id: string; room_id: string; uid: string; nickname: string; created_at: string };
export type Round = { id: string; room_id: string; number: number; status: "open" | "closed" };
export type Secret = { round_id: string; spotify_track_id: string | null; title: string; artist: string; year: number; image_url: string | null };
export type Answer = { round_id: string; player_id: string; slot: number; is_correct: boolean | null };
export type Card = { id: string; player_id: string; round_id: string | null; year: number; title: string; artist: string };

export type RoomState = {
  room: Room;
  players: Player[];
  round: Round | null;
  /** Only visible to players once the round is revealed; the host always sees it. */
  secret: Secret | null;
  /** Players see their own answer until the reveal, then everyone's. */
  answers: Answer[];
  cards: Card[];
};

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const createRoom = (targetCards: number) => rpc<Room>("create_room", { p_target_cards: targetCards });
export const joinRoom = (code: string, nickname: string) => rpc<Player>("join_room", { p_code: code, p_nickname: nickname });
export const submitAnswer = (roundId: string, slot: number) => rpc<void>("submit_answer", { p_round: roundId, p_slot: slot });
export const closeRound = (roundId: string) => rpc<void>("close_round", { p_round: roundId });
export const setRoundYear = (roundId: string, year: number) => rpc<void>("set_round_year", { p_round: roundId, p_year: year });
export const openRound = (
  roomId: string,
  song: { spotifyTrackId: string | null; title: string; artist: string; year: number; imageUrl: string | null },
) =>
  rpc<Round | null>("open_round", {
    p_room: roomId,
    p_spotify_track_id: song.spotifyTrackId,
    p_title: song.title,
    p_artist: song.artist,
    p_year: song.year,
    p_image_url: song.imageUrl,
  });

export async function findRoomByCode(code: string): Promise<Room | null> {
  const { data } = await supabase().from("rooms").select("*").eq("code", code.toUpperCase()).maybeSingle();
  return data;
}

async function loadRoom(roomId: string): Promise<RoomState | null> {
  const sb = supabase();
  const [room, players, round, cards] = await Promise.all([
    sb.from("rooms").select("*").eq("id", roomId).maybeSingle(),
    sb.from("players").select("*").eq("room_id", roomId).order("created_at"),
    sb.from("rounds").select("*").eq("room_id", roomId).order("number", { ascending: false }).limit(1).maybeSingle(),
    sb.from("timeline_cards").select("*").eq("room_id", roomId).order("year"),
  ]);
  if (!room.data) return null;
  let secret: Secret | null = null;
  let answers: Answer[] = [];
  if (round.data) {
    const [s, a] = await Promise.all([
      sb.from("round_secrets").select("*").eq("round_id", round.data.id).maybeSingle(),
      sb.from("answers").select("*").eq("round_id", round.data.id),
    ]);
    secret = s.data;
    answers = a.data ?? [];
  }
  return { room: room.data, players: players.data ?? [], round: round.data, secret, answers, cards: cards.data ?? [] };
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
    const poll = setInterval(refresh, 10_000);
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

export function cardsOf(state: RoomState, playerId: string): Card[] {
  return state.cards.filter((c) => c.player_id === playerId).sort((a, b) => a.year - b.year);
}

export function standings(state: RoomState) {
  return state.players
    .map((p) => ({ player: p, cards: state.cards.filter((c) => c.player_id === p.id).length }))
    .sort((a, b) => b.cards - a.cards || a.player.created_at.localeCompare(b.player.created_at));
}
