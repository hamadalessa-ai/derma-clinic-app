import * as React from "react";
import { cn } from "@/lib/utils";

export const fieldClasses =
  "border-input bg-card placeholder:text-muted-foreground flex w-full rounded-lg border text-[15px] transition-colors focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand/30 aria-invalid:border-destructive disabled:opacity-50";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(fieldClasses, "h-10 px-3", className)} {...props} />;
}
