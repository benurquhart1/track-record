"use client";

/** A whole-number picker with − and + buttons. */
export function Stepper({ value, onChange, min, max }: { value: number; onChange: (n: number) => void; min: number; max: number }) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={() => onChange(clamp(value - 1))} className="h-12 w-12 rounded-xl border border-line text-2xl font-bold">
        −
      </button>
      <input
        value={value}
        onChange={(e) => onChange(clamp(parseInt(e.target.value.replace(/\D/g, ""), 10) || min))}
        inputMode="numeric"
        className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-ink text-center text-xl font-bold"
      />
      <button type="button" onClick={() => onChange(clamp(value + 1))} className="h-12 w-12 rounded-xl border border-line text-2xl font-bold">
        +
      </button>
    </div>
  );
}

export function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (on: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="flex w-full items-center gap-3 text-left">
      <span className="flex-1">
        <span className="block font-semibold">{label}</span>
        {hint && <span className="block text-sm text-white/50">{hint}</span>}
      </span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? "bg-accent" : "bg-line"}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-6" : "left-1"}`} />
      </span>
    </button>
  );
}

/** Cards needed to win: any whole number, or no limit (null). */
export function TargetPicker({ value, onChange }: { value: number | null; onChange: (n: number | null) => void }) {
  return (
    <div className="space-y-3">
      <label className="block text-sm font-semibold text-white/60">Cards needed to win</label>
      {value !== null && <Stepper value={value} onChange={onChange} min={2} max={100} />}
      <Toggle on={value === null} onChange={(on) => onChange(on ? null : 10)} label="No limit" hint="You end the game when you're done." />
    </div>
  );
}
