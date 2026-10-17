"use client";

import { useState } from "react";
import { Leaderboard } from "@/components/Leaderboard";
import { Timeline } from "@/components/Timeline";
import { Button, ErrorText, Panel } from "@/components/ui";
import { yearColor } from "@/lib/colors";
import { cardsOf, type RoomState } from "@/lib/game";

/** The player's whole game screen. Pure UI: data comes in, the lock-in action goes out. */
export function PlayerView({
  state,
  meId,
  onLockIn,
}: {
  state: RoomState;
  meId: string;
  onLockIn: (roundId: string, slot: number) => Promise<void>;
}) {
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
                await onLockIn(round.id, slot);
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
          <p className="text-3xl font-black" style={{ color: yearColor(secret.year) }}>
            {secret.year}
          </p>
        </div>
      )}
      <p className="mt-3 text-sm text-white/50">Waiting for the next song…</p>
    </Panel>
  );
}
