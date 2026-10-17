"use client";

import { useState } from "react";
import { PlayerView } from "@/components/PlayerView";
import { DEMO_ME, demoFinish, demoInitialState, demoLockIn, demoOpenRound, demoReveal } from "@/lib/demo";

// A fully clickable player screen with fake data. Nothing here talks to Spotify or Supabase.
export default function DemoPage() {
  const [state, setState] = useState(demoInitialState);
  const [n, setN] = useState(0);
  const open = state.round?.status === "open";

  const next = () => {
    setState((s) => demoOpenRound({ ...s, room: { ...s.room, status: "playing", winner_player_id: null } }, n));
    setN((x) => x + 1);
  };

  const controls: [string, () => void, boolean?][] = [
    ["Lobby", () => setState(demoInitialState()), false],
    ["Next song", next, false],
    ["Reveal", () => setState(demoReveal), !open],
    ["Game over", () => setState(demoFinish), false],
  ];

  return (
    <div>
      <nav className="sticky top-0 z-10 -mx-4 -mt-6 mb-5 border-b border-line bg-ink/95 px-4 py-3 backdrop-blur">
        <p className="mb-2 text-center text-xs uppercase tracking-widest text-white/40">Demo controls</p>
        <div className="mx-auto flex max-w-md gap-2">
          {controls.map(([label, fn, disabled]) => (
            <button
              key={label}
              onClick={fn}
              disabled={disabled}
              className="flex-1 rounded-lg border border-line bg-panel py-2 text-sm font-semibold disabled:opacity-30"
            >
              {label}
            </button>
          ))}
        </div>
      </nav>
      <PlayerView
        key={state.round?.id ?? "lobby"}
        state={state}
        meId={DEMO_ME}
        onLockIn={async (_roundId, slot) => setState((s) => demoLockIn(s, slot))}
      />
    </div>
  );
}
