import type { ReactNode } from "react";
import { clinicIsActive, type ClinicStatus } from "@/lib/tenant/status";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { pick } from "@/lib/brand";
import { formatSAR } from "@/lib/format";
import type { ClinicSiteData } from "@/lib/site/data";
import type { Locale } from "@/i18n/config";
import { BeforeAfter } from "./site-before-after";
import { SiteDoctors, type DoctorCard } from "./site-doctors";
import { SiteHeader, telHref, waHref } from "./site-header";
import { SiteHero } from "./site-hero";
import { SiteImage } from "./site-image";
import { SiteChapters, type Chapter } from "./site-chapters";

type TreatmentSilo = {
  key: string;
  dept: string;
  name: string;
  items: { name: string; href: string | null }[];
  cta: { label: string; href: string; external: boolean };
};

/**
 * The clinic's public website ("/"), set like a print magazine: warm paper, charcoal ink, one
 * bronze accent, serif headlines, numbered sections divided by fine rules — no cards, shadows or
 * selling. Content is the clinic's own (Settings → Website); every invitation opens /book
 * (mobile code first), pre-selecting what the visitor chose.
 */
export async function ClinicSite({
  clinic,
  data,
  locale,
  staff = false,
}: {
  clinic: { nameAr: string; nameEn: string; isDemo: boolean; status?: ClinicStatus };
  data: ClinicSiteData;
  locale: Locale;
  /** A signed-in staff member is looking: "Staff sign-in" becomes "Open app". */
  staff?: boolean;
}) {
  const t = await getTranslations("site");
  const name = pick(locale, clinic.nameAr, clinic.nameEn);
  const s = data.site;
  const ar = locale === "ar";
  const L = (a?: string, e?: string) => (ar ? a || e : e || a) ?? "";
  const tel = telHref(s.phone);
  const wa = waHref(s.whatsapp);
  const canBook =
    clinicIsActive(clinic) && data.catalog.enabled && data.catalog.departments.length > 0;
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

  // Procedures & Services as chapters, one per specialty, in the clinic's order of services.
  const CHAPTER_IMAGES: Record<string, string[]> = {
    skin: ["dept-skin", "service-skin"],
    hair: ["dept-hair", "service-hair"],
    plastic: ["dept-plastic", "plastic-face"],
    dental: ["service-dental", "dept-dental"],
  };
  const chapterOrder = ["skin", "hair", "plastic", "dental"];
  const chapters: Chapter[] = chapterOrder
    .map((k): Chapter | null => {
      const sp = (s.specialties ?? []).find((x) => x.key === k);
      const dep = departments.find((x) => x.key === k);
      const groups = treatmentSilos.filter((x) =>
        k === "skin" || k === "hair"
          ? silos.find((y) => y.key === x.key)?.dept === k
          : x.dept === k,
      );
      if (!sp && !groups.length) return null;
      return {
        key: k,
        anchor: dep ? `dept-${k}` : `chapter-${k}`,
        title: sp ? L(sp.nameAr, sp.nameEn) : dep ? L(dep.nameAr, dep.nameEn) : k,
        lead: sp ? L(sp.leadAr, sp.leadEn) || undefined : undefined,
        intro: (dep && L(dep.textAr, dep.textEn)) || (sp ? L(sp.textAr, sp.textEn) : ""),
        images: (CHAPTER_IMAGES[k] ?? []).map((slot) => ({ slot, src: s.images?.[slot] })),
        groups: groups.map((g) => ({ name: g.name, items: g.items })),
        cta: deptBook(k),
      };
    })
    .filter((c): c is Chapter => c !== null);

  const founder = doctors.find((d) => d.founder);
  const team: DoctorCard[] = doctors
    .filter((d) => !d.founder)
    .map((d) => ({
      name: L(d.nameAr, d.nameEn),
      title: L(d.titleAr, d.titleEn),
      dept: deptOf(d.dept),
      branch: d.branchAr || d.branchEn ? L(d.branchAr, d.branchEn) : null,
      photo: d.portrait ?? "",
      portrait: !!d.portrait,
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

  // Section numbers, like a magazine's contents: 00 the practice, 01–0n the disciplines, then on.
  const num = (k: number) => String(k).padStart(2, "0");
  const after = chapters.length;

  return (
    <div className="font-site text-site-slate bg-site-ivory flex min-h-screen flex-col pb-16 sm:pb-0">
      <div
        className="text-site-subtle border-site-line border-b px-4 py-1.5 text-center text-[11px]"
        role="note"
        data-testid="site-concept"
      >
        <span className="sm:hidden">{t("conceptShort")}</span>
        <span className="hidden sm:inline">{t("concept", { name })}</span>
      </div>

      <SiteHeader
        staff={staff}
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
          nextFree={data.nextFree[0] ?? null}
        />

        {/* ── 00 / The practice ───────────────────────────────────────────── */}
        <section id="about" className="border-site-line scroll-mt-28 border-t">
          <div className="mx-auto grid max-w-7xl gap-14 px-5 py-20 lg:grid-cols-12 lg:px-8 lg:py-28">
            <div className="flex flex-col gap-10 lg:col-span-4">
              <SectionLabel n={num(0)} title={t("aboutEyebrow")} />
              {facts.length > 0 && (
                <dl className="border-site-line grid grid-cols-2 border-t lg:grid-cols-1">
                  {facts.map((f) => (
                    <div key={f.label} className="border-site-line flex flex-col gap-1 border-b py-5">
                      <dd className="font-display text-site-ink text-4xl font-normal" dir="ltr">
                        {f.value}
                      </dd>
                      <dt className="text-site-subtle text-sm">{f.label}</dt>
                    </div>
                  ))}
                </dl>
              )}
            </div>
            <div className="flex flex-col gap-8 lg:col-span-7 lg:col-start-6">
              <h2 className="font-display text-site-ink text-[2.1rem] leading-[1.15] font-normal text-balance lg:text-5xl">
                {L(s.aboutTitleAr, s.aboutTitleEn) || t("aboutTitle", { name })}
              </h2>
              {L(s.aboutAr, s.aboutEn) && (
                <p className="text-[17px] leading-[1.9]">{L(s.aboutAr, s.aboutEn)}</p>
              )}
              {L(s.quoteAr, s.quoteEn) && (
                <figure className="border-site-champagne mt-6 border-s ps-8">
                  <blockquote className="font-display text-site-ink text-[1.75rem] leading-[1.35] font-normal italic lg:text-[2.25rem]">
                    {L(s.quoteAr, s.quoteEn)}
                  </blockquote>
                  <figcaption className="site-label mt-5">{t("quoteBy")}</figcaption>
                </figure>
              )}
            </div>
          </div>

          {/* The houses: the clinic's own marks in one quiet row */}
          <div id="clinics" className="border-site-line border-t">
            <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-14 lg:flex-row lg:items-center lg:gap-16 lg:px-8">
              <div className="flex flex-col gap-3 lg:w-1/3">
                <span className="site-label">{t("clinicsTitle")}</span>
                {L(s.clinicsAr, s.clinicsEn) && (
                  <p className="text-[15px] leading-relaxed">{L(s.clinicsAr, s.clinicsEn)}</p>
                )}
              </div>
              <ul className="grid flex-1 grid-cols-2 gap-x-10 gap-y-6 sm:grid-cols-4">
                {(["brand-clinics", "brand-dental", "brand-light", "brand-hair"] as const).map(
                  (slot) => (
                    <li key={slot} className="flex aspect-[3/2] items-center justify-center">
                      <SiteImage
                        slot={slot}
                        src={s.images?.[slot]}
                        locale={locale}
                        fit="contain"
                        className="p-2 opacity-80 grayscale"
                        showSpec={false}
                      />
                    </li>
                  ),
                )}
              </ul>
            </div>
          </div>
        </section>

        {/* ── 01–0n / The disciplines ─────────────────────────────────────── */}
        {chapters.length > 0 && (
          <section id="departments" className="bg-site-mist scroll-mt-28">
            <span id="treatments" className="block scroll-mt-28" aria-hidden />
            <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 pt-20 lg:px-8 lg:pt-28">
              <span className="site-label">{t("treatEyebrow")}</span>
              <p className="text-site-subtle max-w-xl text-sm">{t("treatText")}</p>
              <SiteChapters
                chapters={chapters}
                locale={locale}
                phone={s.phone && tel ? { label: s.phone, href: tel } : null}
                labels={{ call: t("callShort"), bookable: t("bookShort") }}
              />
            </div>
          </section>
        )}

        {/* ── Physicians ──────────────────────────────────────────────────── */}
        {doctors.length > 0 && (
          <section id="doctors" className="border-site-line scroll-mt-28 border-t">
            <div className="mx-auto flex max-w-7xl flex-col gap-14 px-5 py-20 lg:px-8 lg:py-28">
              <div className="flex flex-col gap-5">
                <SectionLabel n={num(after + 1)} title={t("doctorsEyebrow")} />
                {L(s.doctorsAr, s.doctorsEn) && (
                  <p className="max-w-xl text-[17px] leading-relaxed">
                    {L(s.doctorsAr, s.doctorsEn)}
                  </p>
                )}
              </div>
              {founder && (
                <article className="border-site-line grid gap-10 border-y py-12 lg:grid-cols-12 lg:gap-16">
                  <div className="bg-site-mist lg:col-span-4">
                    {/* eslint-disable-next-line @next/next/no-img-element -- the clinic's own photo */}
                    <img
                      src={founder.portrait ?? founder.photo}
                      alt={L(founder.nameAr, founder.nameEn)}
                      className="mx-auto block aspect-[4/5] w-full object-contain object-bottom pt-6"
                    />
                  </div>
                  <div className="flex flex-col justify-center gap-5 lg:col-span-7 lg:col-start-6">
                    <span className="site-label">{t("founder")}</span>
                    <h3 className="font-display text-site-ink text-3xl font-normal lg:text-[2.5rem]">
                      {L(founder.nameAr, founder.nameEn)}
                    </h3>
                    <p className="text-site-subtle text-[15px]">
                      {L(founder.titleAr, founder.titleEn)}
                    </p>
                    {L(founder.bioAr, founder.bioEn) && (
                      <p className="max-w-xl text-[17px] leading-[1.85]">
                        {L(founder.bioAr, founder.bioEn)}
                      </p>
                    )}
                  </div>
                </article>
              )}
              <SiteDoctors
                doctors={team}
                depts={teamDepts}
                labels={{ all: t("all"), prev: t("prev"), next: t("next") }}
              />
            </div>
          </section>
        )}

        {/* ── Courses of treatment ────────────────────────────────────────── */}
        {data.offers.length > 0 && (
          <section id="offers" className="bg-site-mist scroll-mt-28">
            <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 lg:grid-cols-12 lg:px-8 lg:py-28">
              <div className="flex flex-col gap-5 lg:col-span-4">
                <SectionLabel n={num(after + 2)} title={t("offersEyebrow")} />
                <p className="text-[15px] leading-relaxed">{t("offersText")}</p>
                {clinic.isDemo && (
                  <p className="text-site-subtle text-xs" data-testid="sample-prices">
                    {t("samplePrices")}
                  </p>
                )}
              </div>
              <ul className="border-site-line border-t lg:col-span-7 lg:col-start-6">
                {data.offers.map((o) => (
                  <li
                    key={o.id}
                    className="border-site-line grid grid-cols-[1fr_auto] items-baseline gap-x-6 gap-y-1 border-b py-5"
                    data-testid="site-offer"
                  >
                    <span className="font-display text-site-ink text-xl font-normal">
                      {pick(locale, o.nameAr, o.nameEn)}
                    </span>
                    {o.priceHalalas !== null ? (
                      <span className="text-site-ink text-[15px] tabular-nums">
                        {formatSAR(o.priceHalalas, locale)}
                      </span>
                    ) : (
                      <span />
                    )}
                    <span className="text-site-subtle text-sm">
                      {t("offerSessions", { n: o.sessions })} ·{" "}
                      {t("offerValid", { n: Math.round(o.validityDays / 30) })}
                    </span>
                    {o.bookable && canBook ? (
                      <Link
                        href={`/book?mode=clinic&service=${o.serviceId}`}
                        className="site-link justify-self-end"
                      >
                        {t("offerBook")}
                      </Link>
                    ) : wa ? (
                      <a
                        href={wa}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="site-link justify-self-end"
                      >
                        {t("bookWhatsapp")}
                      </a>
                    ) : (
                      <span />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* ── Before and after ────────────────────────────────────────────── */}
        {s.images?.["result-before"] && s.images?.["result-after"] && (
          <section id="results" className="border-site-line scroll-mt-28 border-t">
            <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-20 lg:grid-cols-12 lg:px-8 lg:py-28">
              <div className="flex flex-col gap-5 lg:col-span-4">
                <span className="site-label">{t("resultsEyebrow")}</span>
                <h2 className="font-display text-site-ink text-4xl font-normal">
                  {t("resultsTitle")}
                </h2>
                <p className="text-[15px] leading-relaxed">{t("resultsText")}</p>
                <p className="text-site-subtle text-sm">{t("resultsConsent")}</p>
              </div>
              <div className="lg:col-span-7 lg:col-start-6">
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
        )}

        {/* ── Before your first visit ─────────────────────────────────────── */}
        <section id="faq" className="border-site-line scroll-mt-28 border-t">
          <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 lg:grid-cols-12 lg:px-8 lg:py-28">
            <div className="lg:col-span-4">
              <SectionLabel n={num(after + 3)} title={t("faqEyebrow")} />
            </div>
            <div className="border-site-line border-t lg:col-span-7 lg:col-start-6">
              {faqs.map((f) => (
                <details key={f.q} className="border-site-line group border-b py-6">
                  <summary className="text-site-ink flex cursor-pointer list-none items-baseline justify-between gap-6 text-[17px] [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <span
                      className="text-site-champagne-ink text-xl font-light transition-transform group-open:rotate-45"
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

        {/* ── Visit the practice ──────────────────────────────────────────── */}
        <section id="contact" className="bg-site-mist scroll-mt-28">
          <div className="mx-auto flex max-w-7xl flex-col gap-12 px-5 py-20 lg:px-8 lg:py-28">
            <div className="flex flex-col gap-5">
              <SectionLabel n={num(after + 4)} title={t("contactEyebrow")} />
              {L(s.findAr, s.findEn) && (
                <p className="font-display text-site-ink text-3xl font-normal lg:text-4xl">
                  {L(s.findAr, s.findEn)}
                </p>
              )}
            </div>
            <div className="border-site-line grid border-t md:grid-cols-2 lg:grid-cols-3">
              {data.branches.map((b) => (
                <div
                  key={b.id}
                  className="border-site-line flex flex-col gap-4 border-b py-8 md:border-e md:pe-8 md:[&:not(:first-child)]:ps-8"
                >
                  <div>
                    <h3 className="font-display text-site-ink text-2xl font-normal">
                      {pick(locale, b.cityAr, b.cityEn)}
                    </h3>
                    <p className="text-site-subtle text-sm">{pick(locale, b.nameAr, b.nameEn)}</p>
                  </div>
                  <dl className="grid grid-cols-[5rem_1fr] gap-y-2 text-sm">
                    <dt className="text-site-subtle">{t("days")}</dt>
                    <dd className="text-site-ink">{b.days.map(weekday).join(" · ")}</dd>
                    {b.from && b.to && (
                      <>
                        <dt className="text-site-subtle">{t("hours")}</dt>
                        <dd className="text-site-ink" dir="ltr">
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
                      className="site-link mt-auto w-fit"
                    >
                      {t("directions")}
                    </a>
                  )}
                </div>
              ))}
              <div className="flex flex-col gap-4 py-8 md:ps-8">
                <h3 className="font-display text-site-ink text-2xl font-normal">{t("contactUs")}</h3>
                {tel && (
                  <a href={tel} className="text-site-ink text-lg" dir="ltr">
                    {s.phone}
                  </a>
                )}
                {wa && (
                  <a href={wa} target="_blank" rel="noopener noreferrer" className="site-link w-fit">
                    {t("utilityWhatsapp")}
                  </a>
                )}
                {data.videoService && canBook && (
                  <Link href={videoHref} className="site-link w-fit">
                    {t("videoCta")}
                  </Link>
                )}
                {canBook && (
                  <Link href="/book" className="site-button mt-auto w-fit" data-testid="final-book">
                    {t("book")}
                  </Link>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-site-line border-t">
        {(s.partners?.length || s.licence || clinic.isDemo) && (
          <div className="border-site-line border-b" aria-labelledby="partners-title">
            <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-14 lg:px-8">
              <p id="partners-title" className="site-label">
                {t("partnersTitle")}
              </p>
              {s.partners && s.partners.length > 0 && (
                <ul className="grid grid-cols-3 gap-x-8 gap-y-8 sm:grid-cols-5 lg:grid-cols-10">
                  {s.partners.map((p) => (
                    <li key={p.nameEn} className="flex h-12 items-center justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element -- partner logos as published by the clinic */}
                      <img
                        src={p.logo}
                        alt={L(p.nameAr, p.nameEn)}
                        title={L(p.nameAr, p.nameEn)}
                        loading="lazy"
                        className="max-h-12 w-auto max-w-full object-contain opacity-60 grayscale transition hover:opacity-100"
                      />
                    </li>
                  ))}
                </ul>
              )}
              <ul className="text-site-subtle flex flex-wrap gap-x-6 gap-y-2 text-xs">
                <li>{s.licence ? t("licence", { n: s.licence }) : t("licencePending")}</li>
                {s.credentials?.map((c) => (
                  <li key={c.en}>{L(c.ar, c.en)}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 text-sm md:grid-cols-12 lg:px-8">
          <div className="flex flex-col gap-5 md:col-span-5">
            {s.images?.logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- the clinic's own logo
              <img src={s.images.logo} alt={name} className="h-9 w-fit" />
            ) : (
              <span className="font-display text-site-ink text-2xl">{name}</span>
            )}
            {L(s.footerAr, s.footerEn) && (
              <p className="max-w-md leading-relaxed">{L(s.footerAr, s.footerEn)}</p>
            )}
            <div className="flex gap-5">
              {s.x && <Social href={`https://x.com/${s.x}`}>X</Social>}
              {s.instagram && (
                <Social href={`https://www.instagram.com/${s.instagram}`}>Instagram</Social>
              )}
              {s.tiktok && <Social href={`https://www.tiktok.com/@${s.tiktok}`}>TikTok</Social>}
            </div>
          </div>
          <div className="flex flex-col gap-3 md:col-span-3">
            <span className="site-label">{t("navDepartments")}</span>
            {departments.map((d) => (
              <a key={d.key} href={`#dept-${d.key}`} className="hover:text-site-ink">
                {L(d.nameAr, d.nameEn)}
              </a>
            ))}
          </div>
          <div className="flex flex-col gap-3 md:col-span-4">
            <span className="site-label">{t("navContact")}</span>
            {tel && (
              <a href={tel} className="hover:text-site-ink w-fit" dir="ltr">
                {s.phone}
              </a>
            )}
            {wa && (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-site-ink w-fit"
              >
                {t("utilityWhatsapp")}
              </a>
            )}
            <Link href="/my" className="hover:text-site-ink w-fit">
              {t("utilityPortal")}
            </Link>
            <Link href={staff ? "/home" : "/login"} className="hover:text-site-ink w-fit">
              {staff ? t("openApp") : t("staff")}
            </Link>
          </div>
        </div>
        <div className="border-site-line border-t">
          <div className="text-site-subtle mx-auto flex max-w-7xl flex-col gap-2 px-5 py-6 text-xs md:flex-row md:justify-between lg:px-8">
            <span>{t("rights", { name, year: new Date().getFullYear() })}</span>
            <span>{t("concept", { name })}</span>
          </div>
        </div>
      </footer>

      {/* Phones: one thin bar with the invitation, under the thumb. */}
      {canBook && (
        <div className="bg-site-ivory/95 border-site-line fixed inset-x-0 bottom-0 z-40 border-t p-2.5 backdrop-blur-md sm:hidden">
          <Link
            href="/book"
            className="bg-site-ink text-site-ivory flex h-11 items-center justify-center text-sm tracking-wide"
            data-testid="sticky-book"
          >
            {t("book")}
          </Link>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ n, title }: { n: string; title: string }) {
  return (
    <span className="site-label">
      <span dir="ltr">{n}</span> / {title}
    </span>
  );
}

function Social({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:text-site-ink text-xs tracking-wide underline decoration-1 underline-offset-4"
    >
      {children}
    </a>
  );
}
