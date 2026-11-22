import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight, CalendarCheck, LayoutGrid, Stethoscope } from "lucide-react";
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
  doctorCount,
}: {
  locale: Locale;
  name: string;
  site: SiteContent;
  canBook: boolean;
  doctorCount: number;
}) {
  const t = await getTranslations("site");
  const ar = locale === "ar";
  const L = (a?: string, e?: string) => (ar ? a || e : e || a) ?? "";
  const Forward = ar ? ArrowLeft : ArrowRight;

  return (
    <section className="relative">
      {/* Photograph, edge to edge, with a soft wash for the text side */}
      <div className="bg-site-night relative min-h-[36rem] overflow-hidden sm:min-h-[38rem] lg:h-[44rem]">
        <div className="absolute inset-0">
          <SiteImage slot="hero" src={site.images?.hero} locale={locale} priority />
        </div>
        <div
          className="from-site-night absolute inset-x-0 bottom-0 h-2/5 bg-linear-to-t to-transparent"
          aria-hidden
        />
        <div
          className="from-site-night/90 via-site-night/60 absolute inset-0 bg-linear-to-r to-transparent rtl:bg-linear-to-l"
          aria-hidden
        />
        <div className="relative mx-auto flex min-h-[36rem] max-w-7xl flex-col justify-center px-5 pt-14 pb-28 sm:min-h-[38rem] lg:h-full lg:px-8 lg:pt-0">
          <div className="flex max-w-2xl flex-col gap-6">
            {L(site.eyebrowAr, site.eyebrowEn) && (
              <span className="text-site-champagne text-base font-medium">
                {L(site.eyebrowAr, site.eyebrowEn)}
              </span>
            )}
            <h1 className="font-display text-site-ivory max-w-[22ch] text-[2.1rem] leading-[1.15] font-semibold text-balance sm:text-5xl lg:text-[3.1rem]">
              {L(site.headlineAr, site.headlineEn) || name}
            </h1>
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
