import { cn } from "@/lib/utils";

/** A grey placeholder shaped like the content that is loading (gently pulsing). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("bg-muted animate-pulse rounded-md", className)} />;
}
