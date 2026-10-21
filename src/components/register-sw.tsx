"use client";

import { useEffect } from "react";

/** Registers the (network-only) service worker so the app can be installed and, in Phase 2, receive push. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    }
  }, []);
  return null;
}
