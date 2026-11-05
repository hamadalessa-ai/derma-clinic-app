import * as React from "react";
import { cn } from "@/lib/utils";
import { fieldClasses } from "./input";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(fieldClasses, "min-h-24 px-3 py-2", className)} {...props} />;
}
