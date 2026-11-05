"use client";

import * as React from "react";
import { CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "success" | "info";
interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
}

const ToastContext = React.createContext<(message: string, tone?: Tone) => void>(() => {});

/** Shows a short confirmation of what the person just did ("Saved", "Checked in"). */
export function useToast() {
  return React.useContext(ToastContext);
}

/**
 * Toasts: bottom centre on phones (above the tab bar), bottom end on desktop; one at a time,
 * 4 seconds each. Errors are never toasts: they stay next to what went wrong.
 */
export function Toaster({ children }: { children: React.ReactNode }) {
  const [item, setItem] = React.useState<ToastItem | null>(null);
  const timer = React.useRef<number | null>(null);
  const show = React.useCallback((message: string, tone: Tone = "success") => {
    if (timer.current) window.clearTimeout(timer.current);
    setItem({ id: Date.now(), message, tone });
    timer.current = window.setTimeout(() => setItem(null), 4000);
  }, []);
  React.useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  const Icon = item?.tone === "info" ? Info : CheckCircle2;
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 md:inset-x-auto md:end-6 md:bottom-6 md:justify-end"
        role="status"
        aria-live="polite"
      >
        {item && (
          <div
            key={item.id}
            data-testid="toast"
            className="animate-toast-in bg-card text-card-foreground shadow-raised pointer-events-auto flex max-w-md min-w-64 items-center gap-2.5 rounded-xl border px-4 py-3 text-sm"
          >
            <Icon
              className={cn(
                "size-5 shrink-0",
                item.tone === "success" ? "text-success-foreground" : "text-info-foreground",
              )}
              aria-hidden
            />
            <span>{item.message}</span>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
