import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "ghost";

export function buttonClass(variant: Variant = "primary"): string {
  const base = "block w-full rounded-2xl px-5 py-4 text-center text-lg font-semibold transition active:scale-[0.98] disabled:opacity-40";
  return `${base} ${variant === "primary" ? "bg-accent text-white" : "border border-line bg-panel text-white"}`;
}

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`${buttonClass(variant)} ${className}`} {...props} />;
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-3xl border border-line bg-panel p-5 ${className}`}>{children}</section>;
}

export function ErrorText({ error }: { error: string | null }) {
  return error ? <p className="mt-3 text-sm text-bad">{error}</p> : null;
}
