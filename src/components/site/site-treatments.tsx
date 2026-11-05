"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarCheck, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TreatmentSilo {
  key: string;
  dept: string;
  name: string;
  items: { name: string; href: string | null }[];
  /** Where "Book" goes for this category (the booking platform, or WhatsApp when not online). */
  cta: { label: string; href: string; external: boolean };
}

/**
 * Procedures in one compact panel: a row of categories (Laser, Injectables, …); the chosen one
 * shows its treatments as chips. Treatments bookable online open booking directly.
 */
export function SiteTreatments({ silos }: { silos: TreatmentSilo[] }) {
  const [key, setKey] = useState(silos[0]?.key);
  const s = silos.find((x) => x.key === key) ?? silos[0];
  if (!s) return null;

  return (
    <div className="bg-site-mist overflow-hidden rounded-2xl">
      <div
        className="border-site-line flex [scrollbar-width:none] gap-1 overflow-x-auto border-b px-3"
        role="tablist"
      >
        {silos.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={x.key === s.key}
            onClick={() => setKey(x.key)}
            className={cn(
              "relative h-14 shrink-0 px-4 text-sm font-semibold whitespace-nowrap transition-colors",
              x.key === s.key
                ? "text-site-primary after:bg-site-primary after:absolute after:inset-x-4 after:bottom-0 after:h-0.5"
                : "text-site-subtle hover:text-site-ink",
            )}
            data-testid={`silo-tab-${x.key}`}
          >
            {x.name}
          </button>
        ))}
      </div>
      <div
        className="flex flex-col gap-6 p-6 lg:flex-row lg:items-start lg:gap-10 lg:p-8"
        role="tabpanel"
      >
        <ul className="flex flex-1 flex-wrap gap-2.5" data-testid="site-silo">
          {s.items.map((it) =>
            it.href ? (
              <li key={it.name}>
                <Link
                  href={it.href}
                  className="border-site-primary/25 bg-card text-site-primary hover:bg-site-primary hover:text-site-ivory inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors"
                >
                  {it.name}
                  <CalendarCheck className="size-3.5" aria-hidden />
                </Link>
              </li>
            ) : (
              <li
                key={it.name}
                className="bg-card text-site-slate inline-flex h-10 items-center rounded-full px-4 text-sm"
              >
                {it.name}
              </li>
            ),
          )}
        </ul>
        {s.cta.external ? (
          <a
            href={s.cta.href}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-site-primary text-site-ivory hover:bg-site-primary-hover inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition-colors"
          >
            <MessageCircle className="size-4" aria-hidden />
            {s.cta.label}
          </a>
        ) : (
          <Link
            href={s.cta.href}
            className="bg-site-primary text-site-ivory hover:bg-site-primary-hover inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition-colors"
          >
            <CalendarCheck className="size-4" aria-hidden />
            {s.cta.label}
          </Link>
        )}
      </div>
    </div>
  );
}
