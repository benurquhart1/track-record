"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { finishLogin } from "@/lib/spotify";

export default function Callback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) {
      setError(params.get("error") === "access_denied" ? "Spotify login was cancelled." : "Missing login code.");
      return;
    }
    finishLogin(code)
      .then(() => router.replace("/host"))
      .catch((e: Error) => setError(e.message));
  }, [router]);

  return (
    <p className="pt-20 text-center text-white/60">
      {error ?? "Connecting to Spotify…"}
      {error && (
        <a href="/host" className="mt-4 block text-accent underline">
          Back
        </a>
      )}
    </p>
  );
}
