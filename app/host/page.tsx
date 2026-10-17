"use client";

import { useEffect, useRef, useState } from "react";
import { Leaderboard } from "@/components/Leaderboard";
import { QrCode } from "@/components/QrCode";
import { Button, ErrorText, Panel } from "@/components/ui";
import { closeRound, createRoom, openRound, setRoundYear, standings, useRoom } from "@/lib/game";
import { getNowPlaying, isLoggedIn, logout, startLogin } from "@/lib/spotify";
import { ensureSession } from "@/lib/supabase";
import { cleanTitle } from "@/lib/year";

const ROOM_KEY = "host_room_id";
const POLL_MS = 4000;

async function resolveYear(title: string, artist: string, isrc: string | null, spotifyYear: number | null) {
  const q = new URLSearchParams({ title, artist, ...(isrc ? { isrc } : {}), ...(spotifyYear ? { spotifyYear: String(spotifyYear) } : {}) });
  try {
    const res = await fetch(`/api/year?${q}`);
    const json = await res.json();
    return (json.year as number | null) ?? spotifyYear;
  } catch {
    return spotifyYear;
  }
}

export default function HostPage() {
  const [ready, setReady] = useState(false);
  const [spotify, setSpotify] = useState(false);
  const [manual, setManual] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState(10);
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
            {[5, 10, 15].map((n) => (
              <button
                key={n}
                onClick={() => setTarget(n)}
                className={`flex-1 rounded-xl border py-3 text-xl font-bold ${target === n ? "border-accent bg-accent/20" : "border-line"}`}
              >
                {n}
              </button>
            ))}
          </div>
        </Panel>
        <Button
          onClick={async () => {
            try {
              const room = await createRoom(target);
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
  const [error, setError] = useState<string | null>(null);
  const [peek, setPeek] = useState(false);
  const [autoReveal, setAutoReveal] = useState(true);
  const [yearEdit, setYearEdit] = useState("");
  const [nowPlaying, setNowPlaying] = useState<string | null>(null);
  const lastTrack = useRef<string | null>(secret?.spotify_track_id ?? null);
  const busy = useRef(false);
  const spotifyLost = useRef(onSpotifyLost);
  spotifyLost.current = onSpotifyLost;
  const joinUrl = typeof window === "undefined" ? "" : `${window.location.origin}/play/${room.code}`;
  const finished = room.status === "finished";

  // Watch Spotify; every new track starts a round (which also reveals the previous one).
  useEffect(() => {
    if (!spotify || finished) return;
    let stopped = false;
    const tick = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const np = await getNowPlaying();
        if (stopped) return;
        setNowPlaying(np ? (np.isPlaying ? "playing" : "paused") : "nothing");
        if (!np || !np.isPlaying || np.id === lastTrack.current) return;
        lastTrack.current = np.id;
        const title = cleanTitle(np.title);
        const year = await resolveYear(title, np.artist, np.isrc, np.albumYear);
        if (!year) {
          setError(`Couldn't find a year for "${title}", skipping it.`);
          return;
        }
        await openRound(room.id, { spotifyTrackId: np.id, title, artist: np.artist, year, imageUrl: np.imageUrl });
        setError(null);
        setPeek(false);
        await refresh();
      } catch (e) {
        const msg = (e as Error).message;
        setError(msg);
        if (msg.includes("expired")) spotifyLost.current();
      } finally {
        busy.current = false;
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [spotify, finished, room.id, refresh]);

  // Reveal as soon as everyone has locked in.
  const revealed = useRef<string | null>(null);
  const open = round?.status === "open";
  useEffect(() => {
    if (!autoReveal || !open || !round || players.length === 0) return;
    if (answers.length < players.length || revealed.current === round.id) return;
    revealed.current = round.id;
    closeRound(round.id).then(refresh).catch((e: Error) => setError(e.message));
  }, [autoReveal, open, round, players.length, answers.length, refresh]);

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
          first to {room.target_cards} cards
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
              <p className="text-3xl font-black text-accent-2">{secret.year}</p>
            </div>
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

      {round && !finished && (
        <details className="text-center text-sm text-white/50">
          <summary>Invite more people</summary>
          <div className="mt-3">
            <QrCode value={joinUrl} />
          </div>
        </details>
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
