import Link from "next/link";
import { CalendarCheck, MessageCircle, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/config";
import { SiteImage } from "./site-image";

export interface Chapter {
  key: string;
  /** Anchor ids for the menu (#dept-skin, …). */
  anchor: string;
  title: string;
  intro: string;
  images: { slot: string; src?: string | undefined }[];
  groups: { name: string; items: { name: string; href: string | null }[] }[];
  cta: { label: string; href: string; external: boolean };
}

/**
 * Procedures & Services as a magazine: one spread per specialty, all built the same way —
 * a large photograph with a second one laid over its corner, the chapter number, the clinic's
 * own introduction, and the treatments set as a typographic list. Spreads alternate sides.
 */
export function SiteChapters({
  chapters,
  locale,
  phone,
  labels,
}: {
  chapters: Chapter[];
  locale: Locale;
  phone: { label: string; href: string } | null;
  labels: { call: string; bookable: string };
}) {
  return (
    <div className="flex flex-col gap-20 lg:gap-28">
      {chapters.map((c, i) => {
        const flip = i % 2 === 1;
        return (
          <article
            key={c.key}
            id={c.anchor}
            className="grid scroll-mt-28 items-center gap-12 lg:grid-cols-12 lg:gap-16"
            data-testid="site-chapter"
          >
            {/* Photographs */}
            <div className={cn("relative lg:col-span-5", flip && "lg:order-2")}>
              <div className="aspect-[5/4] overflow-hidden rounded-2xl lg:aspect-[4/5] lg:max-h-[34rem] lg:w-full">
                <SiteImage
                  slot={c.images[0].slot}
                  src={c.images[0].src}
                  locale={locale}
                  priority={i === 0}
                />
              </div>
              {c.images[1] && (
                <div
                  className={cn(
                    "border-site-mist absolute -bottom-10 hidden aspect-square w-[42%] overflow-hidden rounded-2xl border-8 sm:block",
                    flip ? "-start-8" : "-end-8",
                  )}
                >
                  <SiteImage slot={c.images[1].slot} src={c.images[1].src} locale={locale} />
                </div>
              )}
            </div>

            {/* Text */}
            <div className={cn("flex flex-col gap-7 lg:col-span-7", flip && "lg:order-1")}>
              <div className="flex flex-col gap-4">
                <span className="font-display text-site-champagne text-4xl leading-none" dir="ltr">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="font-display text-site-ink text-3xl leading-tight font-semibold lg:text-[2.6rem]">
                  {c.title}
                </h3>
                {c.intro && <p className="text-[16px] leading-[1.8]">{c.intro}</p>}
              </div>

              {/* Treatments as flowing text, one line per group: short, like a magazine index. */}
              <dl className="border-site-line flex flex-col border-t">
                {c.groups.map((g) => (
                  <div
                    key={g.name}
                    className="border-site-line grid gap-1 border-b py-4 sm:grid-cols-[9.5rem_1fr] sm:gap-6"
                  >
                    <dt className="text-site-primary text-sm font-semibold">{g.name}</dt>
                    <dd className="text-site-slate text-[15px] leading-[1.9]">
                      {g.items.map((it, n) => (
                        <span key={it.name}>
                          {it.href ? (
                            <Link
                              href={it.href}
                              title={labels.bookable}
                              className="text-site-ink decoration-site-champagne hover:text-site-primary underline decoration-1 underline-offset-4"
                            >
                              {it.name}
                            </Link>
                          ) : (
                            it.name
                          )}
                          {n < g.items.length - 1 && (
                            <span className="text-site-champagne mx-2" aria-hidden>
                              ·
                            </span>
                          )}
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                {c.cta.external ? (
                  <a
                    href={c.cta.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-site-primary text-site-ivory hover:bg-site-primary-hover inline-flex h-12 items-center gap-2 rounded-xl px-6 text-sm font-semibold transition-colors"
                  >
                    <MessageCircle className="size-4" aria-hidden />
                    {c.cta.label}
                  </a>
                ) : (
                  <Link
                    href={c.cta.href}
                    className="bg-site-primary text-site-ivory hover:bg-site-primary-hover inline-flex h-12 items-center gap-2 rounded-xl px-6 text-sm font-semibold transition-colors"
                  >
                    <CalendarCheck className="size-4" aria-hidden />
                    {c.cta.label}
                  </Link>
                )}
                {phone && (
                  <a
                    href={phone.href}
                    className="text-site-ink hover:text-site-primary inline-flex items-center gap-2 text-sm font-semibold"
                  >
                    <Phone className="size-4" aria-hidden />
                    {labels.call} <span dir="ltr">{phone.label}</span>
                  </a>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
