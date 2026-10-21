import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const noticeVariants = cva("rounded-md px-3 py-2 text-sm", {
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

/** A coloured message box (demo notices, errors, confirmations). */
export function Notice({
  className,
  tone,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof noticeVariants>) {
  return <div className={cn(noticeVariants({ tone }), className)} {...props} />;
}
