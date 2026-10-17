"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Card } from "@/lib/game";
import { yearColor } from "@/lib/colors";

/**
 * A player's cards newest-first. While picking, a mystery card can be dragged into the timeline,
 * or the player taps anywhere on it and the card drops into the nearest gap. The other cards stay
 * packed together; only the chosen spot opens up. Mid-drag nothing moves: the card's old spot
 * stays put as a faded outline and a glowing line shows where it will land on release.
 *
 * Slots are numbered oldest-first to match the server: slot i sits just before the i-th oldest
 * card, and slot = cards.length is above the newest.
 */
export function Timeline({
  cards,
  picking,
  selected,
  onPick,
  onSubmit,
  submitting,
  highlightId,
}: {
  cards: Card[];
  picking: boolean;
  selected: number | null;
  onPick?: (slot: number) => void;
  /** Shows a submit button on the placed card. */
  onSubmit?: () => void;
  submitting?: boolean;
  highlightId?: string | null;
}) {
  const newestFirst = [...cards].sort((a, b) => b.year - a.year);
  const n = cards.length;
  const listRef = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; startY: number; slot: number } | null>(null);

  // Rows whose middle is above the pointer sit above the drop point; the rest go below it.
  const slotAt = (clientY: number): number => {
    const rows = listRef.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [];
    let above = 0;
    rows.forEach((row) => {
      const r = row.getBoundingClientRect();
      if (clientY > r.top + r.height / 2) above++;
    });
    return n - above;
  };

  const startDrag = (e: ReactPointerEvent) => {
    e.preventDefault();
    setDrag({ x: e.clientX, y: e.clientY, startY: e.clientY, slot: selected ?? slotAt(e.clientY) });
  };

  // Track the pointer on the window: the card under the finger re-renders as a floating copy
  // mid-drag, so listeners on the card itself would stop firing.
  const lastDragEnd = useRef(0);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const dragActive = drag !== null;
  useEffect(() => {
    if (!dragActive) return;
    const move = (e: PointerEvent) =>
      setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY, slot: slotAt(e.clientY) } : d));
    const up = () => {
      const d = dragRef.current;
      if (d && Math.abs(d.y - d.startY) > 6) {
        lastDragEnd.current = Date.now();
        onPick?.(d.slot);
      }
      setDrag(null);
    };
    const cancel = () => setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
    // slotAt and onPick only read refs/props that are stable for the length of one drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragActive]);

  const dragging = drag !== null && Math.abs(drag.y - drag.startY) > 6;
  // Where the mystery card shows in the newest-first list (display index), if anywhere. It keeps
  // its place during a drag so the layout doesn't jump.
  const shownAt = picking && selected !== null ? n - selected : null;
  // No line when the card would land back where it already is: its outline marks that spot.
  const indicatorAt = dragging && drag.slot !== selected ? n - drag.slot : null;
  const homeTarget = dragging && drag.slot === selected;

  const mysteryCard = (ghost: boolean) => (
    <div
      onPointerDown={ghost ? undefined : startDrag}
      onClick={(e) => e.stopPropagation()}
      className={`my-1 flex cursor-grab touch-none select-none items-center gap-3 rounded-xl border-2 border-dashed border-accent bg-accent/15 px-3 py-2 active:cursor-grabbing ${
        dragging && !ghost ? (homeTarget ? "opacity-60 shadow-[0_0_12px_var(--color-accent)]" : "opacity-30") : ""
      }`}
    >
      <span className="w-14 shrink-0 text-2xl font-black text-accent">????</span>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-accent/30 text-xl font-black">?</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">Mystery song</span>
        <span className="block text-sm text-white/60">{selected === null ? "Drag it into your timeline, or tap a gap" : "Drag to move it"}</span>
      </span>
      {onSubmit && selected !== null && !ghost ? (
        <button
          type="button"
          disabled={submitting}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onSubmit();
          }}
          className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-bold text-white disabled:opacity-40"
        >
          Submit
        </button>
      ) : (
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-white/50">
          <path d="M6 7h8M6 10h8M6 13h8" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
  const mystery = mysteryCard(false);

  const indicator = (i: number) =>
    indicatorAt === i ? (
      <li key={`ind-${i}`} aria-hidden="true" className="relative h-0">
        <span className="absolute inset-x-0 -top-px h-1 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_12px_var(--color-accent)]" />
      </li>
    ) : null;

  return (
    <div>
      {picking && selected === null && <div className="mb-3">{mystery}</div>}
      <ol
        ref={listRef}
        onClick={picking ? (e) => Date.now() - lastDragEnd.current > 300 && onPick?.(slotAt(e.clientY)) : undefined}
        className={picking ? "cursor-pointer" : undefined}
      >
        {newestFirst.map((c, i) => [
          indicator(i),
          shownAt === i ? <li key="mystery-slot">{mystery}</li> : null,
          <li key={c.id} data-row>
            <TimelineRow card={c} highlight={c.id === highlightId} />
          </li>,
        ])}
        {indicator(n)}
        {shownAt === n ? <li key="mystery-slot">{mystery}</li> : null}
      </ol>
      {dragging && (
        <div className="pointer-events-none fixed left-4 right-4 z-50 mx-auto max-w-md rounded-xl bg-ink shadow-2xl shadow-black" style={{ top: drag.y - 30 }}>
          {mysteryCard(true)}
        </div>
      )}
    </div>
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
