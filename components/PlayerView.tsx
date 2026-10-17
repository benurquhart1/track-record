"use client";

import { useState } from "react";
import { Leaderboard } from "@/components/Leaderboard";
import { Timeline } from "@/components/Timeline";
import { Button, ErrorText, Panel } from "@/components/ui";
import { yearColor } from "@/lib/colors";
import { cardsOf, type RoomState } from "@/lib/game";
import { missBy } from "@/lib/stats";

/** The player's whole game screen. Pure UI: data comes in, the guess goes out. */
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
  // A guess is graded the moment it's in, so the player sees the answer without waiting for anyone.
  const guessing = open && !myAnswer && room.status !== "finished";
  const winner = players.find((p) => p.id === room.winner_player_id);
  const newCard = round && myAnswer ? cards.find((c) => c.round_id === round.id) : undefined;

  const submit = async () => {
    if (slot === null || !round || saving) return;
    setSaving(true);
    try {
      await onLockIn(round.id, slot);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between">
        <p className="text-sm font-semibold text-white/50">Game {room.code}</p>
        <p className="font-black">
          {cards.length}
          <span className="font-normal text-white/40">{room.target_cards ? `/${room.target_cards}` : ""} cards</span>
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
      ) : guessing ? (
        <Panel className="text-center">
          <p className="text-sm font-semibold text-white/50">Song {round.number}</p>
          <p className="mt-1 text-2xl font-black">When was this released?</p>
          <p className="mt-1 text-white/60">Drag the mystery song into place, or tap between two cards.</p>
        </Panel>
      ) : (
        <RevealPanel state={state} meId={meId} />
      )}

      <section>
        {guessing && (
          <div className="sticky top-2 z-20 mb-3">
            <Button disabled={slot === null || saving} onClick={submit}>
              {saving ? "Submitting…" : slot === null ? "Place the song to submit" : "Submit guess"}
            </Button>
            <ErrorText error={error} />
          </div>
        )}
        <Timeline
          cards={cards}
          picking={guessing}
          selected={slot}
          onPick={setSlot}
          onSubmit={submit}
          submitting={saving}
          highlightId={newCard?.id}
        />
      </section>

      <Panel>
        <h2 className="mb-3 font-bold">Leaderboard</h2>
        <Leaderboard state={state} meId={meId} />
      </Panel>
    </div>
  );
}

function RevealPanel({ state, meId }: { state: RoomState; meId: string }) {
  const { secret, round } = state;
  const mine = state.answers.find((a) => a.player_id === meId);
  const stillOpen = round?.status === "open";
  const pending = !!mine && mine.is_correct === null;
  const off = mine && mine.is_correct === false && secret?.year ? missBy(mine, secret.year) : 0;
  const verdict = !mine
    ? "You didn't guess this one."
    : pending
      ? "Locked in! Checking the year…"
      : mine.is_correct
      ? "Correct! It's in your timeline."
      : `Wrong${off ? ` by ${off} year${off === 1 ? "" : "s"}` : ""}, the card is gone.`;
  return (
    <Panel className={`text-center ${pending ? "" : mine?.is_correct ? "border-good" : mine ? "border-bad" : ""}`}>
      <p className={`text-xl font-black ${pending ? "animate-pulse text-white" : mine?.is_correct ? "text-good" : mine ? "text-bad" : "text-white/70"}`}>
        {verdict}
      </p>
      {secret && (
        <div className="mt-4 flex items-center gap-4 text-left">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {secret.image_url && <img src={secret.image_url} alt="" className="h-16 w-16 rounded-lg" />}
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{secret.title}</p>
            <p className="truncate text-sm text-white/50">{secret.artist}</p>
          </div>
          {secret.year !== null ? (
            <p
              className={`text-3xl font-black ${mine?.is_correct === false ? "text-bad" : ""}`}
              // Red when you got it wrong, so a green-ish year colour doesn't read as "right".
              style={mine?.is_correct === false ? undefined : { color: yearColor(secret.year) }}
            >
              {secret.year}
            </p>
          ) : (
            <p className="text-3xl font-black text-white/30">????</p>
          )}
        </div>
      )}
      <p className="mt-3 text-sm text-white/50">{stillOpen ? "Others are still guessing. Keep it quiet!" : "Waiting for the next song…"}</p>
    </Panel>
  );
}
