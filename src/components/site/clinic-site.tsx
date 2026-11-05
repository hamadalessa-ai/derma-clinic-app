import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  CalendarCheck,
  Crown,
  MapPin,
  MessageCircle,
  Phone,
  ShieldCheck,
  Video,
} from "lucide-react";
import { pick } from "@/lib/brand";
import { formatSAR } from "@/lib/format";
import type { ClinicSiteData } from "@/lib/site/data";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/config";
import { BeforeAfter } from "./site-before-after";
import { SiteDoctors, type DoctorCard } from "./site-doctors";
import { SiteHeader, telHref, waHref } from "./site-header";
import { SiteHero } from "./site-hero";
import { SiteImage } from "./site-image";
import { SiteTreatments, type TreatmentSilo } from "./site-treatments";

/**
 * The clinic's public website ("/") — "clinical luxury": true white and soft clinical gray,
 * deep slate text, deep emerald for the main action, matte gold accents, Playfair Display
 * headings. Content is the clinic's own (Settings → Website); booking is our booking platform:
 * every Book button opens /book (mobile code first), pre-selecting what the visitor chose.
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
  const name = pick(locale, clinic.nameAr, clinic.nameEn);
  const s = data.site;
  const ar = locale === "ar";
  const L = (a?: string, e?: string) => (ar ? a || e : e || a) ?? "";
  const tel = telHref(s.phone);
  const wa = waHref(s.whatsapp);
  const canBook = data.catalog.enabled && data.catalog.departments.length > 0;
  const consultHref = data.firstService
    ? `/book?mode=clinic&service=${data.firstService.id}`
    : "/book";
  const videoHref = data.videoService
    ? `/book?mode=video&service=${data.videoService.id}`
    : "/book?mode=video";

  const departments = s.departments ?? [];
  const doctors = s.doctors ?? [];
  const silos = s.silos ?? [];
  const deptOf = (k: string) => (k === "hair" ? "skin" : k);
  const deptName = (k: string) => {
    const d = departments.find((x) => x.key === k);
    return d ? L(d.nameAr, d.nameEn) : k;
  };
  /** Departments booked online here (the others: WhatsApp until they are). */
  const onlineDept = (k: string) => canBook && deptOf(k) === "skin";
  const deptBook = (k: string) =>
    onlineDept(k)
      ? { label: t("bookConsult"), href: consultHref, external: false }
      : { label: t("bookWhatsapp"), href: wa ?? "#contact", external: !!wa };

  // Treatments bookable online link straight to that treatment in booking.
  const online = data.catalog.departments.flatMap((d) => d.services).filter((x) => !x.isVirtual);
  const serviceFor = (itemEn: string) =>
    online.find((x) => itemEn.toLowerCase().includes(x.nameEn.toLowerCase())) ??
    online.find((x) => x.nameEn.toLowerCase().includes(itemEn.toLowerCase()));
  const treatmentSilos: TreatmentSilo[] = silos.map((x) => ({
    key: x.key,
    dept: deptOf(x.dept),
    name: L(x.nameAr, x.nameEn),
    items: x.items.map((it) => {
      const svc = onlineDept(x.dept) ? serviceFor(it.en) : undefined;
      return {
        name: L(it.ar, it.en),
        href: svc ? `/book?mode=clinic&service=${svc.id}` : null,
      };
    }),
    cta: deptBook(x.dept),
  }));
  const siloDepts = [...new Set(silos.map((x) => deptOf(x.dept)))].map((k) => ({
    key: k,
    name: deptName(k),
  }));

  const founder = doctors.find((d) => d.founder);
  const team: DoctorCard[] = doctors
    .filter((d) => !d.founder)
    .map((d) => ({
      name: L(d.nameAr, d.nameEn),
      title: L(d.titleAr, d.titleEn),
      dept: deptOf(d.dept),
      branch: d.branchAr || d.branchEn ? L(d.branchAr, d.branchEn) : null,
      photo: d.photo,
      book: d.memberId
        ? { label: t("doctorBook"), href: `/book?doctor=${d.memberId}`, external: false }
        : onlineDept(d.dept)
          ? { label: t("doctorBook"), href: consultHref, external: false }
          : { label: t("bookWhatsapp"), href: wa ?? "#contact", external: !!wa },
    }));
  const teamDepts = [...new Set(team.map((d) => d.dept))].map((k) => ({
    key: k,
    name: deptName(k),
  }));

  const years = s.since ? new Date().getFullYear() - s.since : null;
  const facts = [
    s.since ? { value: String(s.since), label: t("factFounded") } : null,
    years ? { value: `${years}+`, label: t("factYears") } : null,
    doctors.length ? { value: String(doctors.length), label: t("factDoctors") } : null,
    departments.length ? { value: String(departments.length), label: t("factDepartments") } : null,
  ].filter((f): f is { value: string; label: string } => !!f);

  const cities = [...new Set(data.branches.map((b) => pick(locale, b.cityAr, b.cityEn)))];
  const weekday = (d: number) =>
    new Intl.DateTimeFormat(ar ? "ar-SA" : "en-SA", { weekday: "short" }).format(
      new Date(Date.UTC(2023, 0, 1 + d)),
    );
  const faqs = [
    {
      q: t("faq1q", { name }),
      a: t("faq1a", {
        list: departments.map((d) => L(d.nameAr, d.nameEn)).join(ar ? "، " : ", "),
      }),
    },
    { q: t("faq2q"), a: s.phone ? t("faq2a", { phone: s.phone }) : t("faq2aNoPhone") },
    { q: t("faq3q"), a: t("faq3a") },
    { q: t("faq4q"), a: t("faq4a") },
    { q: t("faq5q", { name }), a: t("faq5a", { cities: cities.join(ar ? " و" : " and ") }) },
  ];

  return (
    <div className="font-site text-site-slate bg-card flex min-h-screen flex-col pb-20 sm:pb-0">
      <div
        className="bg-site-champagne-soft text-site-champagne-ink px-4 py-1.5 text-center text-[11px]"
        role="note"
        data-testid="site-concept"
      >
        {t("concept", { name })}
      </div>

      <SiteHeader
        locale={locale}
        name={name}
        site={s}
        canBook={canBook}
        hasOffers={data.offers.length > 0}
      />

      <main className="flex-1">
        <SiteHero
          locale={locale}
          name={name}
          site={s}
          canBook={canBook}
          consultHref={consultHref}
          nextFree={data.nextFree}
          doctorCount={doctors.length}
        />

        {/* ── About + Our Clinics ─────────────────────────────────────────── */}
        <section id="about" className="scroll-mt-28 pt-24 pb-24 lg:pt-32 lg:pb-32">
          <div className="mx-auto grid max-w-7xl gap-16 px-5 lg:grid-cols-12 lg:px-8">
            <div className="flex flex-col gap-8 lg:col-span-7">
              <Heading eyebrow={t("aboutEyebrow")} title={t("aboutTitle", { name })} />
              {L(s.aboutAr, s.aboutEn) && (
                <p className="text-[17px] leading-[1.9]">{L(s.aboutAr, s.aboutEn)}</p>
              )}
              {facts.length > 0 && (
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {facts.map((f) => (
                    <div key={f.label} className="bg-site-mist rounded-2xl p-5">
                      <dd
                        className="font-display text-site-primary text-3xl font-semibold"
                        dir="ltr"
                      >
                        {f.value}
                      </dd>
                      <dt className="text-site-subtle mt-1 text-sm">{f.label}</dt>
                    </div>
                  ))}
                </dl>
              )}
            </div>
            <div
              className="bg-site-mist flex flex-col gap-6 rounded-2xl p-7 lg:col-span-5 lg:p-9"
              id="clinics"
            >
              <h3 className="font-display text-site-ink text-2xl font-semibold">
                {t("clinicsTitle")}
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {(["brand-clinics", "brand-dental", "brand-light", "brand-hair"] as const).map(
                  (slot) => (
                    <div
                      key={slot}
                      className="bg-card flex aspect-[3/2] items-center justify-center rounded-xl shadow-sm"
                    >
                      <SiteImage
                        slot={slot}
                        src={s.images?.[slot]}
                        locale={locale}
                        fit="contain"
                        className="p-5"
                        showSpec={false}
                      />
                    </div>
                  ),
                )}
              </div>
              {L(s.clinicsAr, s.clinicsEn) && (
                <p className="text-[15px] leading-relaxed">{L(s.clinicsAr, s.clinicsEn)}</p>
              )}
            </div>
          </div>
        </section>

        {/* ── Departments ─────────────────────────────────────────────────── */}
        {departments.length > 0 && (
          <section id="departments" className="bg-site-mist scroll-mt-28 py-24 lg:py-32">
            <div className="mx-auto max-w-7xl px-5 lg:px-8">
              <Heading eyebrow={t("deptEyebrow")} title={t("deptTitle")} />
              <ul className="mt-14 grid gap-6 lg:grid-cols-3">
                {departments.map((d) => {
                  const slot = `dept-${d.key}`;
                  const cta = deptBook(d.key);
                  return (
                    <li
                      key={d.key}
                      id={`dept-${d.key}`}
                      className="bg-card shadow-soft group flex scroll-mt-28 flex-col overflow-hidden rounded-2xl"
                      data-testid="site-department"
                    >
                      <div className="aspect-video overflow-hidden">
                        <div className="h-full transition-transform duration-700 group-hover:scale-[1.04]">
                          <SiteImage slot={slot} src={s.images?.[slot]} locale={locale} />
                        </div>
                      </div>
                      <div className="flex flex-1 flex-col gap-4 p-7">
                        <h3 className="font-display text-site-ink text-2xl leading-snug font-semibold">
                          {L(d.nameAr, d.nameEn)}
                        </h3>
                        {L(d.textAr, d.textEn) && (
                          <p className="text-[15px] leading-relaxed">{L(d.textAr, d.textEn)}</p>
                        )}
                        <div className="mt-auto flex flex-wrap items-center gap-3 pt-2">
                          <CtaLink cta={cta} solid />
                          <a
                            href="#treatments"
                            className="text-site-primary text-sm font-semibold hover:underline"
                          >
                            {t("deptTreatments")}
                          </a>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        )}

        {/* ── Treatments by category ──────────────────────────────────────── */}
        {treatmentSilos.length > 0 && (
          <section id="treatments" className="scroll-mt-28 py-24 lg:py-32">
            <div className="mx-auto flex max-w-7xl flex-col gap-12 px-5 lg:px-8">
              <Heading eyebrow={t("treatEyebrow")} title={t("treatTitle")} text={t("treatText")} />
              <SiteTreatments
                silos={treatmentSilos}
                depts={siloDepts}
                labels={{ all: t("all"), book: t("bookShort"), count: t("treatCount") }}
              />
            </div>
          </section>
        )}

        {/* ── Our doctors ─────────────────────────────────────────────────── */}
        {doctors.length > 0 && (
          <section id="doctors" className="bg-site-mist scroll-mt-28 py-24 lg:py-32">
            <div className="mx-auto flex max-w-7xl flex-col gap-12 px-5 lg:px-8">
              <Heading
                eyebrow={t("doctorsEyebrow")}
                title={t("doctorsTitle")}
                text={L(s.doctorsAr, s.doctorsEn) || undefined}
              />
              {founder && (
                <article className="bg-card shadow-soft grid overflow-hidden rounded-2xl lg:grid-cols-2">
                  <div className="bg-site-mist">
                    {/* eslint-disable-next-line @next/next/no-img-element -- the clinic's own photo */}
                    <img
                      src={founder.photo}
                      alt={L(founder.nameAr, founder.nameEn)}
                      className="h-full w-full object-contain"
                    />
                  </div>
                  <div className="flex flex-col justify-center gap-4 p-8 lg:p-12">
                    <span className="bg-site-champagne-soft text-site-champagne-ink inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold">
                      <Crown className="size-3.5" aria-hidden />
                      {t("founder")}
                    </span>
                    <h3 className="font-display text-site-ink text-3xl font-semibold">
                      {L(founder.nameAr, founder.nameEn)}
                    </h3>
                    <p className="text-site-primary font-medium">
                      {L(founder.titleAr, founder.titleEn)}
                    </p>
                    {L(founder.bioAr, founder.bioEn) && (
                      <p className="text-[15px] leading-relaxed">
                        {L(founder.bioAr, founder.bioEn)}
                      </p>
                    )}
                  </div>
                </article>
              )}
              <SiteDoctors
                doctors={team}
                depts={teamDepts}
                labels={{ all: t("all"), more: t("doctorsMore") }}
              />
            </div>
          </section>
        )}

        {/* ── Offers ──────────────────────────────────────────────────────── */}
        {data.offers.length > 0 && (
          <section id="offers" className="scroll-mt-28 py-24 lg:py-32">
            <div className="mx-auto flex max-w-7xl flex-col gap-12 px-5 lg:px-8">
              <Heading
                eyebrow={t("offersEyebrow")}
                title={t("offersTitle")}
                text={t("offersText")}
              />
              <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {data.offers.map((o) => {
                  const full = o.servicePrice !== null ? o.servicePrice * o.sessions : null;
                  const save =
                    full && o.priceHalalas !== null && full > o.priceHalalas
                      ? Math.round(((full - o.priceHalalas) / full) * 100)
                      : null;
                  return (
                    <li
                      key={o.id}
                      className="bg-card shadow-soft border-site-champagne/30 relative flex flex-col gap-5 overflow-hidden rounded-2xl border p-7"
                      data-testid="site-offer"
                    >
                      <span
                        className="bg-site-champagne absolute inset-x-0 top-0 h-1"
                        aria-hidden
                      />
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-site-champagne-ink flex items-center gap-1.5 text-xs font-semibold">
                          <Crown className="size-3.5" aria-hidden />
                          {t("offerSessions", { n: o.sessions })}
                        </span>
                        {save !== null && save > 0 && (
                          <span className="bg-site-primary-soft text-site-primary rounded-full px-2.5 py-1 text-xs font-semibold">
                            {t("offerSave", { n: save })}
                          </span>
                        )}
                      </div>
                      <h3 className="font-display text-site-ink text-xl leading-snug font-semibold">
                        {pick(locale, o.nameAr, o.nameEn)}
                      </h3>
                      {o.priceHalalas !== null && (
                        <div className="flex items-baseline gap-2">
                          <span className="text-site-ink text-2xl font-semibold">
                            {formatSAR(o.priceHalalas, locale)}
                          </span>
                          {full !== null && full > o.priceHalalas && (
                            <span className="text-site-subtle text-sm line-through">
                              {formatSAR(full, locale)}
                            </span>
                          )}
                        </div>
                      )}
                      <p className="text-site-subtle text-sm">
                        {t("offerValid", { n: Math.round(o.validityDays / 30) })}
                      </p>
                      {o.bookable && canBook ? (
                        <Link
                          href={`/book?mode=clinic&service=${o.serviceId}`}
                          className="bg-site-primary text-site-ivory hover:bg-site-primary-hover mt-auto inline-flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors"
                        >
                          <CalendarCheck className="size-4" aria-hidden />
                          {t("offerBook")}
                        </Link>
                      ) : (
                        wa && (
                          <a
                            href={wa}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="border-site-primary/30 text-site-primary mt-auto inline-flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-semibold"
                          >
                            <MessageCircle className="size-4" aria-hidden />
                            {t("bookWhatsapp")}
                          </a>
                        )
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        )}

        {/* ── Results ─────────────────────────────────────────────────────── */}
        <section id="results" className="bg-site-mist scroll-mt-28 py-24 lg:py-32">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 lg:grid-cols-12 lg:px-8">
            <div className="flex flex-col gap-6 lg:col-span-5">
              <Heading
                eyebrow={t("resultsEyebrow")}
                title={t("resultsTitle")}
                text={t("resultsText")}
              />
              <p className="text-site-subtle flex items-start gap-2 text-sm">
                <ShieldCheck
                  className="text-site-champagne-ink mt-0.5 size-4 shrink-0"
                  aria-hidden
                />
                {t("resultsConsent")}
              </p>
            </div>
            <div className="lg:col-span-7">
              <BeforeAfter
                before={s.images?.["result-before"]}
                after={s.images?.["result-after"]}
                labels={{
                  before: t("before"),
                  after: t("after"),
                  drag: t("resultsDrag"),
                  placeholder: t("resultsPlaceholder"),
                }}
              />
            </div>
          </div>
        </section>

        {/* ── FAQ ─────────────────────────────────────────────────────────── */}
        <section id="faq" className="scroll-mt-28 py-24 lg:py-32">
          <div className="mx-auto grid max-w-7xl gap-12 px-5 lg:grid-cols-12 lg:px-8">
            <div className="lg:col-span-4">
              <Heading eyebrow={t("faqEyebrow")} title={t("faqTitle")} />
            </div>
            <div className="flex flex-col gap-3 lg:col-span-8">
              {faqs.map((f) => (
                <details key={f.q} className="bg-site-mist group rounded-2xl px-6 py-5">
                  <summary className="text-site-ink flex cursor-pointer list-none items-center justify-between gap-6 text-[17px] font-semibold [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <span
                      className="bg-card text-site-primary flex size-9 shrink-0 items-center justify-center rounded-full text-lg shadow-sm transition-transform group-open:rotate-45"
                      aria-hidden
                    >
                      +
                    </span>
                  </summary>
                  <p className="mt-3 max-w-2xl text-[15px] leading-relaxed">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── Contact ─────────────────────────────────────────────────────── */}
        <section id="contact" className="bg-site-mist scroll-mt-28 py-24 lg:py-32">
          <div className="mx-auto flex max-w-7xl flex-col gap-12 px-5 lg:px-8">
            <Heading
              eyebrow={t("contactEyebrow")}
              title={t("contactTitle")}
              text={L(s.findAr, s.findEn) || undefined}
            />
            <div className="grid gap-6 lg:grid-cols-3">
              {data.branches.map((b) => (
                <div key={b.id} className="bg-card shadow-soft flex flex-col gap-5 rounded-2xl p-7">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-display text-site-ink text-2xl font-semibold">
                        {pick(locale, b.cityAr, b.cityEn)}
                      </h3>
                      <p className="text-site-subtle text-sm">{pick(locale, b.nameAr, b.nameEn)}</p>
                    </div>
                    <MapPin className="text-site-champagne-ink size-5" aria-hidden />
                  </div>
                  <dl className="grid grid-cols-[5rem_1fr] gap-y-2 text-sm">
                    <dt className="text-site-subtle">{t("days")}</dt>
                    <dd className="text-site-ink">{b.days.map(weekday).join(" · ")}</dd>
                    {b.from && b.to && (
                      <>
                        <dt className="text-site-subtle">{t("hours")}</dt>
                        <dd className="text-site-ink font-medium" dir="ltr">
                          {b.from} – {b.to}
                        </dd>
                      </>
                    )}
                  </dl>
                  {b.mapUrl && (
                    <a
                      href={b.mapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-site-primary mt-auto text-sm font-semibold hover:underline"
                    >
                      {t("directions")}
                    </a>
                  )}
                </div>
              ))}
              <div className="bg-site-primary text-site-ivory flex flex-col gap-5 rounded-2xl p-7">
                <h3 className="font-display text-2xl font-semibold">{t("contactUs")}</h3>
                {tel && (
                  <a href={tel} className="flex items-center gap-3 text-lg font-semibold">
                    <Phone className="size-5" aria-hidden />
                    <span dir="ltr">{s.phone}</span>
                  </a>
                )}
                {wa && (
                  <a
                    href={wa}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 text-lg font-semibold"
                  >
                    <MessageCircle className="size-5" aria-hidden />
                    {t("utilityWhatsapp")}
                  </a>
                )}
                {data.videoService && canBook && (
                  <Link
                    href={videoHref}
                    className="text-site-ivory/85 flex items-center gap-3 text-sm hover:underline"
                  >
                    <Video className="size-4" aria-hidden />
                    {t("videoCta")}
                  </Link>
                )}
                {canBook && (
                  <Link
                    href="/book"
                    className="bg-site-ivory text-site-night mt-auto inline-flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-semibold"
                    data-testid="final-book"
                  >
                    <CalendarCheck className="size-4" aria-hidden />
                    {t("book")}
                  </Link>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ── Partners & accreditations (pre-footer) ─────────────────────── */}
        {(s.partners?.length || s.licence || (s.credentials?.length ?? 0) > 0) && (
          <section className="border-site-line border-t py-16" aria-labelledby="partners-title">
            <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 lg:px-8">
              <p id="partners-title" className="text-site-subtle text-center text-sm font-semibold">
                {t("partnersTitle")}
              </p>
              {(s.licence || (s.credentials?.length ?? 0) > 0) && (
                <ul className="flex flex-wrap justify-center gap-3 text-sm">
                  {s.licence && <Badge>{t("licence", { n: s.licence })}</Badge>}
                  {s.credentials?.map((c) => (
                    <Badge key={c.en}>{L(c.ar, c.en)}</Badge>
                  ))}
                </ul>
              )}
              {s.partners && s.partners.length > 0 && (
                <ul className="grid grid-cols-3 gap-x-6 gap-y-8 sm:grid-cols-5 lg:grid-cols-10">
                  {s.partners.map((p) => (
                    <li key={p.nameEn} className="flex h-14 items-center justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element -- partner logos as published by the clinic */}
                      <img
                        src={p.logo}
                        alt={L(p.nameAr, p.nameEn)}
                        title={L(p.nameAr, p.nameEn)}
                        loading="lazy"
                        className="max-h-14 w-auto max-w-full object-contain opacity-60 grayscale transition hover:opacity-100 hover:grayscale-0"
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}
      </main>

      <footer className="bg-site-night text-site-ivory/70">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 text-sm md:grid-cols-12 lg:px-8">
          <div className="flex flex-col gap-5 md:col-span-5">
            {s.images?.logo ? (
              <span className="bg-card w-fit rounded-xl px-4 py-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- the clinic's own logo */}
                <img src={s.images.logo} alt={name} className="h-9 w-auto" />
              </span>
            ) : (
              <span className="font-display text-site-ivory text-2xl">{name}</span>
            )}
            {L(s.footerAr, s.footerEn) && (
              <p className="max-w-md leading-relaxed">{L(s.footerAr, s.footerEn)}</p>
            )}
            <div className="flex gap-4">
              {s.x && <Social href={`https://x.com/${s.x}`}>X</Social>}
              {s.instagram && (
                <Social href={`https://www.instagram.com/${s.instagram}`}>Instagram</Social>
              )}
              {s.tiktok && <Social href={`https://www.tiktok.com/@${s.tiktok}`}>TikTok</Social>}
            </div>
          </div>
          <div className="flex flex-col gap-3 md:col-span-3">
            <span className="text-site-ivory font-semibold">{t("navDepartments")}</span>
            {departments.map((d) => (
              <a key={d.key} href={`#dept-${d.key}`} className="hover:text-site-ivory">
                {L(d.nameAr, d.nameEn)}
              </a>
            ))}
          </div>
          <div className="flex flex-col gap-3 md:col-span-4">
            <span className="text-site-ivory font-semibold">{t("navContact")}</span>
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
                {t("utilityWhatsapp")}
              </a>
            )}
            <Link href="/my" className="hover:text-site-ivory w-fit">
              {t("utilityPortal")}
            </Link>
            <Link href="/login" className="hover:text-site-ivory w-fit">
              {t("staff")}
            </Link>
          </div>
        </div>
        <div className="border-site-ivory/10 border-t">
          <div className="text-site-ivory/50 mx-auto flex max-w-7xl flex-col gap-2 px-5 py-6 text-xs md:flex-row md:justify-between lg:px-8">
            <span>{t("rights", { name, year: new Date().getFullYear() })}</span>
            <span>{t("concept", { name })}</span>
          </div>
        </div>
      </footer>

      {/* Phones: Book stays under the thumb. */}
      {canBook && (
        <div className="bg-card/95 shadow-float fixed inset-x-0 bottom-0 z-40 flex gap-2 p-3 backdrop-blur-md sm:hidden">
          <Link
            href="/book"
            className="bg-site-primary text-site-ivory flex h-12 flex-1 items-center justify-center gap-2 rounded-xl font-semibold"
            data-testid="sticky-book"
          >
            <CalendarCheck className="size-4" aria-hidden />
            {t("book")}
          </Link>
          {wa && (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("utilityWhatsapp")}
              className="border-site-line text-site-primary flex size-12 items-center justify-center rounded-xl border"
            >
              <MessageCircle className="size-5" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function Heading({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) {
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <span className="text-site-champagne-ink flex items-center gap-3 text-sm font-semibold">
        <span className="bg-site-champagne h-px w-8" aria-hidden />
        {eyebrow}
      </span>
      <h2 className="font-display text-site-ink text-3xl leading-tight font-semibold text-balance lg:text-[2.75rem]">
        {title}
      </h2>
      {text && <p className="text-[17px] leading-relaxed">{text}</p>}
    </div>
  );
}

function CtaLink({
  cta,
  solid = false,
}: {
  cta: { label: string; href: string; external: boolean };
  solid?: boolean;
}) {
  const cls = cn(
    "inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-semibold transition-colors",
    solid
      ? "bg-site-primary text-site-ivory hover:bg-site-primary-hover"
      : "border border-site-primary/30 text-site-primary",
  );
  return cta.external ? (
    <a href={cta.href} target="_blank" rel="noopener noreferrer" className={cls}>
      <MessageCircle className="size-4" aria-hidden />
      {cta.label}
    </a>
  ) : (
    <Link href={cta.href} className={cls}>
      <CalendarCheck className="size-4" aria-hidden />
      {cta.label}
    </Link>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <li className="bg-site-mist text-site-ink flex items-center gap-2 rounded-full px-4 py-2">
      <ShieldCheck className="text-site-champagne-ink size-4" aria-hidden />
      {children}
    </li>
  );
}

function Social({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="border-site-ivory/20 hover:border-site-ivory/60 hover:text-site-ivory rounded-full border px-3 py-1.5 text-xs"
    >
      {children}
    </a>
  );
}
