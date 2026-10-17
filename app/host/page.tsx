"use client";

import { useEffect, useState } from "react";
import { Leaderboard } from "@/components/Leaderboard";
import { QrCode } from "@/components/QrCode";
import { Button, ErrorText, Panel, buttonClass } from "@/components/ui";
import { closeRound, createRoom, endGame, openRound, setRoundYear, standings, useRoom } from "@/lib/game";
import { useHostDriver } from "@/lib/hostDriver";
import { isLoggedIn, logout, startLogin } from "@/lib/spotify";
import { ensureSession } from "@/lib/supabase";

const ROOM_KEY = "host_room_id";

export default function HostPage() {
  const [ready, setReady] = useState(false);
  const [spotify, setSpotify] = useState(false);
  const [manual, setManual] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<number | null>(10);
  const [starting, setStarting] = useState(1);
  const { state, refresh } = useRoom(roomId);

  useEffect(() => {
    ensureSession()
      .then(() => {
        setSpotify(isLoggedIn());
        setRoomId(localStorage.getItem(ROOM_KEY));
        setReady(true);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (!ready) return <p className="pt-20 text-center text-white/60">{error ?? "Loading…"}</p>;

  if (!spotify && !manual) {
    return (
      <div className="space-y-4 pt-10">
        <h1 className="text-3xl font-black">Host a game</h1>
        <p className="text-white/60">
          Connect the Spotify account that&apos;s playing the music. Each new song becomes a round automatically.
        </p>
        <Button onClick={() => startLogin().catch((e: Error) => setError(e.message))}>Connect Spotify</Button>
        <button className="w-full text-sm text-white/50 underline" onClick={() => setManual(true)}>
          No Spotify? Enter songs by hand
        </button>
        <ErrorText error={error} />
      </div>
    );
  }

  if (!roomId) {
    return (
      <div className="space-y-4 pt-10">
        <h1 className="text-3xl font-black">New game</h1>
        <Panel>
          <label className="block text-sm font-semibold text-white/60">Cards needed to win</label>
          <div className="mt-3 flex gap-2">
            {[5, 10, 15, null].map((n) => (
              <button
                key={n ?? "none"}
                onClick={() => setTarget(n)}
                className={`flex-1 rounded-xl border py-3 text-xl font-bold ${target === n ? "border-accent bg-accent/20" : "border-line"}`}
              >
                {n ?? "∞"}
              </button>
            ))}
          </div>
          {target === null && <p className="mt-2 text-sm text-white/50">No limit. You end the game when you&apos;re done.</p>}
        </Panel>
        <Panel>
          <label className="block text-sm font-semibold text-white/60">Starting cards per player</label>
          <div className="mt-3 flex items-center gap-3">
            <button onClick={() => setStarting((n) => Math.max(1, n - 1))} className="h-12 w-12 rounded-xl border border-line text-2xl font-bold">
              −
            </button>
            <input
              value={starting}
              onChange={(e) => setStarting(Math.max(1, Math.min(10, parseInt(e.target.value.replace(/\D/g, ""), 10) || 1)))}
              inputMode="numeric"
              className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-ink text-center text-xl font-bold"
            />
            <button onClick={() => setStarting((n) => Math.min(10, n + 1))} className="h-12 w-12 rounded-xl border border-line text-2xl font-bold">
              +
            </button>
          </div>
          <p className="mt-2 text-sm text-white/50">Everyone gets their own random years from 1950 to 2022.</p>
        </Panel>
        <Button
          onClick={async () => {
            try {
              const room = await createRoom(target, starting);
              localStorage.setItem(ROOM_KEY, room.id);
              setRoomId(room.id);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Create game
        </Button>
        <ErrorText error={error} />
      </div>
    );
  }

  if (!state) return <p className="pt-20 text-center text-white/60">Loading game…</p>;

  return (
    <HostGame
      key={state.room.id}
      state={state}
      refresh={refresh}
      spotify={spotify}
      onNewGame={() => {
        localStorage.removeItem(ROOM_KEY);
        setRoomId(null);
      }}
      onSpotifyLost={() => {
        logout();
        setSpotify(false);
      }}
    />
  );
}

function HostGame({
  state,
  refresh,
  spotify,
  onNewGame,
  onSpotifyLost,
}: {
  state: NonNullable<ReturnType<typeof useRoom>["state"]>;
  refresh: () => Promise<void>;
  spotify: boolean;
  onNewGame: () => void;
  onSpotifyLost: () => void;
}) {
  const { room, round, secret, players, answers } = state;
  const [peek, setPeek] = useState(false);
  const [yearEdit, setYearEdit] = useState("");
  const joinUrl = typeof window === "undefined" ? "" : `${window.location.origin}/play/${room.code}`;
  const finished = room.status === "finished";

  const { error, setError, nowPlaying, yearSource } = useHostDriver({
    state,
    refresh,
    spotify,
    onSpotifyLost,
  });
  const open = round?.status === "open";
  // Each new song starts hidden again.
  useEffect(() => setPeek(false), [round?.id]);

  const leader = standings(state)[0];
  const winner = players.find((p) => p.id === room.winner_player_id);

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between">
        <div>
          <p className="text-sm font-semibold text-white/50">Game code</p>
          <p className="text-5xl font-black tracking-[0.2em] text-accent">{room.code}</p>
        </div>
        <p className="text-right text-sm text-white/50">
          {players.length} player{players.length === 1 ? "" : "s"}
          <br />
          {room.target_cards ? `first to ${room.target_cards} cards` : "no card limit"}
        </p>
      </header>

      {finished ? (
        <Panel className="text-center">
          <p className="text-white/60">Winner</p>
          <p className="mt-1 text-4xl font-black">{winner?.nickname ?? leader?.player.nickname} 🏆</p>
          <Button className="mt-5" onClick={onNewGame}>
            New game
          </Button>
        </Panel>
      ) : round ? (
        <Panel>
          <div className="flex items-center justify-between">
            <p className="font-semibold">
              Song {round.number} · {open ? `${answers.length}/${players.length} locked in` : "revealed"}
            </p>
            <button className="text-sm text-white/50 underline" onClick={() => setPeek((v) => !v)}>
              {peek || !open ? "Hide" : "Peek"}
            </button>
          </div>
          {secret && (peek || !open) && (
            <div className="mt-4 flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {secret.image_url && <img src={secret.image_url} alt="" className="h-16 w-16 rounded-lg" />}
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{secret.title}</p>
                <p className="truncate text-sm text-white/50">{secret.artist}</p>
              </div>
              <p className="text-3xl font-black text-accent-2">{secret.year ?? "…"}</p>
            </div>
          )}
          {secret && peek && open && yearSource && secret.spotify_track_id && (
            <p className="mt-2 text-xs text-white/50">
              {yearSource === "musicbrainz"
                ? "Year checked against MusicBrainz."
                : yearSource === "compilation"
                  ? "This song only turned up on compilations, so the real year may be earlier. Fix it below if you know it."
                  : "Couldn't verify this year, it's Spotify's album date. Fix it below if it's wrong."}
            </p>
          )}
          {secret && peek && open && (
            <form
              className="mt-3 flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const y = parseInt(yearEdit, 10);
                if (!y) return;
                try {
                  await setRoundYear(round.id, y);
                  setYearEdit("");
                  await refresh();
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              <input
                value={yearEdit}
                onChange={(e) => setYearEdit(e.target.value.replace(/\D/g, "").slice(0, 4))}
                inputMode="numeric"
                placeholder="Wrong year? Fix it"
                className="min-w-0 flex-1 rounded-xl border border-line bg-ink px-3 py-2"
              />
              <button className="rounded-xl bg-line px-4 font-semibold">Save</button>
            </form>
          )}
          {open && (
            <Button className="mt-4" onClick={() => closeRound(round.id).then(refresh).catch((e: Error) => setError(e.message))}>
              Reveal now
            </Button>
          )}
          {!open && <p className="mt-3 text-sm text-white/50">Next song starts the next round.</p>}
        </Panel>
      ) : (
        <Panel className="text-center">
          <QrCode value={joinUrl} />
          <p className="mt-3 break-all text-sm text-white/50">{joinUrl}</p>
          <p className="mt-3 text-white/70">
            {spotify ? "Play a song on Spotify to start the first round." : "Add a song below to start the first round."}
          </p>
        </Panel>
      )}

      {!spotify && !finished && <ManualSong roomId={room.id} onAdded={refresh} onError={setError} />}
      {spotify && nowPlaying === "nothing" && !finished && (
        <p className="text-center text-sm text-white/50">Spotify isn&apos;t playing anything right now.</p>
      )}
      <ErrorText error={error} />

      <Panel>
        <h2 className="mb-3 font-bold">Leaderboard</h2>
        <Leaderboard state={state} />
      </Panel>

      {!finished && (
        <a href={`/play/${room.code}`} className={buttonClass("ghost")}>
          Play too
        </a>
      )}
      {round && !finished && (
        <details className="text-center text-sm text-white/50">
          <summary>Invite more people</summary>
          <div className="mt-3">
            <QrCode value={joinUrl} />
          </div>
        </details>
      )}
      {!finished && players.length > 0 && (
        <Button
          variant="ghost"
          onClick={() => {
            if (window.confirm("End the game now? Whoever has the most cards wins.")) {
              endGame(room.id).then(refresh).catch((e: Error) => setError(e.message));
            }
          }}
        >
          End game
        </Button>
      )}
      <button className="w-full text-sm text-white/40 underline" onClick={onNewGame}>
        End this game and start a new one
      </button>
    </div>
  );
}

function ManualSong({ roomId, onAdded, onError }: { roomId: string; onAdded: () => Promise<void>; onError: (e: string) => void }) {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [year, setYear] = useState("");
  return (
    <Panel>
      <h2 className="mb-3 font-bold">Next song</h2>
      <form
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await openRound(roomId, { spotifyTrackId: null, title, artist, year: parseInt(year, 10), imageUrl: null });
            setTitle("");
            setArtist("");
            setYear("");
            await onAdded();
          } catch (err) {
            onError((err as Error).message);
          }
        }}
      >
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" required className="w-full rounded-xl border border-line bg-ink px-3 py-3" />
        <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist" required className="w-full rounded-xl border border-line bg-ink px-3 py-3" />
        <input
          value={year}
          onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder="Year"
          inputMode="numeric"
          required
          className="w-full rounded-xl border border-line bg-ink px-3 py-3"
        />
        <Button type="submit" disabled={year.length !== 4}>
          Start round
        </Button>
      </form>
    </Panel>
  );
}
