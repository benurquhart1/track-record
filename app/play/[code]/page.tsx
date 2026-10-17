"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PlayerView } from "@/components/PlayerView";
import { Button, ErrorText } from "@/components/ui";
import { findRoomByCode, joinRoom, submitAnswer, useRoom } from "@/lib/game";
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
  return (
    <PlayerView
      key={state.round?.id ?? "lobby"}
      state={state}
      meId={me.id}
      onLockIn={async (roundId, slot) => {
        await submitAnswer(roundId, slot);
        await refresh();
      }}
    />
  );
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
