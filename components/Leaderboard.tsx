import { standings, type RoomState } from "@/lib/game";
import { playerStats, type PlayerStats } from "@/lib/stats";

export function Leaderboard({ state, meId }: { state: RoomState; meId?: string }) {
  const rows = standings(state);
  const answered = new Set(state.answers.map((a) => a.player_id));
  const open = state.round?.status === "open";
  return (
    <ol className="space-y-2">
      {rows.map(({ player, cards }, i) => (
        <li key={player.id} className={`rounded-xl px-3 py-2 ${player.id === meId ? "bg-accent/15" : "bg-ink"}`}>
          <div className="flex items-center gap-3">
            <span className="w-6 text-right font-bold text-white/40">{i + 1}</span>
            <span className="flex-1 truncate font-medium">
              {player.nickname}
              {open && answered.has(player.id) && <span className="ml-2 text-xs text-good">locked in</span>}
            </span>
            <span className="font-black tabular-nums">
              {cards}
              {state.room.target_cards && <span className="text-sm font-normal text-white/40">/{state.room.target_cards}</span>}
            </span>
          </div>
          <StatsLine stats={playerStats(state, player.id)} />
        </li>
      ))}
      {rows.length === 0 && <li className="text-white/50">No one has joined yet.</li>}
    </ol>
  );
}

const years = (x: number | null) => (x === null ? "–" : `${Math.round(x * 10) / 10}y`);

function StatsLine({ stats }: { stats: PlayerStats }) {
  if (stats.guessed === 0 && stats.skipped === 0) return null;
  const items: [string, string | number][] = [
    ["guessed", stats.guessed],
    ["right", stats.correct],
    ["skipped", stats.skipped],
    ["avg gap", years(stats.avgGap)],
    ["avg miss", years(stats.avgMiss)],
  ];
  return (
    <dl className="mt-1 flex flex-wrap gap-x-3 pl-9 text-xs text-white/50">
      {items.map(([label, value]) => (
        <div key={label} className="flex gap-1">
          <dt>{label}</dt>
          <dd className="font-semibold tabular-nums text-white/80">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
