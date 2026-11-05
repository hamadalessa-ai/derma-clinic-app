import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight, CalendarCheck, Clock, LayoutGrid, Stethoscope } from "lucide-react";
import { formatGregorian, formatTime } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import type { SiteContent } from "@/db/schema";
import { SiteImage } from "./site-image";

/**
 * Hero: the clinic's own photograph edge to edge, its motto and headline, and — overlapping the
 * bottom of the hero — the quick-action panel: Book Appointment (with the next free times),
 * Find a Doctor, View Departments.
 */
export async function SiteHero({
  locale,
  name,
  site,
  canBook,
  consultHref,
  nextFree,
  doctorCount,
}: {
  locale: Locale;
  name: string;
  site: SiteContent;
  canBook: boolean;
  consultHref: string;
  nextFree: string[];
  doctorCount: number;
}) {
  const t = await getTranslations("site");
  const ar = locale === "ar";
  const L = (a?: string, e?: string) => (ar ? a || e : e || a) ?? "";
  const Forward = ar ? ArrowLeft : ArrowRight;

  return (
    <section className="relative">
      {/* Photograph, edge to edge, with a soft wash for the text side */}
      <div className="bg-site-night relative h-[34rem] overflow-hidden sm:h-[38rem] lg:h-[44rem]">
        <SiteImage slot="hero" src={site.images?.hero} locale={locale} priority />
        <div
          className="from-site-night/90 via-site-night/60 absolute inset-0 bg-linear-to-r to-transparent rtl:bg-linear-to-l"
          aria-hidden
        />
        <div className="relative mx-auto flex h-full max-w-7xl flex-col justify-center px-5 pb-24 lg:px-8 lg:pb-28">
          <div className="flex max-w-2xl flex-col gap-6">
            {L(site.eyebrowAr, site.eyebrowEn) && (
              <span className="text-site-champagne flex items-center gap-3 text-sm font-semibold ltr:tracking-[0.18em] ltr:uppercase">
                <span className="bg-site-champagne h-px w-10" aria-hidden />
                {L(site.eyebrowAr, site.eyebrowEn)}
              </span>
            )}
            <h1 className="font-display text-site-ivory text-[2.3rem] leading-[1.12] font-semibold text-balance sm:text-5xl lg:text-[3.6rem]">
              {L(site.headlineAr, site.headlineEn) || name}
            </h1>
            {site.since && (
              <p className="text-site-ivory/80 max-w-xl text-lg leading-relaxed">
                {t("heroSince", { year: site.since })}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-4 pt-2">
              {canBook && (
                <Link
                  href="/book"
                  className="bg-site-ivory text-site-night hover:bg-card inline-flex h-13 items-center gap-2 rounded-xl px-7 text-[15px] font-semibold shadow-sm transition-colors"
                  data-testid="hero-book"
                >
                  <CalendarCheck className="size-4" aria-hidden />
                  {t("book")}
                </Link>
              )}
              <a
                href="#departments"
                className="text-site-ivory hover:text-site-champagne inline-flex h-13 items-center gap-2 px-2 text-[15px] font-semibold transition-colors"
              >
                {t("heroExplore")}
                <Forward className="size-4" aria-hidden />
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Quick-action panel, overlapping the bottom of the hero */}
      <div className="relative z-10 mx-auto -mt-20 max-w-7xl px-5 lg:-mt-24 lg:px-8">
        <div
          className="bg-card shadow-float grid overflow-hidden rounded-2xl md:grid-cols-3"
          data-testid="quick-actions"
        >
          {canBook && (
            <div className="bg-site-primary text-site-ivory flex flex-col gap-4 p-7">
              <Link href="/book" className="group flex items-start gap-4" data-testid="quick-book">
                <span className="bg-site-ivory/15 flex size-12 shrink-0 items-center justify-center rounded-xl">
                  <CalendarCheck className="size-6" aria-hidden />
                </span>
                <span className="flex flex-col gap-1">
                  <span className="text-lg font-semibold">{t("quickBook")}</span>
                  <span className="text-site-ivory/75 text-sm">{t("quickBookText")}</span>
                </span>
                <Forward
                  className="ms-auto mt-1 size-5 shrink-0 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1"
                  aria-hidden
                />
              </Link>
              {nextFree.length > 0 && (
                <div className="flex flex-col gap-2" data-testid="next-free">
                  <span className="text-site-ivory/70 flex items-center gap-1.5 text-xs">
                    <Clock className="size-3.5" aria-hidden />
                    {t("heroNext")}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {nextFree.map((iso) => {
                      const d = new Date(iso);
                      return (
                        <Link
                          key={iso}
                          href={consultHref}
                          className="bg-site-ivory/10 hover:bg-site-ivory/20 rounded-lg px-2.5 py-1 text-xs transition-colors"
                        >
                          {formatGregorian(d, locale, "medium")} ·{" "}
                          <span dir="ltr" className="font-semibold">
                            {formatTime(d, locale)}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          <a
            href="#doctors"
            className="group border-site-line hover:bg-site-mist flex items-start gap-4 border-t p-7 transition-colors md:border-s md:border-t-0"
            data-testid="quick-doctor"
          >
            <span className="bg-site-primary-soft text-site-primary flex size-12 shrink-0 items-center justify-center rounded-xl">
              <Stethoscope className="size-6" aria-hidden />
            </span>
            <span className="flex flex-col gap-1">
              <span className="text-site-ink text-lg font-semibold">{t("quickDoctor")}</span>
              <span className="text-site-subtle text-sm">
                {doctorCount > 0 ? t("quickDoctorCount", { n: doctorCount }) : t("quickDoctorText")}
              </span>
            </span>
            <Forward
              className="text-site-primary ms-auto mt-1 size-5 shrink-0 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1"
              aria-hidden
            />
          </a>
          <a
            href="#departments"
            className="group border-site-line hover:bg-site-mist flex items-start gap-4 border-t p-7 transition-colors md:border-s md:border-t-0"
            data-testid="quick-departments"
          >
            <span className="bg-site-champagne-soft text-site-champagne-ink flex size-12 shrink-0 items-center justify-center rounded-xl">
              <LayoutGrid className="size-6" aria-hidden />
            </span>
            <span className="flex flex-col gap-1">
              <span className="text-site-ink text-lg font-semibold">{t("quickDepartments")}</span>
              <span className="text-site-subtle text-sm">{t("quickDepartmentsText")}</span>
            </span>
            <Forward
              className="text-site-primary ms-auto mt-1 size-5 shrink-0 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1"
              aria-hidden
            />
          </a>
        </div>
      </div>
    </section>
  );
}
