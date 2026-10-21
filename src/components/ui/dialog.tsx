"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/** Modal dialog (native <dialog>: accessible, Esc to close, works on tablets and phones). */
export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
  closeLabel = "Close",
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  closeLabel?: string;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  // Only a close the USER started (Esc, close button) should call onClose — not one we do
  // ourselves because `open` became false (e.g. swapping to another dialog).
  const wanted = React.useRef(open);
  React.useEffect(() => {
    wanted.current = open;
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={() => {
        if (wanted.current) onClose();
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={cn(
        "bg-card text-card-foreground shadow-card backdrop:bg-foreground/40 m-auto max-h-[92vh] w-[min(100vw-1rem,40rem)] overflow-y-auto rounded-xl border p-0",
        className,
      )}
    >
      {open && (
        <div className="flex flex-col gap-4 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-semibold">{title}</h2>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label={closeLabel}>
              <X />
            </Button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
