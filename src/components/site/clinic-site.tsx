import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  Clock,
  MapPin,
  MessageCircle,
  Phone,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  Stethoscope,
  Video,
} from "lucide-react";
import { LanguageToggle } from "@/components/language-toggle";
import { buttonVariants } from "@/components/ui/button";
import { pick } from "@/lib/brand";
import { formatGregorian, formatSAR, formatTime } from "@/lib/format";
import type { ClinicSiteData } from "@/lib/site/data";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/config";

/**
 * The clinic's public website ("/"). One goal: get a visitor into the booking flow.
 * Every "Book" button goes to /book (mobile code first, then choose and confirm);
 * service cards pre-select their service, the video button pre-selects a video visit.
 * Brand fill is used for the ONE main action (Book); everything else is outline or text.
 */
export async function ClinicSite({
  clinic,
  data,
  locale,
}: {
  clinic: { nameAr: string; nameEn: string };
  data: ClinicSiteData;
  locale: Locale;
}) {
  const t = await getTranslations("site");
  const tApp = await getTranslations("app");
  const name = pick(locale, clinic.nameAr, clinic.nameEn);
  const s = data.site;
  const L = (ar?: string, en?: string) => (locale === "ar" ? ar || en : en || ar) ?? "";
  const Forward = locale === "ar" ? ArrowLeft : ArrowRight;
  const wa = s.whatsapp ? `https://wa.me/${s.whatsapp.replace(/\D/g, "")}` : null;
  const tel = s.phone ? `tel:${s.phone.replace(/[^\d+]/g, "")}` : null;
  const canBook = data.catalog.enabled && data.catalog.departments.length > 0;
  const bookHref = "/book";
  const videoHref = data.videoService
    ? `/book?mode=video&service=${data.videoService.id}`
    : "/book?mode=video";
  const firstHref = data.firstService
    ? `/book?mode=clinic&service=${data.firstService.id}`
    : bookHref;
  const weekday = (d: number) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-SA", { weekday: "short" }).format(
      new Date(Date.UTC(2023, 0, 1 + d)), // 1 Jan 2023 was a Sunday
    );
  const years = s.since ? new Date().getFullYear() - s.since : null;
  const nextBranch = data.branches.find((b) => b.id === data.nextFreeBranchId);

  const primary = cn(buttonVariants({ size: "lg" }), "shadow-raised");
  const secondary = cn(buttonVariants({ variant: "outline", size: "lg" }));

  return (
    <div className="bg-background flex min-h-screen flex-col pb-20 md:pb-0">
      {/* Demo notices: this is a concept site with demo data. */}
      <div
        className="bg-warning text-warning-foreground px-4 py-1.5 text-center text-xs font-medium"
        role="note"
        data-testid="site-concept"
      >
        {tApp("demoBanner")} · {t("concept")}
      </div>

      {/* Sticky header: name, sections, language, and the ONE main action. */}
      <header className="bg-card/95 sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <span className="bg-brand text-brand-foreground flex size-9 shrink-0 items-center justify-center rounded-full font-bold">
              {name.charAt(0)}
            </span>
            <span className="text-brand-strong truncate font-semibold">{name}</span>
          </Link>
          <nav className="text-muted-foreground ms-6 hidden items-center gap-5 text-sm font-medium lg:flex">
            <a href="#treatments" className="hover:text-foreground">
              {t("navTreatments")}
            </a>
            <a href="#doctors" className="hover:text-foreground">
              {t("navDoctors")}
            </a>
            <a href="#branches" className="hover:text-foreground">
              {t("navBranches")}
            </a>
            <a href="#faq" className="hover:text-foreground">
              {t("navFaq")}
            </a>
          </nav>
          <div className="ms-auto flex items-center gap-2">
            <LanguageToggle />
            {canBook && (
              <Link
                href={bookHref}
                className={cn(buttonVariants(), "hidden sm:inline-flex")}
                data-testid="nav-book"
              >
                <CalendarCheck />
                {t("book")}
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="from-brand-soft to-background bg-linear-to-b">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-[1.15fr_0.85fr] md:items-center md:py-20">
            <div className="flex flex-col gap-5">
              {s.since && (
                <span className="bg-card text-brand-strong inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold">
                  <Sparkles className="size-3.5" aria-hidden />
                  {t("since", { year: s.since })}
                </span>
              )}
              <h1 className="text-foreground text-3xl leading-tight font-bold text-balance md:text-5xl md:leading-tight">
                {L(s.headlineAr, s.headlineEn) || name}
              </h1>
              {L(s.taglineAr, s.taglineEn) && (
                <p className="text-muted-foreground max-w-xl text-base leading-relaxed md:text-lg">
                  {L(s.taglineAr, s.taglineEn)}
                </p>
              )}
              {canBook && (
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Link href={bookHref} className={primary} data-testid="hero-book">
                    <CalendarCheck />
                    {t("book")}
                  </Link>
                  {data.videoService && (
                    <Link href={videoHref} className={secondary} data-testid="hero-video">
                      <Video />
                      {t("videoCta")}
                    </Link>
                  )}
                </div>
              )}
              <ul className="text-muted-foreground flex flex-wrap gap-x-5 gap-y-2 pt-1 text-sm">
                {years !== null && years > 0 && (
                  <li className="flex items-center gap-1.5">
                    <ShieldCheck className="text-brand-strong size-4" aria-hidden />
                    {t("trustYears", { n: years })}
                  </li>
                )}
                {data.doctors.length > 0 && (
                  <li className="flex items-center gap-1.5">
                    <Stethoscope className="text-brand-strong size-4" aria-hidden />
                    {t("trustDoctors", { n: data.doctors.length })}
                  </li>
                )}
                {data.branches.length > 0 && (
                  <li className="flex items-center gap-1.5">
                    <MapPin className="text-brand-strong size-4" aria-hidden />
                    {t("trustBranches", { n: data.branches.length })}
                  </li>
                )}
                {data.videoService && (
                  <li className="flex items-center gap-1.5">
                    <Video className="text-brand-strong size-4" aria-hidden />
                    {t("trustVideo")}
                  </li>
                )}
              </ul>
            </div>

            {/* Next free times: one tap into the booking flow. */}
            {canBook && (
              <div className="bg-card shadow-raised rounded-2xl border p-5" data-testid="next-free">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Clock className="text-brand-strong size-4" aria-hidden />
                  {t("nextTitle")}
                </div>
                {data.nextFree.length > 0 ? (
                  <ul className="mt-4 flex flex-col gap-2">
                    {data.nextFree.map((iso) => {
                      const d = new Date(iso);
                      return (
                        <li key={iso}>
                          <Link
                            href={firstHref}
                            className="hover:border-brand hover:bg-brand-soft flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors"
                          >
                            <span className="text-sm">{formatGregorian(d, locale, "medium")}</span>
                            <span className="font-mono text-sm font-medium" dir="ltr">
                              {formatTime(d, locale)}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-muted-foreground mt-3 text-sm">{t("nextNone")}</p>
                )}
                <div className="text-muted-foreground mt-4 flex items-center justify-between gap-2 text-xs">
                  <span>
                    {data.firstService &&
                      pick(locale, data.firstService.nameAr, data.firstService.nameEn)}
                    {nextBranch && ` · ${pick(locale, nextBranch.nameAr, nextBranch.nameEn)}`}
                  </span>
                  <Link
                    href={firstHref}
                    className="text-brand-strong inline-flex items-center gap-1 font-medium hover:underline"
                  >
                    {t("nextMore")}
                    <Forward className="size-3.5" aria-hidden />
                  </Link>
                </div>
                <ol className="mt-5 grid gap-3 border-t pt-4">
                  {(
                    [
                      [Smartphone, "how1", "how1Text"],
                      [CalendarCheck, "how2", "how2Text"],
                      [MessageCircle, "how3", "how3Text"],
                    ] as const
                  ).map(([Icon, title, text], i) => (
                    <li key={title} className="flex gap-3">
                      <span className="bg-brand-soft text-brand-strong flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-medium">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-sm font-semibold">
                          <Icon className="text-brand-strong size-3.5" aria-hidden />
                          {t(title)}
                        </div>
                        <p className="text-muted-foreground text-xs leading-relaxed">{t(text)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </section>

        {/* Treatments */}
        {canBook && (
          <section id="treatments" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14">
            <SectionTitle title={t("treatmentsTitle")} text={t("treatmentsText")} />
            {data.catalog.departments.map((dep) => (
              <div key={dep.id} className="mt-8">
                {data.catalog.departments.length > 1 && (
                  <h3 className="text-muted-foreground mb-3 text-sm font-semibold">
                    {pick(locale, dep.nameAr, dep.nameEn)}
                  </h3>
                )}
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {dep.services.map((svc) => (
                    <li key={svc.id}>
                      <Link
                        href={`/book?mode=${svc.isVirtual ? "video" : "clinic"}&service=${svc.id}`}
                        className="bg-card shadow-card hover:border-brand group flex h-full flex-col gap-3 rounded-xl border p-4 transition-colors"
                        data-testid="site-service"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold">
                            {pick(locale, svc.nameAr, svc.nameEn)}
                          </span>
                          {svc.isVirtual && (
                            <span className="bg-info/10 text-info inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium">
                              <Video className="size-3" aria-hidden />
                              {t("videoBadge")}
                            </span>
                          )}
                        </div>
                        <div className="text-muted-foreground mt-auto flex items-center justify-between gap-2 text-sm">
                          <span className="flex items-center gap-3">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="size-3.5" aria-hidden />
                              {t("minutes", { n: svc.durationMinutes })}
                            </span>
                            {svc.priceHalalas !== null && (
                              <span className="text-foreground font-medium">
                                {t("fromPrice", { price: formatSAR(svc.priceHalalas, locale) })}
                              </span>
                            )}
                          </span>
                          <span className="text-brand-strong inline-flex items-center gap-1 font-medium">
                            {t("bookThis")}
                            <Forward
                              className="size-3.5 transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5"
                              aria-hidden
                            />
                          </span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {data.others.length > 0 && (
              <div className="bg-muted/60 mt-10 flex flex-col gap-3 rounded-xl border border-dashed p-5 md:flex-row md:items-center">
                <div className="flex-1">
                  <div className="font-semibold">{t("othersTitle")}</div>
                  <p className="text-muted-foreground text-sm">{t("othersText")}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {data.others.map((o) => (
                      <span key={o.id} className="bg-card rounded-full border px-3 py-1 text-sm">
                        {pick(locale, o.nameAr, o.nameEn)}
                      </span>
                    ))}
                  </div>
                </div>
                {(wa || tel) && (
                  <a
                    href={(wa ?? tel)!}
                    className={buttonVariants({ variant: "outline" })}
                    target={wa ? "_blank" : undefined}
                    rel="noopener noreferrer"
                  >
                    {wa ? <MessageCircle /> : <Phone />}
                    {wa ? t("askWhatsapp") : t("askCall")}
                  </a>
                )}
              </div>
            )}
          </section>
        )}

        {/* Video band */}
        {data.videoService && (
          <section className="mx-auto max-w-6xl px-4">
            <div className="bg-brand-soft grid gap-6 rounded-2xl p-6 md:grid-cols-[1fr_auto] md:items-center md:p-10">
              <div>
                <div className="text-brand-strong flex items-center gap-2 text-sm font-semibold">
                  <Video className="size-4" aria-hidden />
                  {pick(locale, data.videoService.nameAr, data.videoService.nameEn)}
                  {data.videoService.priceHalalas !== null &&
                    ` · ${formatSAR(data.videoService.priceHalalas, locale)}`}
                </div>
                <h2 className="mt-2 text-2xl font-bold">{t("videoTitle")}</h2>
                <p className="text-muted-foreground mt-2 max-w-2xl">{t("videoText")}</p>
                <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                  {(["videoPoint1", "videoPoint2", "videoPoint3"] as const).map((k) => (
                    <li key={k} className="flex items-center gap-2">
                      <ShieldCheck className="text-brand-strong size-4 shrink-0" aria-hidden />
                      {t(k)}
                    </li>
                  ))}
                </ul>
              </div>
              <Link href={videoHref} className={secondary}>
                <Video />
                {t("videoCta")}
              </Link>
            </div>
          </section>
        )}

        {/* Doctors */}
        {data.doctors.length > 0 && (
          <section id="doctors" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14">
            <SectionTitle title={t("doctorsTitle")} text={t("doctorsText")} />
            <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {data.doctors.map((d) => {
                const branch = data.branches.find((b) => b.id === d.branchId);
                const docName = pick(locale, d.nameAr, d.nameEn);
                return (
                  <li key={d.id} className="bg-card shadow-card flex gap-3 rounded-xl border p-4">
                    <span className="bg-brand-soft text-brand-strong flex size-12 shrink-0 items-center justify-center rounded-full text-lg font-bold">
                      {docName.replace(/^(د\.|Dr\.?)\s*/i, "").charAt(0)}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{docName}</div>
                      {(d.titleAr || d.titleEn) && (
                        <div className="text-muted-foreground text-sm">
                          {pick(locale, d.titleAr ?? d.titleEn ?? "", d.titleEn)}
                        </div>
                      )}
                      <div className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
                        <MapPin className="size-3" aria-hidden />
                        {branch ? pick(locale, branch.cityAr, branch.cityEn) : t("allBranches")}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Reviews: only real ones the clinic entered in Settings → Website. */}
        {(s.reviews?.length ?? 0) > 0 && (
          <section className="bg-card border-y">
            <div className="mx-auto max-w-6xl px-4 py-14">
              <SectionTitle title={t("reviewsTitle")} />
              <ul className="mt-8 grid gap-4 md:grid-cols-3">
                {s.reviews!.slice(0, 6).map((r, i) => (
                  <li key={i} className="bg-background flex flex-col gap-3 rounded-xl border p-5">
                    <div className="text-gold flex gap-0.5" aria-hidden>
                      {Array.from({ length: 5 }, (_, k) => (
                        <Star key={k} className="size-4 fill-current" />
                      ))}
                    </div>
                    <blockquote className="leading-relaxed">“{r.quote}”</blockquote>
                    <div className="text-muted-foreground mt-auto text-sm">
                      {r.name}
                      {r.treatment && ` · ${r.treatment}`}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* Branches */}
        {data.branches.length > 0 && (
          <section id="branches" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14">
            <SectionTitle title={t("branchesTitle")} />
            <ul className="mt-8 grid gap-4 md:grid-cols-2">
              {data.branches.map((b) => (
                <li
                  key={b.id}
                  className="bg-card shadow-card flex flex-col gap-3 rounded-xl border p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold">
                        {pick(locale, b.nameAr, b.nameEn)}
                      </div>
                      <div className="text-muted-foreground flex items-center gap-1 text-sm">
                        <MapPin className="size-3.5" aria-hidden />
                        {pick(locale, b.cityAr, b.cityEn)}
                      </div>
                    </div>
                    {b.video && (
                      <span className="bg-info/10 text-info inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium">
                        <Video className="size-3" aria-hidden />
                        {t("videoHere")}
                      </span>
                    )}
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                    <dt className="text-muted-foreground">{t("branchDays")}</dt>
                    <dd>{b.days.length ? b.days.map(weekday).join(" · ") : t("closed")}</dd>
                    {b.from && b.to && (
                      <>
                        <dt className="text-muted-foreground">{t("branchHours")}</dt>
                        <dd className="font-mono" dir="ltr">
                          {b.from}–{b.to}
                        </dd>
                      </>
                    )}
                  </dl>
                  {b.mapUrl && (
                    <a
                      href={b.mapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-strong mt-auto inline-flex w-fit items-center gap-1 text-sm font-medium hover:underline"
                    >
                      <MapPin className="size-3.5" aria-hidden />
                      {t("map")}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* FAQ */}
        <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-14">
          <SectionTitle title={t("faqTitle")} />
          <div className="mt-8 flex flex-col gap-2">
            {([1, 2, 3, 4, 5] as const).map((n) => (
              <details
                key={n}
                className="bg-card group open:shadow-card rounded-xl border px-4 py-3"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium">
                  {t(`faq${n}q`)}
                  <span
                    className="text-muted-foreground transition-transform group-open:rotate-45"
                    aria-hidden
                  >
                    +
                  </span>
                </summary>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  {t(`faq${n}a`, { hours: data.catalog.settings.cancellationWindowHours })}
                </p>
              </details>
            ))}
          </div>
        </section>

        {/* Final call to action */}
        {canBook && (
          <section className="mx-auto max-w-6xl px-4 pb-14">
            <div className="bg-card shadow-card flex flex-col items-center gap-4 rounded-2xl border px-6 py-10 text-center">
              <h2 className="text-2xl font-bold">{t("finalTitle")}</h2>
              <p className="text-muted-foreground max-w-md">{t("finalText")}</p>
              <Link href={bookHref} className={secondary} data-testid="final-book">
                <CalendarCheck />
                {t("book")}
              </Link>
            </div>
          </section>
        )}
      </main>

      <footer className="bg-card border-t">
        <div className="text-muted-foreground mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-foreground font-semibold">{name}</span>
            <span>
              {t("footerRights", { year: new Date().getFullYear(), name })}
              {s.licence && ` · ${t("licence", { n: s.licence })}`}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link href="/my" className="hover:text-foreground">
              {t("myAppointments")}
            </Link>
            {tel && (
              <a href={tel} className="hover:text-foreground" dir="ltr">
                {s.phone}
              </a>
            )}
            {wa && (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground"
              >
                {t("whatsapp")}
              </a>
            )}
            {s.instagram && (
              <a
                href={`https://instagram.com/${s.instagram.replace(/^@/, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground"
              >
                {t("instagram")}
              </a>
            )}
            <Link href="/login" className="hover:text-foreground">
              {t("staff")}
            </Link>
          </div>
        </div>
      </footer>

      {/* Phones: the booking button stays under the thumb. */}
      {canBook && (
        <div className="bg-card/95 fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t p-3 backdrop-blur sm:hidden">
          <Link
            href={bookHref}
            className={cn(buttonVariants({ size: "lg" }), "flex-1")}
            data-testid="sticky-book"
          >
            <CalendarCheck />
            {t("book")}
          </Link>
          {wa && (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("whatsapp")}
              className={buttonVariants({ variant: "outline", size: "lg" })}
            >
              <MessageCircle />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function SectionTitle({ title, text }: { title: string; text?: string }) {
  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold md:text-3xl">{title}</h2>
      {text && <p className="text-muted-foreground mt-2">{text}</p>}
    </div>
  );
}
