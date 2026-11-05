"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarCheck, MessageCircle, Sparkles, Syringe, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TreatmentSilo {
  key: string;
  dept: string;
  name: string;
  items: { name: string; href: string | null }[];
  /** Where "Book" goes for this category (the booking platform, or WhatsApp when not online). */
  cta: { label: string; href: string; external: boolean };
}

const ICONS: Record<string, typeof Zap> = { laser: Zap, injectables: Syringe };

/**
 * Treatments browsed by category (Laser, Injectables, Skin, Hair, Face, Body, Dental) instead of
 * one long list; department tabs on top. Treatments bookable online link straight into booking.
 */
export function SiteTreatments({
  silos,
  depts,
  labels,
}: {
  silos: TreatmentSilo[];
  depts: { key: string; name: string }[];
  labels: { all: string; book: string; count: string };
}) {
  const [dept, setDept] = useState<string>("all");
  const shown = silos.filter((s) => dept === "all" || s.dept === dept);

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap gap-2" role="tablist">
        {[{ key: "all", name: labels.all }, ...depts].map((d) => (
          <button
            key={d.key}
            type="button"
            role="tab"
            aria-selected={dept === d.key}
            onClick={() => setDept(d.key)}
            className={cn(
              "h-11 rounded-full px-5 text-sm font-semibold transition-colors",
              dept === d.key
                ? "bg-site-primary text-site-ivory shadow-sm"
                : "bg-site-mist text-site-slate hover:text-site-primary",
            )}
            data-testid={`silo-tab-${d.key}`}
          >
            {d.name}
          </button>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((s) => {
          const Icon = ICONS[s.key] ?? Sparkles;
          return (
            <article
              key={s.key}
              className="bg-card shadow-soft flex flex-col gap-5 rounded-2xl p-7"
              data-testid="site-silo"
            >
              <div className="flex items-center gap-3">
                <span className="bg-site-champagne-soft text-site-champagne-ink flex size-11 items-center justify-center rounded-xl">
                  <Icon className="size-5" aria-hidden />
                </span>
                <div>
                  <h3 className="font-display text-site-ink text-xl font-semibold">{s.name}</h3>
                  <p className="text-site-subtle text-xs">
                    {labels.count.replace("#", String(s.items.length))}
                  </p>
                </div>
              </div>
              <ul className="flex flex-1 flex-col">
                {s.items.map((it) => (
                  <li key={it.name} className="border-site-line border-b last:border-b-0">
                    {it.href ? (
                      <Link
                        href={it.href}
                        className="group text-site-ink hover:text-site-primary flex items-center justify-between gap-3 py-2.5 text-[15px]"
                      >
                        <span>{it.name}</span>
                        <span className="text-site-primary flex shrink-0 items-center gap-1 text-xs font-semibold opacity-80 group-hover:opacity-100">
                          {labels.book}
                          <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
                        </span>
                      </Link>
                    ) : (
                      <span className="text-site-slate block py-2.5 text-[15px]">{it.name}</span>
                    )}
                  </li>
                ))}
              </ul>
              {s.cta.external ? (
                <a
                  href={s.cta.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border-site-primary/30 text-site-primary hover:bg-site-primary hover:text-site-ivory inline-flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition-colors"
                >
                  <MessageCircle className="size-4" aria-hidden />
                  {s.cta.label}
                </a>
              ) : (
                <Link
                  href={s.cta.href}
                  className="border-site-primary/30 text-site-primary hover:bg-site-primary hover:text-site-ivory inline-flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition-colors"
                >
                  <CalendarCheck className="size-4" aria-hidden />
                  {s.cta.label}
                </Link>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
