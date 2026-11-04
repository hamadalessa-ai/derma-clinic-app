"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Reloads the page data every minute (the join page opens by itself when it's time). */
export function RefreshEvery({ ms = 60_000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => router.refresh(), ms);
    return () => window.clearInterval(id);
  }, [router, ms]);
  return null;
}
