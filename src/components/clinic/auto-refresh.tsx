"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Near-real-time updates: every few seconds ask the server for a tiny "version" of the
 * data shown; if it changed (someone else booked/moved/checked in), reload the page data.
 * Simple polling works on Vercel's free plan (no websockets needed).
 */
export function AutoRefresh({
  versionUrl,
  intervalMs = 15000,
}: {
  versionUrl: string;
  intervalMs?: number;
}) {
  const router = useRouter();
  const last = useRef<string | null>(null);
  useEffect(() => {
    let stopped = false;
    async function tick() {
      if (document.hidden) return;
      try {
        const res = await fetch(versionUrl, { cache: "no-store" });
        if (!res.ok) return;
        const { version } = (await res.json()) as { version: string };
        if (last.current !== null && version !== last.current && !stopped) router.refresh();
        last.current = version;
      } catch {
        // offline for a moment: try again next tick
      }
    }
    tick();
    const id = setInterval(tick, intervalMs);
    const onVisible = () => !document.hidden && tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [versionUrl, intervalMs, router]);
  return null;
}
