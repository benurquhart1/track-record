"use client";

import { useEffect, useRef, useState } from "react";
import { closeRound, openRound, setRoundYear, type RoomState } from "./game";
import { getNowPlaying, getQueue } from "./spotify";
import { cleanTitle } from "./year";

const POLL_MS = 1500;
/** How often to look ahead in the Spotify queue and pre-fetch the next songs' years. */
const QUEUE_MS = 10_000;

type YearResult = { year: number | null; source: string };
type Track = { id: string; title: string; artist: string; isrc: string | null; albumYear: number | null };

// Year lookups by Spotify track id. Queued songs are looked up ahead of time so their round
// starts with the year already known; otherwise the round starts without it and the server
// fills it in when its lookup finishes (guesses made meanwhile wait for it).
const yearCache = new Map<string, Promise<YearResult>>();
const yearsKnown = new Map<string, YearResult>();
function yearFor(t: Track): Promise<YearResult> {
  let p = yearCache.get(t.id);
  if (!p) {
    p = resolveYear(cleanTitle(t.title), t.artist, t.isrc, t.albumYear).then((r) => {
      yearsKnown.set(t.id, r);
      return r;
    });
    yearCache.set(t.id, p);
  }
  return p;
}

export async function resolveYear(title: string, artist: string, isrc: string | null, spotifyYear: number | null): Promise<YearResult> {
  const q = new URLSearchParams({ title, artist, ...(isrc ? { isrc } : {}), ...(spotifyYear ? { spotifyYear: String(spotifyYear) } : {}) });
  try {
    const res = await fetch(`/api/year?${q}`);
    const json = await res.json();
    return { year: (json.year as number | null) ?? spotifyYear, source: json.source as string };
  } catch {
    return { year: spotifyYear, source: "spotify" };
  }
}

/**
 * Runs the game from the host's device: watches Spotify and starts a round for every new song,
 * fills in years, and reveals once everyone has guessed. Used on the host page and on the
 * player page when the host is playing too, so whichever one is on screen keeps the game going.
 */
export function useHostDriver({
  state,
  refresh,
  spotify,
  autoReveal = true,
  onSpotifyLost,
}: {
  state: RoomState;
  refresh: () => Promise<void>;
  spotify: boolean;
  autoReveal?: boolean;
  onSpotifyLost: () => void;
}) {
  const { room, round, secret, players, answers } = state;
  const [error, setError] = useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = useState<string | null>(null);
  const [yearSource, setYearSource] = useState<string | null>(null);
  const lastTrack = useRef<string | null>(secret?.spotify_track_id ?? null);
  // Another screen of the host's may have started this song's round already.
  if (secret?.spotify_track_id) lastTrack.current = lastTrack.current ?? secret.spotify_track_id;
  const latestTrack = useRef(secret?.spotify_track_id ?? null);
  latestTrack.current = secret?.spotify_track_id ?? null;
  const busy = useRef(false);
  const spotifyLost = useRef(onSpotifyLost);
  spotifyLost.current = onSpotifyLost;
  const finished = room.status === "finished";

  // Watch Spotify; every new track starts a round (which also reveals the previous one).
  useEffect(() => {
    if (!spotify || finished) return;
    let stopped = false;
    const tick = async () => {
      // Only the screen in front of the host drives the game, so two open screens don't both start rounds.
      if (busy.current || document.visibilityState !== "visible") return;
      busy.current = true;
      try {
        const np = await getNowPlaying();
        if (stopped) return;
        setNowPlaying(np ? (np.isPlaying ? "playing" : "paused") : "nothing");
        if (!np || !np.isPlaying || np.id === lastTrack.current || np.id === latestTrack.current) return;
        lastTrack.current = np.id;
        const title = cleanTitle(np.title);
        void yearFor(np);
        const known = yearsKnown.get(np.id);
        setYearSource(known?.source ?? null);
        const song = { spotifyTrackId: np.id, title, artist: np.artist, year: known?.year ?? null, imageUrl: np.imageUrl };
        const token = known ? undefined : crypto.randomUUID();
        const opened = await openRound(room.id, song, token).catch((e: Error) => {
          // Databases without the 0004 migration don't take a token; the host fills the year instead.
          if (!token || !/p_fill_token|function/i.test(e.message)) throw e;
          return openRound(room.id, song);
        });
        setError(null);
        await refresh();
        // The server looks the year up and fills it in, so it lands even if this phone locks.
        if (!known && opened) {
          fetch("/api/round-year", {
            method: "POST",
            keepalive: true,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ roundId: opened.id, token, title, artist: np.artist, isrc: np.isrc, spotifyYear: np.albumYear }),
          })
            .then((res) => res.json())
            .then(async ({ year, source, filled }: YearResult & { filled: boolean }) => {
              setYearSource(source);
              if (year && !filled) await setRoundYear(opened.id, year);
              if (!year) setError(`Couldn't find a year for "${title}". Peek and enter it below.`);
              await refresh();
            })
            .catch((e: Error) => setError(e.message));
        }
      } catch (e) {
        const msg = (e as Error).message;
        setError(msg);
        if (msg.includes("expired")) spotifyLost.current();
      } finally {
        busy.current = false;
      }
    };
    const lookAhead = () =>
      getQueue()
        .then((next) => next.forEach((t) => void yearFor(t)))
        .catch(() => {});
    tick();
    lookAhead();
    const id = setInterval(tick, POLL_MS);
    const ahead = setInterval(lookAhead, QUEUE_MS);
    return () => {
      stopped = true;
      clearInterval(id);
      clearInterval(ahead);
    };
  }, [spotify, finished, room.id, refresh]);

  // Keep the screen on: the host's phone drives the game, and a locked phone stops spotting new songs.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const grab = () => {
      if (document.visibilityState === "visible" && "wakeLock" in navigator) {
        navigator.wakeLock.request("screen").then((l) => (lock = l)).catch(() => {});
      }
    };
    grab();
    document.addEventListener("visibilitychange", grab);
    return () => {
      document.removeEventListener("visibilitychange", grab);
      lock?.release().catch(() => {});
    };
  }, []);

  // Backstop for a round still missing its year (say the server's fill never got sent): look it
  // up here and set it.
  const rescued = useRef<string | null>(null);
  const missingYear = secret && secret.year === null ? secret : null;
  useEffect(() => {
    if (!missingYear || rescued.current === missingYear.round_id) return;
    const id = setTimeout(async () => {
      rescued.current = missingYear.round_id;
      const { year, source } = await resolveYear(missingYear.title, missingYear.artist, null, null);
      setYearSource(source);
      if (year) await setRoundYear(missingYear.round_id, year).catch((e: Error) => setError(e.message));
      else setError(`Couldn't find a year for "${missingYear.title}". Peek and enter it below.`);
      await refresh();
    }, 15_000);
    return () => clearTimeout(id);
    // Keyed on the round, not the object: the room reloads every few seconds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingYear?.round_id, refresh]);

  // Reveal as soon as everyone has locked in.
  const revealed = useRef<string | null>(null);
  const open = round?.status === "open";
  useEffect(() => {
    if (!autoReveal || !open || !round || players.length === 0) return;
    if (answers.length < players.length || revealed.current === round.id) return;
    revealed.current = round.id;
    closeRound(round.id).then(refresh).catch((e: Error) => setError(e.message));
  }, [autoReveal, open, round, players.length, answers.length, refresh]);

  return { error, setError, nowPlaying, yearSource, setYearSource };
}
