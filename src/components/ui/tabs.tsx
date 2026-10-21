import Link from "next/link";
import { cn } from "@/lib/utils";

/** Tabs as links (?tab=…), so each tab has its own address and works without JavaScript. Wraps on phones. */
export function LinkTabs({
  tabs,
  active,
}: {
  tabs: { key: string; label: string; href: string }[];
  active: string;
}) {
  return (
    <nav className="flex flex-wrap gap-x-1 border-b" role="tablist">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          role="tab"
          aria-selected={t.key === active}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap",
            t.key === active
              ? "border-brand text-brand"
              : "text-muted-foreground hover:text-foreground border-transparent",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
