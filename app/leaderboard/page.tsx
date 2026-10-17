"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Panel } from "@/components/ui";
import { ensureSession, supabase } from "@/lib/supabase";

type Row = { nickname: string; games: number; wins: number; correct: number; guesses: number };

export default function AllTimeLeaderboard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureSession()
      .then(() => supabase().from("alltime_leaderboard").select("*").order("wins", { ascending: false }).order("correct", { ascending: false }).limit(50))
      .then(({ data, error }) => (error ? setError(error.message) : setRows(data)))
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="space-y-5">
      <Link href="/" className="text-sm text-white/50 underline">
        Home
      </Link>
      <h1 className="text-3xl font-black">All-time leaderboard</h1>
      <Panel>
        {error && <p className="text-bad">{error}</p>}
        {!rows && !error && <p className="text-white/60">Loading…</p>}
        {rows && rows.length === 0 && <p className="text-white/60">No games played yet.</p>}
        {rows && rows.length > 0 && (
          <table className="w-full text-left">
            <thead className="text-xs text-white/40">
              <tr>
                <th className="pb-2">Name</th>
                <th className="pb-2 text-right">Wins</th>
                <th className="pb-2 text-right">Games</th>
                <th className="pb-2 text-right">Hit rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.nickname} className="border-t border-line">
                  <td className="py-2 font-medium">{r.nickname}</td>
                  <td className="py-2 text-right font-black">{r.wins}</td>
                  <td className="py-2 text-right">{r.games}</td>
                  <td className="py-2 text-right">{r.guesses ? `${Math.round((100 * r.correct) / r.guesses)}%` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
