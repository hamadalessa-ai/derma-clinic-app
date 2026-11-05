import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  MapPin,
  MessageCircle,
  Phone,
  ShieldCheck,
  Video,
} from "lucide-react";
import { LanguageToggle } from "@/components/language-toggle";
import { pick } from "@/lib/brand";
import { formatGregorian, formatSAR, formatTime } from "@/lib/format";
import type { ClinicSiteData } from "@/lib/site/data";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/config";

/**
 * The clinic's public website ("/"), editorial and calm: ivory and white, serif headings,
 * generous whitespace. One goal: get the visitor into the booking flow. Every Book button opens
 * /book (mobile code first, then choose and confirm); treatment cards and "Book a consultation"
 * pre-select a service, the video button pre-selects a video visit.
 * Content comes only from the clinic (Settings → Website + its services, doctors, branches):
 * sections without real content (credentials, reviews) stay hidden; demo clinics show
 * clearly-labelled photo placeholders.
 */
export async function ClinicSite({
  clinic,
  data,
  locale,
}: {
  clinic: { nameAr: string; nameEn: string; isDemo: boolean };
  data: ClinicSiteData;
  locale: Locale;
}) {
  const t = await getTranslations("site");
  const tApp = await getTranslations("app");
  const name = pick(locale, clinic.nameAr, clinic.nameEn);
  const s = data.site;
  const ar = locale === "ar";
  const L = (a?: string, e?: string) => (ar ? a || e : e || a) ?? "";
  const Forward = ar ? ArrowLeft : ArrowRight;

  const wa = s.whatsapp ? `https://wa.me/${s.whatsapp.replace(/\D/g, "")}` : null;
  const tel = s.phone ? `tel:${s.phone.replace(/[^\d+]/g, "")}` : null;
  const canBook = data.catalog.enabled && data.catalog.departments.length > 0;
  const bookHref = "/book";
  const consultHref = data.firstService
    ? `/book?mode=clinic&service=${data.firstService.id}`
    : bookHref;
  const videoHref = data.videoService
    ? `/book?mode=video&service=${data.videoService.id}`
    : "/book?mode=video";

  const cities = [...new Set(data.branches.map((b) => pick(locale, b.cityAr, b.cityEn)))];
  const cityList =
    cities.length > 1
      ? cities.slice(0, -1).join(ar ? "، " : ", ") + t("and") + cities.at(-1)
      : (cities[0] ?? "");
  const years = s.since ? new Date().getFullYear() - s.since : null;
  const specialties = s.specialties ?? [];
  const nextBranch = data.branches.find((b) => b.id === data.nextFreeBranchId);
  const weekday = (d: number) =>
    new Intl.DateTimeFormat(ar ? "ar-SA" : "en-SA", { weekday: "short" }).format(
      new Date(Date.UTC(2023, 0, 1 + d)), // 1 Jan 2023 was a Sunday
    );
  const monogram = (clinic.nameEn || clinic.nameAr).charAt(0);

  const cta =
    "inline-flex h-12 items-center justify-center gap-2 rounded-full bg-site-cta px-7 text-[15px] font-medium text-brand-foreground shadow-raised transition-colors hover:bg-site-cta-hover active:scale-[.98] [&_svg]:size-4";
  const quiet =
    "inline-flex h-12 items-center justify-center gap-2 rounded-full border border-site-ink/15 bg-card px-6 text-[15px] font-medium text-site-ink transition-colors hover:border-site-ink/40 [&_svg]:size-4";
  const textLink =
    "group inline-flex items-center gap-2 text-[15px] font-medium text-site-ink underline decoration-site-champagne decoration-1 underline-offset-[6px] hover:decoration-site-ink";

  const facts = [
    s.since ? { value: String(s.since), label: t("factFounded") } : null,
    years && years > 0 ? { value: `${years}+`, label: t("factYears") } : null,
    cities.length ? { value: String(cities.length), label: t("factCities") } : null,
    specialties.length ? { value: String(specialties.length), label: t("factSpecialties") } : null,
  ].filter((f): f is { value: string; label: string } => f !== null);

  const faqs: { q: string; a: string }[] = [
    specialties.length
      ? {
          q: t("faqServicesQ"),
          a: t("faqServicesA", {
            list: specialties.map((x) => L(x.nameAr, x.nameEn)).join(ar ? "، " : ", "),
          }),
        }
      : null,
    {
      q: t("faqBookQ"),
      a: s.phone ? t("faqBookA", { phone: s.phone }) : t("faqBookNoPhoneA"),
    },
    { q: t("faqConsultQ"), a: t("faqConsultA") },
    { q: t("faqWhoQ"), a: t("faqWhoA") },
    cities.length ? { q: t("faqWhereQ"), a: t("faqWhereA", { cities: cityList }) } : null,
    {
      q: t("faqChangeQ"),
      a: t("faqChangeA", { hours: data.catalog.settings.cancellationWindowHours }),
    },
  ].filter((f): f is { q: string; a: string } => f !== null);

  const credentials = s.credentials ?? [];
  const showTrust = credentials.length > 0 || !!s.licence || clinic.isDemo;

  return (
    <div className="bg-card text-site-slate flex min-h-screen flex-col pb-20 sm:pb-0">
      {/* Demo / concept notice (always visible on this demo). */}
      <div
        className="bg-site-ink text-site-ivory/80 px-4 py-2 text-center text-xs"
        role="note"
        data-testid="site-concept"
      >
        {tApp("demoBanner")} · {t("concept", { name })}
      </div>

      {/* Sticky header: wordmark, sections, phone, language, Book. */}
      <header className="border-site-line bg-site-ivory/90 sticky top-0 z-40 border-b backdrop-blur-md">
        <div className="mx-auto flex h-20 max-w-7xl items-center gap-6 px-5 lg:px-8">
          <Link href="/" className="text-site-ink flex min-w-0 flex-col leading-none">
            <span
              className={cn(
                "font-display truncate",
                ar ? "text-2xl font-semibold" : "text-xl font-semibold tracking-[0.22em] uppercase",
              )}
            >
              {name}
            </span>
            {s.since && (
              <span className="text-site-subtle mt-1 hidden text-[11px] sm:block">
                {t("eyebrow", { year: s.since, cities: cityList })}
              </span>
            )}
          </Link>
          <nav className="text-site-slate ms-4 hidden items-center gap-8 text-sm lg:flex">
            {specialties.length > 0 && (
              <a href="#specialties" className="hover:text-site-ink transition-colors">
                {t("navSpecialties")}
              </a>
            )}
            {canBook && (
              <a href="#treatments" className="hover:text-site-ink transition-colors">
                {t("navTreatments")}
              </a>
            )}
            {data.doctors.length > 0 && (
              <a href="#team" className="hover:text-site-ink transition-colors">
                {t("navTeam")}
              </a>
            )}
            <a href="#visit" className="hover:text-site-ink transition-colors">
              {t("navVisit")}
            </a>
            <a href="#faq" className="hover:text-site-ink transition-colors">
              {t("navFaq")}
            </a>
          </nav>
          <div className="ms-auto flex items-center gap-3">
            {tel && (
              <a
                href={tel}
                className="text-site-ink hidden items-center gap-2 text-sm font-medium xl:inline-flex"
              >
                <Phone className="size-4" aria-hidden />
                <span dir="ltr">{s.phone}</span>
              </a>
            )}
            <LanguageToggle />
            {canBook && (
              <Link
                href={bookHref}
                className={cn(cta, "hidden h-11 px-6 sm:inline-flex")}
                data-testid="nav-book"
              >
                {t("book")}
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section className="bg-site-ivory relative overflow-hidden">
          <div className="mx-auto grid max-w-7xl gap-14 px-5 pt-14 pb-24 lg:grid-cols-12 lg:gap-10 lg:px-8 lg:pt-24 lg:pb-32">
            <div className="flex flex-col justify-center gap-8 lg:col-span-7">
              {s.since && <Eyebrow>{t("eyebrow", { year: s.since, cities: cityList })}</Eyebrow>}
              <h1 className="font-display text-site-ink text-[2.5rem] leading-[1.08] font-medium sm:text-6xl lg:text-[4.6rem] lg:leading-[1.02]">
                {L(s.headlineAr, s.headlineEn) || name}
              </h1>
              {L(s.taglineAr, s.taglineEn) && (
                <p className="text-site-slate max-w-xl text-lg leading-relaxed">
                  {L(s.taglineAr, s.taglineEn)}
                </p>
              )}
              {canBook && (
                <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
                  <Link href={bookHref} className={cta} data-testid="hero-book">
                    <CalendarCheck />
                    {t("book")}
                  </Link>
                  {data.videoService && (
                    <Link href={videoHref} className={textLink} data-testid="hero-video">
                      <Video className="size-4" aria-hidden />
                      {t("videoCta")}
                    </Link>
                  )}
                  {tel && (
                    <a href={tel} className={cn(textLink, "sm:hidden")}>
                      <Phone className="size-4" aria-hidden />
                      <span dir="ltr">{s.phone}</span>
                    </a>
                  )}
                </div>
              )}
            </div>

            <div className="relative lg:col-span-5">
              <Photo
                label={t("photoHero")}
                monogram={monogram}
                className="mx-auto aspect-[4/5] w-full max-w-md rounded-t-full rounded-b-3xl"
              />
              {canBook && (
                <div
                  className="border-site-line bg-card shadow-float relative mx-4 -mt-24 rounded-2xl border p-6 sm:mx-auto sm:max-w-sm lg:absolute lg:-start-10 lg:bottom-8 lg:mx-0 lg:mt-0 lg:w-80"
                  data-testid="next-free"
                >
                  <div className="text-site-subtle text-xs font-medium">{t("nextTitle")}</div>
                  {data.nextFree.length > 0 ? (
                    <ul className="divide-site-line mt-3 divide-y">
                      {data.nextFree.map((iso) => {
                        const d = new Date(iso);
                        return (
                          <li key={iso}>
                            <Link
                              href={consultHref}
                              className="hover:text-site-ink flex items-center justify-between gap-3 py-2.5 transition-colors"
                            >
                              <span className="text-sm">
                                {formatGregorian(d, locale, "medium")}
                              </span>
                              <span className="text-site-ink font-mono text-sm" dir="ltr">
                                {formatTime(d, locale)}
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm">{t("nextNone")}</p>
                  )}
                  <div className="border-site-line mt-3 flex items-center justify-between gap-2 border-t pt-3 text-xs">
                    <span className="text-site-subtle truncate">
                      {data.firstService &&
                        pick(locale, data.firstService.nameAr, data.firstService.nameEn)}
                      {nextBranch && ` · ${pick(locale, nextBranch.cityAr, nextBranch.cityEn)}`}
                    </span>
                    <Link
                      href={consultHref}
                      className="text-site-ink inline-flex shrink-0 items-center gap-1 font-medium hover:underline"
                    >
                      {t("nextMore")}
                      <Forward className="size-3.5" aria-hidden />
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── Facts (only real ones) ───────────────────────────────────────── */}
        {facts.length > 0 && (
          <section className="border-site-line border-y">
            <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
              <dl className="grid grid-cols-2 gap-y-10 md:grid-cols-4">
                {facts.map((f, i) => (
                  <div
                    key={f.label}
                    className={cn(
                      "flex flex-col items-center gap-1 text-center",
                      i > 0 && "md:border-site-line md:border-s",
                    )}
                  >
                    <dd
                      className="font-display text-site-ink text-5xl font-medium lg:text-6xl"
                      dir="ltr"
                    >
                      {f.value}
                    </dd>
                    <dt className="text-site-subtle text-sm">{f.label}</dt>
                  </div>
                ))}
              </dl>
              <p className="font-display text-site-ink mt-12 text-center text-xl italic lg:text-2xl">
                {t("factConsult")}
              </p>
            </div>
          </section>
        )}

        {/* ── Specialties (the clinic's own departments and treatments) ────── */}
        {specialties.length > 0 && (
          <section id="specialties" className="scroll-mt-24 py-24 lg:py-32">
            <div className="mx-auto max-w-7xl px-5 lg:px-8">
              <SectionHead
                eyebrow={t("specialtiesEyebrow")}
                title={t("specialtiesTitle")}
                text={t("specialtiesText")}
              />
              <div className="mt-16 flex flex-col gap-24 lg:mt-24 lg:gap-32">
                {specialties.map((sp, i) => {
                  const spName = L(sp.nameAr, sp.nameEn);
                  return (
                    <article
                      key={sp.key}
                      className="grid items-center gap-10 lg:grid-cols-12 lg:gap-20"
                      data-testid="site-specialty"
                    >
                      <Photo
                        label={spName}
                        monogram={monogram}
                        className={cn(
                          "aspect-[5/4] w-full rounded-3xl lg:col-span-6",
                          i % 2 === 1 && "lg:order-2",
                        )}
                      />
                      <div className="flex flex-col gap-6 lg:col-span-6">
                        <span className="font-display text-site-champagne text-2xl" dir="ltr">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <h3 className="font-display text-site-ink text-3xl leading-tight font-medium lg:text-[2.75rem]">
                          {spName}
                        </h3>
                        <p className="max-w-lg text-lg leading-relaxed">
                          {L(sp.textAr, sp.textEn)}
                        </p>
                        {sp.items && sp.items.length > 0 && (
                          <ul className="border-site-line grid gap-x-8 border-t sm:grid-cols-2">
                            {sp.items.map((it) => (
                              <li
                                key={it.en}
                                className="border-site-line flex gap-3 border-b py-3 text-[15px]"
                              >
                                <span
                                  className="bg-site-champagne mt-[0.7em] h-px w-4 shrink-0"
                                  aria-hidden
                                />
                                {L(it.ar, it.en)}
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="pt-2">
                          {sp.bookable && canBook ? (
                            <Link href={consultHref} className={textLink}>
                              {t("bookSpecialty")}
                              <Forward
                                className="size-4 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1"
                                aria-hidden
                              />
                            </Link>
                          ) : wa || tel ? (
                            <a
                              href={(wa ?? tel)!}
                              target={wa ? "_blank" : undefined}
                              rel="noopener noreferrer"
                              className={textLink}
                            >
                              {wa ? (
                                <MessageCircle className="size-4" aria-hidden />
                              ) : (
                                <Phone className="size-4" aria-hidden />
                              )}
                              {t("askSpecialty", { name: spName })}
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* ── Book online: the treatments bookable here, then the CTA ───────── */}
        {canBook && (
          <section id="treatments" className="bg-site-ivory scroll-mt-24 py-24 lg:py-32">
            <div className="mx-auto max-w-7xl px-5 lg:px-8">
              <SectionHead
                eyebrow={t("treatmentsEyebrow")}
                title={t("treatmentsTitle")}
                text={t("treatmentsText")}
              />
              <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.catalog.departments
                  .flatMap((d) => d.services)
                  .map((svc) => (
                    <li key={svc.id}>
                      <Link
                        href={`/book?mode=${svc.isVirtual ? "video" : "clinic"}&service=${svc.id}`}
                        className="border-site-line bg-card hover:border-site-ink/30 hover:shadow-raised group flex h-full flex-col gap-6 rounded-2xl border p-7 transition-[border-color,box-shadow]"
                        data-testid="site-service"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span className="font-display text-site-ink text-2xl leading-snug font-medium">
                            {pick(locale, svc.nameAr, svc.nameEn)}
                          </span>
                          {svc.isVirtual && (
                            <span className="bg-site-champagne-soft text-site-champagne-ink inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium">
                              <Video className="size-3" aria-hidden />
                              {t("videoBadge")}
                            </span>
                          )}
                        </div>
                        <div className="mt-auto flex items-end justify-between gap-3 text-sm">
                          <div className="flex flex-col gap-0.5">
                            {svc.priceHalalas !== null && (
                              <span className="text-site-ink font-medium">
                                {t("fromPrice", { price: formatSAR(svc.priceHalalas, locale) })}
                              </span>
                            )}
                            <span className="text-site-subtle">
                              {t("minutes", { n: svc.durationMinutes })}
                            </span>
                          </div>
                          <span className="border-site-line text-site-ink group-hover:bg-site-ink group-hover:text-site-ivory flex size-10 items-center justify-center rounded-full border transition-colors">
                            <Forward className="size-4" aria-hidden />
                          </span>
                        </div>
                      </Link>
                    </li>
                  ))}
              </ul>

              {/* End of services: the booking CTA, with how booking works. */}
              <div className="bg-site-ink text-site-ivory/75 mt-16 rounded-[2rem] px-7 py-12 lg:px-16 lg:py-16">
                <div className="grid gap-10 lg:grid-cols-12 lg:items-center">
                  <div className="lg:col-span-7">
                    <h3 className="font-display text-site-ivory text-3xl leading-tight font-medium lg:text-5xl">
                      {t("treatmentsCtaTitle")}
                    </h3>
                    <p className="mt-4 max-w-xl text-lg">{t("treatmentsCtaText")}</p>
                  </div>
                  <div className="flex lg:col-span-5 lg:justify-end">
                    <Link
                      href={consultHref}
                      className="bg-site-ivory text-site-ink hover:bg-card inline-flex h-14 items-center justify-center gap-2 rounded-full px-8 text-base font-medium transition-colors [&_svg]:size-4"
                      data-testid="treatments-book"
                    >
                      <CalendarCheck />
                      {t("book")}
                    </Link>
                  </div>
                </div>
                <ol className="border-site-ivory/15 mt-12 grid gap-8 border-t pt-10 md:grid-cols-3">
                  {(
                    [
                      ["how1", "how1Text"],
                      ["how2", "how2Text"],
                      ["how3", "how3Text"],
                    ] as const
                  ).map(([title, text], i) => (
                    <li key={title} className="flex gap-4">
                      <span
                        className="font-display text-site-champagne text-3xl leading-none"
                        dir="ltr"
                      >
                        {i + 1}
                      </span>
                      <div>
                        <div className="text-site-ivory font-medium">{t(title)}</div>
                        <p className="mt-1 text-sm leading-relaxed">{t(text)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </section>
        )}

        {/* ── Medical team ─────────────────────────────────────────────────── */}
        {data.doctors.length > 0 && (
          <section id="team" className="scroll-mt-24 py-24 lg:py-32">
            <div className="mx-auto max-w-7xl px-5 lg:px-8">
              <SectionHead eyebrow={t("teamEyebrow")} title={t("teamTitle")} text={t("teamText")} />
              {clinic.isDemo && (
                <p className="text-site-subtle mt-4 text-sm" data-testid="team-demo">
                  {t("teamDemo")}
                </p>
              )}
              <ul className="mt-14 grid grid-cols-2 gap-x-5 gap-y-12 lg:grid-cols-4 lg:gap-x-8">
                {data.doctors.map((d) => {
                  const branch = data.branches.find((b) => b.id === d.branchId);
                  const docName = pick(locale, d.nameAr, d.nameEn);
                  return (
                    <li key={d.id} className="flex flex-col gap-4">
                      <Photo
                        label={t("photoPortrait")}
                        monogram={docName.replace(/^(د\.|Dr\.?)\s*/i, "").charAt(0)}
                        className="aspect-[3/4] w-full rounded-t-full rounded-b-2xl"
                      />
                      <div>
                        <div className="font-display text-site-ink text-xl leading-snug font-medium lg:text-2xl">
                          {docName}
                        </div>
                        {(d.titleAr || d.titleEn) && (
                          <div className="mt-1 text-sm">
                            {pick(locale, d.titleAr ?? d.titleEn ?? "", d.titleEn)}
                          </div>
                        )}
                        <div className="text-site-subtle mt-1 flex items-center gap-1 text-xs">
                          <MapPin className="size-3" aria-hidden />
                          {branch ? pick(locale, branch.cityAr, branch.cityEn) : cityList}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        )}

        {/* ── Credentials & results ────────────────────────────────────────── */}
        {showTrust && (
          <section className="bg-site-mist py-24 lg:py-32">
            <div className="mx-auto grid max-w-7xl gap-14 px-5 lg:grid-cols-12 lg:px-8">
              <div className="flex flex-col gap-8 lg:col-span-4">
                <SectionHead eyebrow={t("trustEyebrow")} title={t("trustTitle")} />
                <div>
                  <div className="text-site-ink text-sm font-medium">{t("credentials")}</div>
                  {credentials.length > 0 || s.licence ? (
                    <ul className="mt-3 flex flex-col">
                      {s.licence && <Credential>{t("licence", { n: s.licence })}</Credential>}
                      {credentials.map((c) => (
                        <Credential key={c.en}>{L(c.ar, c.en)}</Credential>
                      ))}
                    </ul>
                  ) : (
                    <p className="border-site-champagne/60 text-site-subtle mt-3 rounded-xl border border-dashed p-4 text-sm">
                      {t("credentialsEmpty")}
                    </p>
                  )}
                </div>
              </div>
              {clinic.isDemo && (
                <div className="lg:col-span-8">
                  <div className="text-site-ink text-sm font-medium">{t("results")}</div>
                  <p className="text-site-subtle text-sm">{t("resultsNote")}</p>
                  <div className="mt-5 grid gap-4 sm:grid-cols-3">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="border-site-line bg-card grid grid-cols-2 gap-1 overflow-hidden rounded-2xl border p-1"
                      >
                        <Photo label={t("resultsSlot")} className="aspect-[3/4] rounded-xl" />
                        <Photo className="aspect-[3/4] rounded-xl" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Reviews (only real ones from Settings → Website) ─────────────── */}
        {(s.reviews?.length ?? 0) > 0 && (
          <section className="py-24 lg:py-32">
            <div className="mx-auto max-w-7xl px-5 lg:px-8">
              <SectionHead eyebrow={t("trustEyebrow")} title={t("reviewsTitle")} />
              <ul className="mt-14 grid gap-12 md:grid-cols-3">
                {s.reviews!.slice(0, 6).map((r, i) => (
                  <li key={i} className="border-site-champagne flex flex-col gap-4 border-s ps-6">
                    <blockquote className="font-display text-site-ink text-2xl leading-snug">
                      “{r.quote}”
                    </blockquote>
                    <div className="text-site-subtle text-sm">
                      {r.name}
                      {r.treatment && ` · ${r.treatment}`}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* ── Video consultations ──────────────────────────────────────────── */}
        {data.videoService && canBook && (
          <section className="px-5 pb-24 lg:px-8 lg:pb-32">
            <div className="bg-site-champagne-soft mx-auto grid max-w-7xl items-center gap-10 overflow-hidden rounded-[2rem] p-7 lg:grid-cols-2 lg:gap-16 lg:p-16">
              <div className="flex flex-col gap-5">
                <Eyebrow>{t("videoEyebrow")}</Eyebrow>
                <h2 className="font-display text-site-ink text-3xl leading-tight font-medium lg:text-5xl">
                  {t("videoTitle")}
                </h2>
                <p className="text-lg leading-relaxed">{t("videoText")}</p>
                <ul className="flex flex-col gap-2 text-[15px]">
                  {(["videoPoint1", "videoPoint2", "videoPoint3"] as const).map((k) => (
                    <li key={k} className="flex items-center gap-3">
                      <ShieldCheck
                        className="text-site-champagne-ink size-4 shrink-0"
                        aria-hidden
                      />
                      {t(k)}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center gap-4 pt-2">
                  <Link href={videoHref} className={quiet}>
                    <Video />
                    {t("videoCta")}
                  </Link>
                  {data.videoService.priceHalalas !== null && (
                    <span className="text-site-ink text-sm font-medium">
                      {formatSAR(data.videoService.priceHalalas, locale)}
                    </span>
                  )}
                </div>
              </div>
              <Photo
                label={pick(locale, data.videoService.nameAr, data.videoService.nameEn)}
                monogram={monogram}
                className="aspect-[4/3] w-full rounded-3xl"
              />
            </div>
          </section>
        )}

        {/* ── Visit us ─────────────────────────────────────────────────────── */}
        {data.branches.length > 0 && (
          <section id="visit" className="bg-site-ivory scroll-mt-24 py-24 lg:py-32">
            <div className="mx-auto max-w-7xl px-5 lg:px-8">
              <SectionHead eyebrow={t("visitEyebrow")} title={cityList || t("visitTitle")} />
              <ul className="mt-14 grid gap-5 md:grid-cols-2">
                {data.branches.map((b) => (
                  <li
                    key={b.id}
                    className="border-site-line bg-card flex flex-col gap-6 rounded-2xl border p-8 lg:p-10"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-display text-site-ink text-3xl font-medium lg:text-4xl">
                          {pick(locale, b.cityAr, b.cityEn)}
                        </div>
                        <div className="text-site-subtle mt-1 text-sm">
                          {pick(locale, b.nameAr, b.nameEn)}
                        </div>
                      </div>
                      {b.video && (
                        <span className="bg-site-champagne-soft text-site-champagne-ink inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium">
                          <Video className="size-3" aria-hidden />
                          {t("videoHere")}
                        </span>
                      )}
                    </div>
                    <dl className="border-site-line grid grid-cols-[6rem_1fr] gap-y-3 border-t pt-6 text-[15px]">
                      <dt className="text-site-subtle">{t("branchDays")}</dt>
                      <dd className="text-site-ink">
                        {b.days.length ? b.days.map(weekday).join(" · ") : t("closed")}
                      </dd>
                      {b.from && b.to && (
                        <>
                          <dt className="text-site-subtle">{t("branchHours")}</dt>
                          <dd className="text-site-ink font-mono" dir="ltr">
                            {b.from} – {b.to}
                          </dd>
                        </>
                      )}
                    </dl>
                    <div className="mt-auto flex flex-wrap gap-x-6 gap-y-3">
                      {tel && (
                        <a href={tel} className={textLink}>
                          <Phone className="size-4" aria-hidden />
                          <span dir="ltr">{s.phone}</span>
                        </a>
                      )}
                      {b.mapUrl && (
                        <a
                          href={b.mapUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={textLink}
                        >
                          <MapPin className="size-4" aria-hidden />
                          {t("map")}
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* ── FAQ ──────────────────────────────────────────────────────────── */}
        <section id="faq" className="scroll-mt-24 py-24 lg:py-32">
          <div className="mx-auto grid max-w-7xl gap-12 px-5 lg:grid-cols-12 lg:px-8">
            <div className="lg:col-span-4">
              <SectionHead eyebrow={t("faqEyebrow")} title={t("faqTitle")} />
            </div>
            <div className="border-site-line border-t lg:col-span-8">
              {faqs.map((f) => (
                <details key={f.q} className="border-site-line group border-b py-6">
                  <summary className="font-display text-site-ink flex cursor-pointer list-none items-center justify-between gap-6 text-xl font-medium lg:text-2xl [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <span
                      className="border-site-line text-site-ink flex size-9 shrink-0 items-center justify-center rounded-full border font-sans text-lg transition-transform group-open:rotate-45"
                      aria-hidden
                    >
                      +
                    </span>
                  </summary>
                  <p className="mt-4 max-w-2xl text-[15px] leading-relaxed">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── Final call to action ─────────────────────────────────────────── */}
        {canBook && (
          <section className="bg-site-ivory border-site-line border-t">
            <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-5 py-24 text-center lg:py-32">
              <Eyebrow center>{name}</Eyebrow>
              <h2 className="font-display text-site-ink text-4xl leading-tight font-medium lg:text-6xl">
                {t("finalTitle")}
              </h2>
              <p className="text-lg">{t("finalText")}</p>
              <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4 pt-2">
                <Link href={bookHref} className={cta} data-testid="final-book">
                  <CalendarCheck />
                  {t("book")}
                </Link>
                {tel && (
                  <a href={tel} className={textLink}>
                    <Phone className="size-4" aria-hidden />
                    <span dir="ltr">{s.phone}</span>
                  </a>
                )}
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="bg-site-ink text-site-ivory/70">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 text-sm md:grid-cols-12 lg:px-8">
          <div className="flex flex-col gap-4 md:col-span-5">
            <span
              className={cn(
                "font-display text-site-ivory",
                ar ? "text-2xl font-semibold" : "text-xl font-semibold tracking-[0.22em] uppercase",
              )}
            >
              {name}
            </span>
            {L(s.aboutAr, s.aboutEn) && (
              <p className="max-w-md leading-relaxed">{L(s.aboutAr, s.aboutEn)}</p>
            )}
          </div>
          {specialties.length > 0 && (
            <div className="flex flex-col gap-3 md:col-span-3">
              <div className="text-site-ivory font-medium">{t("footerSpecialties")}</div>
              {specialties.map((x) => (
                <a key={x.key} href="#specialties" className="hover:text-site-ivory">
                  {L(x.nameAr, x.nameEn)}
                </a>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-3 md:col-span-4">
            <div className="text-site-ivory font-medium">{t("footerContact")}</div>
            {tel && (
              <a href={tel} className="hover:text-site-ivory w-fit" dir="ltr">
                {s.phone}
              </a>
            )}
            {wa && (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-site-ivory w-fit"
              >
                {t("whatsapp")}
              </a>
            )}
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {s.instagram && (
                <Social href={`https://instagram.com/${s.instagram.replace(/^@/, "")}`}>
                  {t("instagram")}
                </Social>
              )}
              {s.x && <Social href={`https://x.com/${s.x.replace(/^@/, "")}`}>{t("x")}</Social>}
              {s.tiktok && (
                <Social href={`https://www.tiktok.com/@${s.tiktok.replace(/^@/, "")}`}>
                  {t("tiktok")}
                </Social>
              )}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 pt-2">
              <Link href="/my" className="hover:text-site-ivory">
                {t("myAppointments")}
              </Link>
              <Link href="/login" className="hover:text-site-ivory">
                {t("staff")}
              </Link>
            </div>
          </div>
        </div>
        <div className="border-site-ivory/10 border-t">
          <div className="text-site-ivory/50 mx-auto flex max-w-7xl flex-col gap-2 px-5 py-6 text-xs md:flex-row md:justify-between lg:px-8">
            <span>
              {t("footerRights", { year: new Date().getFullYear(), name })}
              {s.licence && ` · ${t("licence", { n: s.licence })}`}
            </span>
            <span>{t("concept", { name })}</span>
          </div>
        </div>
      </footer>

      {/* Phones: Book stays under the thumb. */}
      {canBook && (
        <div className="border-site-line bg-site-ivory/95 fixed inset-x-0 bottom-0 z-40 flex gap-2 border-t p-3 backdrop-blur-md sm:hidden">
          <Link href={bookHref} className={cn(cta, "flex-1 shadow-none")} data-testid="sticky-book">
            <CalendarCheck />
            {t("book")}
          </Link>
          {wa && (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("whatsapp")}
              className={cn(quiet, "w-12 px-0")}
            >
              <MessageCircle />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function Eyebrow({ children, center = false }: { children: ReactNode; center?: boolean }) {
  return (
    <span
      className={cn(
        "text-site-champagne-ink flex items-center gap-3 text-xs font-medium ltr:tracking-[0.2em] ltr:uppercase",
        center && "justify-center",
      )}
    >
      <span className="bg-site-champagne h-px w-8" aria-hidden />
      {children}
    </span>
  );
}

function SectionHead({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) {
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="font-display text-site-ink text-4xl leading-[1.1] font-medium lg:text-[3.25rem]">
        {title}
      </h2>
      {text && <p className="text-lg leading-relaxed">{text}</p>}
    </div>
  );
}

function Credential({ children }: { children: ReactNode }) {
  return (
    <li className="border-site-line text-site-ink flex items-center gap-3 border-b py-3 text-[15px]">
      <ShieldCheck className="text-site-champagne-ink size-4 shrink-0" aria-hidden />
      {children}
    </li>
  );
}

function Social({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="hover:text-site-ivory">
      {children}
    </a>
  );
}

/**
 * Placeholder for the clinic's own photography: a soft tinted frame with a monogram and a
 * small label, so the layout reads as finished until real photos are added.
 */
function Photo({
  label,
  monogram,
  className,
}: {
  label?: string;
  monogram?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "from-brand-soft via-site-mist to-site-champagne-soft relative overflow-hidden bg-linear-to-br",
        className,
      )}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <div className="border-site-ivory/80 absolute inset-3 rounded-[inherit] border" aria-hidden />
      {monogram && (
        <span
          className="font-display text-site-ivory absolute inset-0 flex items-center justify-center text-[clamp(4rem,14vw,10rem)] leading-none select-none"
          aria-hidden
        >
          {monogram}
        </span>
      )}
      {label && (
        <span className="bg-site-ivory/85 text-site-subtle absolute start-5 bottom-5 max-w-[80%] truncate rounded-full px-3 py-1 text-[11px] font-medium">
          {label}
        </span>
      )}
    </div>
  );
}
