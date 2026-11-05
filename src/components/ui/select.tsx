import * as React from "react";
import { cn } from "@/lib/utils";
import { fieldClasses } from "./input";

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn(fieldClasses, "h-10 px-2", className)} {...props} />;
}
