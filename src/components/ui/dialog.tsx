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
  placement = "center",
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  closeLabel?: string;
  /** "bottom": a sheet that slides up from the bottom edge (phone menus). */
  placement?: "center" | "bottom";
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
        "bg-card text-card-foreground shadow-overlay backdrop:bg-foreground/35 max-h-[92vh] overflow-y-auto border-0 p-0 backdrop:backdrop-blur-[1px]",
        // Phones: always a bottom sheet (easy to reach with a thumb). Larger screens: centred.
        "animate-sheet-in mx-0 mt-auto mb-0 w-full max-w-none rounded-t-2xl pb-[env(safe-area-inset-bottom)]",
        placement === "bottom"
          ? ""
          : "sm:m-auto sm:w-[min(100vw-2rem,40rem)] sm:rounded-2xl sm:pb-0",
        className,
      )}
    >
      {open && (
        <div className="flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-[17px] leading-[26px] font-semibold">{title}</h2>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground -me-2 -mt-1"
              onClick={onClose}
              aria-label={closeLabel}
            >
              <X />
            </Button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
