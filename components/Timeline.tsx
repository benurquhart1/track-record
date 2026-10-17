import type { Card } from "@/lib/game";

/**
 * A player's cards oldest-first, with a "place here" gap between each pair when picking.
 * Slot i sits just before card i (slot = cards.length is after the last card).
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
  const slot = (i: number) =>
    picking ? (
      <button
        key={`slot-${i}`}
        onClick={() => onPick?.(i)}
        className={`my-1 w-full rounded-xl border-2 border-dashed py-3 text-sm font-semibold transition ${
          selected === i ? "border-accent bg-accent/20 text-white" : "border-line text-white/50"
        }`}
      >
        {selected === i ? "Mystery song goes here" : "Place here"}
      </button>
    ) : null;

  return (
    <ol>
      {cards.map((c, i) => (
        <li key={c.id}>
          {slot(i)}
          <div
            className={`my-1 flex items-center gap-4 rounded-xl border bg-ink px-4 py-3 ${
              c.id === highlightId ? "border-good" : "border-line"
            }`}
          >
            <span className="w-14 text-2xl font-black tabular-nums text-accent-2">{c.year}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{c.title}</span>
              {c.artist && <span className="block truncate text-sm text-white/50">{c.artist}</span>}
            </span>
          </div>
        </li>
      ))}
      {slot(cards.length)}
    </ol>
  );
}
