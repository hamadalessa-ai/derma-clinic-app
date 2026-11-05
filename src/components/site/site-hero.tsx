import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  Clock,
  Stethoscope,
  UserRound,
  Video,
} from "lucide-react";
import { formatGregorian, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/config";
import type { SiteContent } from "@/db/schema";
import { SiteImage } from "./site-image";

/**
 * Hero: the clinic's own headline beside its main photo, with a floating "Quick actions" card
 * over the photo: Book an appointment (the main action), Find a doctor, Video consultation,
 * Patient portal, and the next free consultation times (each opens the booking flow).
 */
export async function SiteHero({
  locale,
  name,
  site,
  canBook,
  bookHref,
  consultHref,
  videoHref,
  hasDoctors,
  nextFree,
}: {
  locale: Locale;
  name: string;
  site: SiteContent;
  canBook: boolean;
  bookHref: string;
  consultHref: string;
  videoHref: string | null;
  hasDoctors: boolean;
  nextFree: string[];
}) {
  const t = await getTranslations("site");
  const ar = locale === "ar";
  const L = (a?: string, e?: string) => (ar ? a || e : e || a) ?? "";
  const Forward = ar ? ArrowLeft : ArrowRight;

  const actions = [
    canBook && {
      key: "book",
      href: bookHref,
      icon: CalendarCheck,
      title: t("quickBook"),
      text: t("quickBookText"),
      primary: true,
    },
    hasDoctors && {
      key: "doctor",
      href: "#doctors",
      icon: Stethoscope,
      title: t("quickDoctor"),
      text: t("quickDoctorText"),
    },
    canBook &&
      videoHref && {
        key: "video",
        href: videoHref,
        icon: Video,
        title: t("quickVideo"),
        text: t("quickVideoText"),
      },
    {
      key: "portal",
      href: "/my",
      icon: UserRound,
      title: t("quickPortal"),
      text: t("quickPortalText"),
    },
  ].filter(Boolean) as {
    key: string;
    href: string;
    icon: typeof CalendarCheck;
    title: string;
    text: string;
    primary?: boolean;
  }[];

  return (
    <section className="bg-site-mist relative overflow-hidden">
      <div className="mx-auto grid max-w-7xl lg:min-h-[640px] lg:grid-cols-2">
        {/* Text */}
        <div className="order-2 flex flex-col justify-center gap-6 px-5 pt-10 pb-8 lg:order-1 lg:py-20 lg:ps-8 lg:pe-14">
          {L(site.eyebrowAr, site.eyebrowEn) && (
            <span className="text-brand-strong text-sm font-semibold">
              {L(site.eyebrowAr, site.eyebrowEn)}
            </span>
          )}
          <h1 className="text-site-ink text-[2.1rem] leading-[1.15] font-bold text-balance sm:text-5xl lg:text-[3.4rem] lg:leading-[1.12]">
            {L(site.headlineAr, site.headlineEn) || name}
          </h1>
          {L(site.taglineAr, site.taglineEn) && (
            <p className="text-site-slate max-w-xl text-lg leading-relaxed">
              {L(site.taglineAr, site.taglineEn)}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            {canBook && (
              <Link
                href={bookHref}
                className="bg-brand text-brand-foreground hover:bg-brand-strong shadow-raised inline-flex h-12 items-center gap-2 rounded-lg px-6 font-semibold transition-colors"
                data-testid="hero-book"
              >
                <CalendarCheck className="size-4" aria-hidden />
                {t("book")}
              </Link>
            )}
            <a
              href="#services"
              className="border-site-ink/15 text-site-ink hover:border-site-ink/40 bg-card inline-flex h-12 items-center gap-2 rounded-lg border px-6 font-semibold transition-colors"
            >
              {t("heroLearnMore")}
              <Forward className="size-4" aria-hidden />
            </a>
          </div>
        </div>

        {/* Photo with the floating quick-action card */}
        <div className="relative order-1 lg:order-2">
          <div className="aspect-[4/3] w-full lg:absolute lg:inset-0 lg:aspect-auto lg:w-[calc(100%+max(0px,(100vw-80rem)/2))]">
            <SiteImage
              slot="hero"
              src={site.images?.hero}
              locale={locale}
              priority
              className="rounded-none"
            />
          </div>
        </div>
      </div>

      {/* Quick actions: over the photo on large screens, under it on phones. */}
      <div className="relative mx-auto max-w-7xl px-5 pb-10 lg:absolute lg:inset-x-0 lg:bottom-10 lg:px-8 lg:pb-0">
        <div
          className="border-site-line bg-card shadow-float rounded-2xl border p-5 sm:p-6 lg:ms-auto lg:mt-0 lg:w-[34rem]"
          data-testid="quick-actions"
        >
          <div className="text-site-ink mb-4 text-base font-semibold">{t("heroQuickTitle")}</div>
          <ul className="grid grid-cols-2 gap-2.5">
            {actions.map((a) => (
              <li key={a.key}>
                <Link
                  href={a.href}
                  className={cn(
                    "group flex h-full flex-col gap-2 rounded-xl border p-4 transition-colors",
                    a.primary
                      ? "bg-brand text-brand-foreground hover:bg-brand-strong border-transparent"
                      : "border-site-line hover:border-brand hover:bg-brand-soft",
                  )}
                  data-testid={`quick-${a.key}`}
                >
                  <a.icon
                    className={cn("size-5", a.primary ? "" : "text-brand-strong")}
                    aria-hidden
                  />
                  <span className={cn("text-sm font-semibold", !a.primary && "text-site-ink")}>
                    {a.title}
                  </span>
                  <span
                    className={cn(
                      "text-xs leading-snug",
                      a.primary ? "text-brand-foreground/80" : "text-site-subtle",
                    )}
                  >
                    {a.text}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {canBook && nextFree.length > 0 && (
            <div className="border-site-line mt-4 border-t pt-4" data-testid="next-free">
              <div className="text-site-subtle mb-2 flex items-center gap-1.5 text-xs font-medium">
                <Clock className="size-3.5" aria-hidden />
                {t("heroNext")}
              </div>
              <div className="flex flex-wrap gap-2">
                {nextFree.map((iso) => {
                  const d = new Date(iso);
                  return (
                    <Link
                      key={iso}
                      href={consultHref}
                      className="border-site-line hover:border-brand hover:bg-brand-soft text-site-ink flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors"
                    >
                      <span>{formatGregorian(d, locale, "medium")}</span>
                      <span className="font-mono font-medium" dir="ltr">
                        {formatTime(d, locale)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
