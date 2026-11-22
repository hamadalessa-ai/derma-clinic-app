import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/config";
import { SiteImage } from "./site-image";

export interface Chapter {
  key: string;
  /** Anchor ids for the menu (#dept-skin, …). */
  anchor: string;
  title: string;
  /** A short editorial headline ("Skin, read closely."); the title is used when missing. */
  lead?: string;
  intro: string;
  images: { slot: string; src?: string | undefined }[];
  groups: { name: string; items: { name: string; href: string | null }[] }[];
  cta: { label: string; href: string; external: boolean };
}

/**
 * The disciplines as magazine chapters: a tall photograph to one side, the chapter number and
 * name as a small label, a short headline, a restrained paragraph, then the treatments as a
 * numbered index between fine rules. Chapters alternate sides.
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
    <div className="flex flex-col">
      {chapters.map((c, i) => {
        const flip = i % 2 === 1;
        const number = String(i + 1).padStart(2, "0");
        // Treatments are numbered through the whole chapter (01, 02, … across its groups).
        const starts = c.groups.map((_, gi) =>
          c.groups.slice(0, gi).reduce((sum, x) => sum + x.items.length, 0),
        );
        return (
          <article
            key={c.key}
            id={c.anchor}
            className="border-site-line grid scroll-mt-28 gap-10 border-t py-16 lg:grid-cols-12 lg:gap-16 lg:py-24"
            data-testid="site-chapter"
          >
            <div className={cn("lg:col-span-5", flip && "lg:order-2")}>
              <div className="bg-site-mist aspect-[4/5] overflow-hidden lg:sticky lg:top-28">
                <SiteImage
                  slot={c.images[0].slot}
                  src={c.images[0].src}
                  locale={locale}
                  priority={i === 0}
                />
              </div>
            </div>

            <div className={cn("flex flex-col gap-8 lg:col-span-7", flip && "lg:order-1")}>
              <div className="flex flex-col gap-5">
                <span className="site-label">
                  <span dir="ltr">{number}</span> / {c.title}
                </span>
                <h3 className="font-display text-site-ink text-[2rem] leading-[1.15] font-normal text-balance lg:text-[2.75rem]">
                  {c.lead || c.title}
                </h3>
                {c.intro && (
                  <p className="text-site-slate max-w-xl text-[16px] leading-[1.85]">{c.intro}</p>
                )}
              </div>

              <div className="flex flex-col gap-6">
                {c.groups.map((g, gi) => (
                  <div key={g.name} className="flex flex-col gap-2">
                    <span className="text-site-subtle text-xs">{g.name}</span>
                    <ol className="border-site-line grid border-t sm:grid-cols-2 sm:gap-x-8">
                      {g.items.map((it, ii) => {
                        const n = starts[gi] + ii + 1;
                        return (
                          <li
                            key={it.name}
                            className="border-site-line flex items-baseline gap-4 border-b py-2.5 text-[15px]"
                          >
                            <span
                              className="text-site-champagne-ink w-6 shrink-0 text-xs tabular-nums"
                              dir="ltr"
                            >
                              {String(n).padStart(2, "0")}
                            </span>
                            {it.href ? (
                              <Link
                                href={it.href}
                                title={labels.bookable}
                                className="text-site-ink decoration-site-champagne underline decoration-1 underline-offset-4"
                              >
                                {it.name}
                              </Link>
                            ) : (
                              <span className="text-site-slate">{it.name}</span>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                {c.cta.external ? (
                  <a href={c.cta.href} target="_blank" rel="noopener noreferrer" className="site-link">
                    {c.cta.label}
                  </a>
                ) : (
                  <Link href={c.cta.href} className="site-link">
                    {c.cta.label}
                  </Link>
                )}
                {phone && (
                  <a href={phone.href} className="text-site-subtle text-sm">
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
