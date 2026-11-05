import * as React from "react";
import { cn } from "@/lib/utils";

/** A big tappable option (phone-first): service, doctor, day, time. */
export function Choice({
  selected,
  className,
  ...props
}: React.ComponentProps<"button"> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "border-input bg-card hover:bg-accent focus-visible:ring-ring flex min-h-11 min-w-0 cursor-pointer flex-col items-start justify-center gap-0.5 rounded-lg border px-3 py-2 text-start text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40",
        selected && "border-brand bg-brand/10 ring-brand ring-1",
        className,
      )}
      {...props}
    />
  );
}

/** One step of a public flow: a numbered heading, and either the picker or a summary with "change". */
export function Step({
  n,
  title,
  done,
  summary,
  changeLabel,
  onChange,
  children,
  testId,
}: {
  n: number;
  title: string;
  done: boolean;
  summary?: React.ReactNode;
  changeLabel: string;
  onChange?: () => void;
  children?: React.ReactNode;
  testId?: string;
}) {
  return (
    <section className="bg-card rounded-xl border p-4" data-testid={testId}>
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            done ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {n}
        </span>
        <h2 className="min-w-0 flex-1 text-sm font-semibold">{title}</h2>
        {done && onChange && (
          <button
            type="button"
            className="text-brand-strong shrink-0 text-xs font-medium underline-offset-2 hover:underline"
            onClick={onChange}
          >
            {changeLabel}
          </button>
        )}
      </div>
      {done && summary && <div className="text-muted-foreground mt-2 ps-10 text-sm">{summary}</div>}
      {!done && children && <div className="mt-3">{children}</div>}
    </section>
  );
}
