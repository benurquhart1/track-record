import { standings, type RoomState } from "@/lib/game";

export function Leaderboard({ state, meId }: { state: RoomState; meId?: string }) {
  const rows = standings(state);
  const answered = new Set(state.answers.map((a) => a.player_id));
  const open = state.round?.status === "open";
  return (
    <ol className="space-y-2">
      {rows.map(({ player, cards }, i) => (
        <li
          key={player.id}
          className={`flex items-center gap-3 rounded-xl px-3 py-2 ${player.id === meId ? "bg-accent/15" : "bg-ink"}`}
        >
          <span className="w-6 text-right font-bold text-white/40">{i + 1}</span>
          <span className="flex-1 truncate font-medium">
            {player.nickname}
            {open && answered.has(player.id) && <span className="ml-2 text-xs text-good">locked in</span>}
          </span>
          <span className="font-black tabular-nums">
            {cards}
            <span className="text-sm font-normal text-white/40">/{state.room.target_cards}</span>
          </span>
        </li>
      ))}
      {rows.length === 0 && <li className="text-white/50">No one has joined yet.</li>}
    </ol>
  );
}
