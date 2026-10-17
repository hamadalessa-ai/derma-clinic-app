"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileLock2, LayoutDashboard, Shield, Sparkles, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS = {
  dashboard: LayoutDashboard,
  patients: Users,
  services: Sparkles,
  clinicalNotes: FileLock2,
  platform: Shield,
} as const;

export function NavLinks({
  items,
  orientation,
}: {
  items: { href: string; key: keyof typeof ICONS; label: string }[];
  orientation: "vertical" | "horizontal";
}) {
  const pathname = usePathname();
  return (
    <nav
      className={cn(
        "flex gap-1",
        orientation === "vertical" ? "flex-col" : "overflow-x-auto px-2 pb-2",
      )}
    >
      {items.map((item) => {
        const Icon = ICONS[item.key];
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              active ? "bg-brand text-white" : "text-foreground hover:bg-accent",
            )}
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
