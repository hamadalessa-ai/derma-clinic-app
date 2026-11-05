import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * What a list shows when it is empty: an icon, what is empty, and the next step
 * (e.g. "No appointments today" + "Book one").
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col items-center gap-2 px-4 py-12 text-center", className)}
      data-testid="empty-state"
    >
      <div className="bg-brand-soft text-brand-strong flex size-11 items-center justify-center rounded-full [&_svg]:size-5">
        {icon}
      </div>
      <p className="text-[17px] leading-[26px] font-semibold">{title}</p>
      {hint && <p className="text-muted-foreground max-w-sm text-sm">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
