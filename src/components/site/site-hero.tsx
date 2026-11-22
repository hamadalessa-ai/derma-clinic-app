import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/config";
import type { SiteContent } from "@/db/schema";
import { SiteImage } from "./site-image";

/**
 * Opening spread, like a magazine cover story: the clinic's photograph edge to edge with no text
 * on it, then on paper the section tag, the headline, a short standfirst and two quiet
 * invitations — plus the next free consultation in small type.
 */
export async function SiteHero({
  locale,
  name,
  site,
  canBook,
  nextFree,
}: {
  locale: Locale;
  name: string;
  site: SiteContent;
  canBook: boolean;
  /** ISO start time of the next free first consultation, when known. */
  nextFree?: string | null;
}) {
  const t = await getTranslations("site");
  const ar = locale === "ar";
  const L = (a?: string, e?: string) => (ar ? a || e : e || a) ?? "";
  const next = nextFree
    ? new Intl.DateTimeFormat(ar ? "ar-SA-u-ca-gregory" : "en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "Asia/Riyadh",
      }).format(new Date(nextFree))
    : null;

  return (
    <section className="flex flex-col" aria-labelledby="site-title">
      <div className="bg-site-mist relative h-[22rem] overflow-hidden sm:h-[30rem] lg:h-[38rem]">
        <SiteImage slot="hero" src={site.images?.hero} locale={locale} priority />
      </div>
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 pt-14 pb-20 lg:grid-cols-12 lg:px-8 lg:pt-20 lg:pb-28">
        <div className="flex flex-col gap-7 lg:col-span-8">
          {L(site.eyebrowAr, site.eyebrowEn) && (
            <span className="site-label">{L(site.eyebrowAr, site.eyebrowEn)}</span>
          )}
          <h1
            id="site-title"
            className="font-display text-site-ink max-w-[18ch] text-[2.4rem] leading-[1.08] font-normal text-balance sm:text-6xl lg:text-[4.5rem]"
          >
            {L(site.headlineAr, site.headlineEn) || name}
          </h1>
        </div>
        <div className="flex flex-col justify-end gap-8 lg:col-span-4">
          {L(site.taglineAr, site.taglineEn) && (
            <p className="text-site-slate text-[17px] leading-[1.8]">
              {L(site.taglineAr, site.taglineEn)}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            {canBook && (
              <Link href="/book" className="site-button" data-testid="hero-book">
                {t("book")}
              </Link>
            )}
            <a href="#about" className="site-link">
              {t("heroExplore")}
            </a>
          </div>
          {canBook && next && (
            <p className="text-site-subtle border-site-line border-t pt-4 text-sm">
              {t("heroNext")}: <span className="text-site-ink">{next}</span>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
