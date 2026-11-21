"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  ChartColumn,
  Crown,
  FileLock2,
  Inbox,
  FlaskConical,
  LayoutDashboard,
  LifeBuoy,
  BellRing,
  MessageCircle,
  Smartphone,
  Settings,
  SlidersHorizontal,
  Shield,
  Sparkles,
  Stethoscope,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const NAV_ICONS = {
  dashboard: LayoutDashboard,
  patients: Users,
  services: Sparkles,
  clinicalNotes: FileLock2,
  platform: Shield,
  myDay: Stethoscope,
  calendar: CalendarDays,
  requests: Inbox,
  settings: Settings,
  setup: SlidersHorizontal,
  reports: ChartColumn,
  whatsapp: MessageCircle,
  simulator: Smartphone,
  account: BellRing,
  help: LifeBuoy,
  labCases: FlaskConical,
  memberships: Crown,
} as const;

export function NavLinks({
  items,
  orientation,
}: {
  items: { href: string; key: keyof typeof NAV_ICONS; label: string }[];
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
        const Icon = NAV_ICONS[item.key];
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              active
                ? "bg-brand-soft text-brand-strong"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
