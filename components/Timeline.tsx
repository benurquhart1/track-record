import type { Card } from "@/lib/game";
import { yearColor } from "@/lib/colors";

/**
 * A player's cards newest-first, with a "place here" gap between each pair when picking.
 * Slots are numbered oldest-first to match the server: slot i sits just before the i-th oldest
 * card, and slot = cards.length is above the newest.
 */
export function Timeline({
  cards,
  picking,
  selected,
  onPick,
  highlightId,
}: {
  cards: Card[];
  picking: boolean;
  selected: number | null;
  onPick?: (slot: number) => void;
  highlightId?: string | null;
}) {
  const newestFirst = [...cards].sort((a, b) => b.year - a.year);
  const n = cards.length;

  const slot = (s: number) =>
    picking ? (
      <button
        key={`slot-${s}`}
        onClick={() => onPick?.(s)}
        className={`my-1 w-full rounded-xl border-2 border-dashed py-3 text-sm font-semibold transition ${
          selected === s ? "border-accent bg-accent/20 text-white" : "border-line text-white/50"
        }`}
      >
        {selected === s ? "Mystery song goes here" : "Place here"}
      </button>
    ) : null;

  return (
    <ol>
      {slot(n)}
      {newestFirst.map((c, i) => (
        <li key={c.id}>
          <TimelineRow card={c} highlight={c.id === highlightId} />
          {slot(n - 1 - i)}
        </li>
      ))}
    </ol>
  );
}

export function TimelineRow({ card, highlight }: { card: Card; highlight?: boolean }) {
  const color = yearColor(card.year);
  return (
    <div
      className={`my-1 flex items-center gap-3 overflow-hidden rounded-xl border px-3 py-2 ${highlight ? "ring-2 ring-white" : ""}`}
      style={{
        borderColor: color,
        background: `linear-gradient(90deg, ${yearColor(card.year, 45)} 0%, ${yearColor(card.year, 20)} 45%, var(--color-ink) 100%)`,
      }}
    >
      <span className="w-14 shrink-0 text-2xl font-black tabular-nums text-white drop-shadow">{card.year}</span>
      {card.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={card.image_url} alt="" className="h-11 w-11 shrink-0 rounded-md object-cover shadow" />
      ) : (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-black/30 text-lg">♪</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{card.title}</span>
        {card.artist && <span className="block truncate text-sm text-white/60">{card.artist}</span>}
      </span>
    </div>
  );
}
