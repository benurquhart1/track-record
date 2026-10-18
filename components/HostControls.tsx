"use client";

import { useState } from "react";
import { Button, ErrorText, Panel } from "@/components/ui";
import { TargetPicker, Toggle } from "@/components/Settings";
import { lockedInIds, updateRoomSettings, type RoomState } from "@/lib/game";
import { canSkip, startLogin } from "@/lib/spotify";

/** "3 of 5 locked in" with a dot per player, green once everyone is in. */
export function LockedInCount({ state, className = "" }: { state: RoomState; className?: string }) {
  const done = lockedInIds(state);
  const total = state.players.length;
  const all = total > 0 && done.size >= total;
  return (
    <div className={`flex items-center justify-center gap-3 ${className}`}>
      <span className={`text-lg font-black tabular-nums ${all ? "text-good" : ""}`}>
        {done.size}/{total} locked in
      </span>
      <span className="flex gap-1">
        {state.players.map((p) => (
          <span key={p.id} title={p.nickname} className={`h-2.5 w-2.5 rounded-full ${done.has(p.id) ? "bg-good" : "bg-line"}`} />
        ))}
      </span>
    </div>
  );
}

/** Skips the song on Spotify, or asks the host to reconnect once to allow it. */
export function NextSongButton({ onNext, className = "" }: { onNext: () => Promise<unknown>; className?: string }) {
  const [busy, setBusy] = useState(false);
  if (!canSkip()) {
    return (
      <Button variant="ghost" className={className} onClick={() => startLogin()}>
        Reconnect Spotify to skip songs from here
      </Button>
    );
  }
  return (
    <Button
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await onNext();
        setBusy(false);
      }}
    >
      Next song ⏭
    </Button>
  );
}

export function HostSettings({ state, refresh, spotify }: { state: RoomState; refresh: () => Promise<void>; spotify: boolean }) {
  const { room } = state;
  const [target, setTarget] = useState<number | null>(room.target_cards);
  const [autoNext, setAutoNext] = useState(!!room.auto_next);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const changed = target !== room.target_cards || autoNext !== !!room.auto_next;
  return (
    <div className="space-y-4">
      <Panel>
        <TargetPicker value={target} onChange={setTarget} />
      </Panel>
      <Panel className="space-y-2">
        <Toggle
          on={autoNext}
          onChange={setAutoNext}
          label="Next song when everyone's in"
          hint="Skips to the next song on Spotify a few seconds after the last guess."
        />
        {autoNext && spotify && !canSkip() && (
          <p className="text-sm text-bad">Reconnect Spotify (on the Game tab) so the game is allowed to skip songs.</p>
        )}
        {autoNext && !spotify && <p className="text-sm text-white/50">Needs Spotify connected.</p>}
      </Panel>
      <Button
        disabled={!changed}
        onClick={async () => {
          try {
            await updateRoomSettings(room.id, target, autoNext);
            await refresh();
            setError(null);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        {saved ? "Saved ✓" : "Save settings"}
      </Button>
      <ErrorText error={error} />
    </div>
  );
}
