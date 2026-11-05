import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const noticeVariants = cva("rounded-xl px-3.5 py-3 text-sm leading-[22px] animate-fade-in", {
  variants: {
    tone: {
      info: "bg-info text-info-foreground",
      warning: "bg-warning text-warning-foreground",
      success: "bg-success text-success-foreground",
      danger: "bg-danger text-danger-foreground",
    },
  },
  defaultVariants: { tone: "info" },
});

/** A message about this page (unsigned consent, demo mode, a rule). Results of an action: a toast. */
export function Notice({
  className,
  tone,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof noticeVariants>) {
  return <div className={cn(noticeVariants({ tone }), className)} {...props} />;
}
