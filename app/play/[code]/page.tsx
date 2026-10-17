"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Leaderboard } from "@/components/Leaderboard";
import { Timeline } from "@/components/Timeline";
import { Button, ErrorText, Panel } from "@/components/ui";
import { cardsOf, findRoomByCode, joinRoom, submitAnswer, useRoom, type RoomState } from "@/lib/game";
import { ensureSession } from "@/lib/supabase";

const NICK_KEY = "nickname";

export default function PlayPage() {
  const { code } = useParams<{ code: string }>();
  const [uid, setUid] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { state, refresh } = useRoom(roomId);

  useEffect(() => {
    ensureSession()
      .then(async (id) => {
        setUid(id);
        const room = await findRoomByCode(code);
        if (room) setRoomId(room.id);
        else setError(`No game with code ${code.toUpperCase()}.`);
      })
      .catch((e: Error) => setError(e.message));
  }, [code]);

  if (error)
    return (
      <div className="pt-20 text-center">
        <p className="text-white/70">{error}</p>
        <Link href="/" className="mt-4 block text-accent underline">
          Back
        </Link>
      </div>
    );
  if (!state || !uid) return <p className="pt-20 text-center text-white/60">Joining…</p>;

  const me = state.players.find((p) => p.uid === uid);
  if (!me) return <JoinForm code={state.room.code} onJoined={refresh} />;
  return <Game key={state.round?.id ?? "lobby"} state={state} meId={me.id} refresh={refresh} />;
}

function JoinForm({ code, onJoined }: { code: string; onJoined: () => Promise<void> }) {
  const [name, setName] = useState(() => (typeof window === "undefined" ? "" : localStorage.getItem(NICK_KEY) ?? ""));
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-4 pt-10"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          localStorage.setItem(NICK_KEY, name.trim());
          await joinRoom(code, name);
          await onJoined();
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <p className="text-sm font-semibold text-white/50">Joining game {code}</p>
      <h1 className="text-3xl font-black">What&apos;s your name?</h1>
      <input
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, 24))}
        autoFocus
        placeholder="Name"
        className="w-full rounded-2xl border border-line bg-panel px-5 py-4 text-xl outline-none focus:border-accent"
      />
      <Button type="submit" disabled={!name.trim()}>
        Join
      </Button>
      <ErrorText error={error} />
    </form>
  );
}

function Game({ state, meId, refresh }: { state: RoomState; meId: string; refresh: () => Promise<void> }) {
  const { room, round, players } = state;
  const myAnswer = state.answers.find((a) => a.player_id === meId) ?? null;
  const [slot, setSlot] = useState<number | null>(myAnswer?.slot ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const cards = cardsOf(state, meId);
  const open = round?.status === "open";
  const lockedIn = myAnswer !== null && myAnswer.slot === slot;
  const winner = players.find((p) => p.id === room.winner_player_id);
  const newCard = round && !open ? cards.find((c) => c.round_id === round.id) : undefined;

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between">
        <p className="text-sm font-semibold text-white/50">Game {room.code}</p>
        <p className="font-black">
          {cards.length}
          <span className="font-normal text-white/40">/{room.target_cards} cards</span>
        </p>
      </header>

      {room.status === "finished" ? (
        <Panel className="text-center">
          <p className="text-white/60">Game over</p>
          <p className="mt-1 text-4xl font-black">{winner?.id === meId ? "You win! 🏆" : `${winner?.nickname ?? "Someone"} wins 🏆`}</p>
        </Panel>
      ) : !round ? (
        <Panel className="text-center">
          <p className="text-xl font-bold">You&apos;re in!</p>
          <p className="mt-2 text-white/60">Waiting for the first song…</p>
        </Panel>
      ) : open ? (
        <Panel className="text-center">
          <p className="text-sm font-semibold text-white/50">Song {round.number}</p>
          <p className="mt-1 text-2xl font-black">When was this released?</p>
          <p className="mt-1 text-white/60">Tap where it fits in your timeline.</p>
        </Panel>
      ) : (
        <RevealPanel state={state} meId={meId} />
      )}

      <section>
        <Timeline cards={cards} picking={open && room.status !== "finished"} selected={slot} onPick={setSlot} highlightId={newCard?.id} />
      </section>

      {open && room.status !== "finished" && (
        <div className="sticky bottom-4">
          <Button
            disabled={slot === null || lockedIn || saving}
            onClick={async () => {
              if (slot === null || !round) return;
              setSaving(true);
              try {
                await submitAnswer(round.id, slot);
                await refresh();
                setError(null);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            {lockedIn ? "Locked in. You can still change it." : myAnswer ? "Change my answer" : "Lock it in"}
          </Button>
          <ErrorText error={error} />
        </div>
      )}

      <Panel>
        <h2 className="mb-3 font-bold">Leaderboard</h2>
        <Leaderboard state={state} meId={meId} />
      </Panel>
    </div>
  );
}

function RevealPanel({ state, meId }: { state: RoomState; meId: string }) {
  const { secret } = state;
  const mine = state.answers.find((a) => a.player_id === meId);
  const verdict = !mine ? "You didn't guess this one." : mine.is_correct ? "Correct! It's in your timeline." : "Wrong, the card is gone.";
  return (
    <Panel className={`text-center ${mine?.is_correct ? "border-good" : mine ? "border-bad" : ""}`}>
      <p className={`text-xl font-black ${mine?.is_correct ? "text-good" : mine ? "text-bad" : "text-white/70"}`}>{verdict}</p>
      {secret && (
        <div className="mt-4 flex items-center gap-4 text-left">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {secret.image_url && <img src={secret.image_url} alt="" className="h-16 w-16 rounded-lg" />}
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{secret.title}</p>
            <p className="truncate text-sm text-white/50">{secret.artist}</p>
          </div>
          <p className="text-3xl font-black text-accent-2">{secret.year}</p>
        </div>
      )}
      <p className="mt-3 text-sm text-white/50">Waiting for the next song…</p>
    </Panel>
  );
}
