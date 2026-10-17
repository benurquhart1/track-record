"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Panel, buttonClass } from "@/components/ui";

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");

  return (
    <div className="space-y-6">
      <header className="pt-8 text-center">
        <h1 className="text-5xl font-black tracking-tight">
          Hitster <span className="text-accent">Party</span>
        </h1>
        <p className="mt-3 text-white/60">Guess the year of whatever&apos;s playing. Build the longest timeline.</p>
      </header>

      <Panel>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) router.push(`/play/${code.trim().toUpperCase()}`);
          }}
          className="space-y-3"
        >
          <label className="block text-sm font-semibold text-white/60" htmlFor="code">
            Join a game
          </label>
          <input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
            placeholder="ABCD"
            autoCapitalize="characters"
            autoComplete="off"
            className="w-full rounded-2xl border border-line bg-ink px-5 py-4 text-center text-3xl font-black tracking-[0.4em] outline-none focus:border-accent"
          />
          <Button type="submit" disabled={code.length < 4}>
            Join
          </Button>
        </form>
      </Panel>

      <Link href="/host" className={buttonClass("ghost")}>
        Host a game
      </Link>
      <Link href="/leaderboard" className="block text-center text-sm text-white/50 underline">
        All-time leaderboard
      </Link>
    </div>
  );
}
