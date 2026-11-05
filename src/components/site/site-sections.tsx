import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  Check,
  GraduationCap,
  Languages,
  MapPin,
  MessageCircle,
  Phone,
} from "lucide-react";
import { pick } from "@/lib/brand";
import { doctorImageSlot, type ImageSlotKey } from "@/lib/site/images";
import type { ClinicSiteData } from "@/lib/site/data";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/config";
import type { MemberProfile, SiteContent } from "@/db/schema";
import { SiteImage } from "./site-image";

type Ctx = {
  locale: Locale;
  site: SiteContent;
  /** "Riyadh and Jeddah" in the page language. */
  cityList: string;
  canBook: boolean;
  consultHref: string;
  wa: string | null;
  tel: string | null;
};

const langPick = (locale: Locale) => (a?: string, e?: string) =>
  (locale === "ar" ? a || e : e || a) ?? "";

/** Section heading used by every section of the website. */
export function SectionHeading({
  eyebrow,
  title,
  text,
  center = false,
}: {
  eyebrow: string;
  title: string;
  text?: string;
  center?: boolean;
}) {
  return (
    <div
      className={cn("flex max-w-3xl flex-col gap-3", center && "mx-auto items-center text-center")}
    >
      <span className="text-brand-strong flex items-center gap-2 text-sm font-semibold">
        <span className="bg-brand h-0.5 w-6 rounded-full" aria-hidden />
        {eyebrow}
      </span>
      <h2 className="text-site-ink text-3xl leading-tight font-bold text-balance lg:text-[2.6rem]">
        {title}
      </h2>
      {text && <p className="text-site-slate text-lg leading-relaxed">{text}</p>}
    </div>
  );
}

// ── About us + facts + our clinics ──────────────────────────────────────────

export async function SiteAbout({
  ctx,
  facts,
}: {
  ctx: Ctx;
  facts: { value: string; label: string }[];
}) {
  const t = await getTranslations("site");
  const L = langPick(ctx.locale);
  const s = ctx.site;
  return (
    <section id="about" className="scroll-mt-28 py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="overflow-hidden rounded-2xl lg:col-span-5">
            <div className="aspect-[4/5]">
              <SiteImage slot="about" src={s.images?.about} locale={ctx.locale} />
            </div>
          </div>
          <div className="flex flex-col gap-6 lg:col-span-7">
            <SectionHeading
              eyebrow={t("aboutEyebrow")}
              title={s.since ? t("aboutTitle", { year: s.since }) : t("aboutEyebrow")}
            />
            {L(s.aboutAr, s.aboutEn) && (
              <p className="text-site-slate text-lg leading-relaxed">{L(s.aboutAr, s.aboutEn)}</p>
            )}
            {L(s.footerAr, s.footerEn) && (
              <p className="border-brand text-site-ink border-s-4 ps-4 text-base font-semibold">
                {L(s.footerAr, s.footerEn)}
              </p>
            )}
            {facts.length > 0 && (
              <dl className="border-site-line mt-2 grid grid-cols-2 overflow-hidden rounded-xl border sm:grid-cols-4">
                {facts.map((f, i) => (
                  <div
                    key={f.label}
                    className={cn(
                      "border-site-line flex flex-col gap-1 p-5",
                      i % 2 === 1 && "border-s",
                      i >= 2 && "border-t sm:border-t-0",
                      i === 2 && "sm:border-s",
                    )}
                  >
                    <dd className="text-brand-strong text-3xl font-bold" dir="ltr">
                      {f.value}
                    </dd>
                    <dt className="text-site-subtle text-sm">{f.label}</dt>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>

        {/* Our Clinics: four photos */}
        <div className="mt-20 flex flex-col gap-8" id="clinics">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h3 className="text-site-ink text-2xl font-bold lg:text-3xl">{t("clinicsTitle")}</h3>
              <p className="text-site-slate mt-2">{t("clinicsText", { cities: ctx.cityList })}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:h-[30rem] lg:grid-cols-4 lg:grid-rows-2 lg:gap-4">
            {(["clinic-1", "clinic-2", "clinic-3", "clinic-4"] as const).map((slot, i) => (
              <div
                key={slot}
                className={cn(
                  "overflow-hidden rounded-xl",
                  i === 0
                    ? "col-span-2 aspect-[16/10] lg:row-span-2 lg:aspect-auto"
                    : "aspect-[4/3] lg:aspect-auto",
                  i === 3 && "col-span-2 aspect-[16/7] lg:col-span-1 lg:aspect-auto",
                  i === 1 && "lg:col-span-2",
                )}
              >
                <SiteImage
                  slot={slot}
                  src={s.images?.[slot]}
                  locale={ctx.locale}
                  showSpec={i === 0}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Departments: hover-reveal cards ────────────────────────────────────────

export async function SiteDepartments({ ctx }: { ctx: Ctx }) {
  const t = await getTranslations("site");
  const L = langPick(ctx.locale);
  const Forward = ctx.locale === "ar" ? ArrowLeft : ArrowRight;
  const specialties = ctx.site.specialties ?? [];
  const departments = ctx.site.departments ?? [];
  if (!departments.length) return null;

  return (
    <section id="departments" className="bg-site-mist scroll-mt-28 py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <SectionHeading eyebrow={t("deptEyebrow")} title={t("deptTitle")} />
        <ul className="mt-12 grid gap-5 md:grid-cols-3">
          {departments.map((d) => {
            const own = d.specialties
              .map((k) => specialties.find((x) => x.key === k))
              .filter((x): x is NonNullable<typeof x> => !!x);
            const items = own.flatMap((x) => x.items ?? []);
            const slot = `dept-${d.key}` as ImageSlotKey;
            return (
              <li key={d.key} id={`dept-${d.key}`} className="scroll-mt-28">
                <a
                  href={`#service-${own[0]?.key ?? d.key}`}
                  className="group bg-site-ink relative flex aspect-[4/5] flex-col justify-end overflow-hidden rounded-2xl"
                  data-testid="site-department"
                >
                  <div className="absolute inset-0 transition-transform duration-500 group-hover:scale-105">
                    <SiteImage
                      slot={slot}
                      src={ctx.site.images?.[slot]}
                      locale={ctx.locale}
                      showSpec
                      className="items-start pt-16"
                    />
                  </div>
                  <div
                    className="from-site-ink via-site-ink/70 absolute inset-x-0 bottom-0 h-3/4 bg-linear-to-t to-transparent"
                    aria-hidden
                  />
                  <div className="relative flex flex-col gap-3 p-6 lg:p-7">
                    <span className="text-site-ivory/70 text-xs font-medium">
                      {t("deptTreatments", { n: items.length })}
                    </span>
                    <h3 className="text-site-ivory text-2xl font-bold">{L(d.nameAr, d.nameEn)}</h3>
                    {own.length > 1 && (
                      <p className="text-site-ivory/80 text-sm leading-relaxed">
                        {own.map((x) => L(x.nameAr, x.nameEn)).join(" · ")}
                      </p>
                    )}
                    {/* Revealed on hover / focus on large screens; always visible on phones. */}
                    <div className="grid transition-[grid-template-rows,opacity] duration-300 lg:grid-rows-[0fr] lg:opacity-0 lg:group-hover:grid-rows-[1fr] lg:group-hover:opacity-100 lg:group-focus-visible:grid-rows-[1fr] lg:group-focus-visible:opacity-100">
                      <ul className="text-site-ivory/90 flex flex-col gap-1.5 overflow-hidden text-sm">
                        {items.slice(0, 6).map((it) => (
                          <li key={it.en} className="flex items-start gap-2">
                            <Check className="text-brand-soft mt-0.5 size-4 shrink-0" aria-hidden />
                            <span className="line-clamp-1">{L(it.ar, it.en)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <span className="text-site-ivory mt-1 inline-flex items-center gap-1.5 text-sm font-semibold">
                      {t("deptExplore")}
                      <Forward
                        className="size-4 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1"
                        aria-hidden
                      />
                    </span>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

// ── Medical services: masonry of full service cards ─────────────────────────

export async function SiteServices({ ctx }: { ctx: Ctx }) {
  const t = await getTranslations("site");
  const L = langPick(ctx.locale);
  const specialties = ctx.site.specialties ?? [];
  if (!specialties.length) return null;

  return (
    <section id="services" className="scroll-mt-28 py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <SectionHeading
          eyebrow={t("servicesEyebrow")}
          title={t("servicesTitle")}
          text={t("servicesText")}
        />
        <div className="mt-12 gap-6 md:columns-2 [&>*]:mb-6 [&>*]:break-inside-avoid">
          {specialties.map((sp) => {
            const slot = `service-${sp.key}` as ImageSlotKey;
            const spName = L(sp.nameAr, sp.nameEn);
            return (
              <article
                key={sp.key}
                id={`service-${sp.key}`}
                className="border-site-line bg-card shadow-card group scroll-mt-28 overflow-hidden rounded-2xl border"
                data-testid="site-specialty"
              >
                <div className="h-56 overflow-hidden lg:h-64">
                  <div className="h-full transition-transform duration-500 group-hover:scale-[1.03]">
                    <SiteImage slot={slot} src={ctx.site.images?.[slot]} locale={ctx.locale} />
                  </div>
                </div>
                <div className="flex flex-col gap-5 p-6 lg:p-8">
                  <div>
                    <h3 className="text-site-ink text-2xl font-bold">{spName}</h3>
                    <p className="text-site-slate mt-2 leading-relaxed">
                      {L(sp.textAr, sp.textEn)}
                    </p>
                  </div>
                  {sp.items && sp.items.length > 0 && (
                    <ul className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                      {sp.items.map((it) => (
                        <li
                          key={it.en}
                          className="text-site-ink flex items-start gap-2.5 text-[15px]"
                        >
                          <span className="bg-brand-soft text-brand-strong mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full">
                            <Check className="size-3" aria-hidden />
                          </span>
                          {L(it.ar, it.en)}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="border-site-line flex flex-wrap gap-3 border-t pt-5">
                    {sp.bookable && ctx.canBook ? (
                      <Link
                        href={ctx.consultHref}
                        className="border-brand text-brand-strong hover:bg-brand hover:text-brand-foreground inline-flex h-11 items-center gap-2 rounded-lg border px-5 text-sm font-semibold transition-colors"
                      >
                        <CalendarCheck className="size-4" aria-hidden />
                        {t("servicesBook")}
                      </Link>
                    ) : ctx.wa ? (
                      <a
                        href={ctx.wa}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="border-brand text-brand-strong hover:bg-brand hover:text-brand-foreground inline-flex h-11 items-center gap-2 rounded-lg border px-5 text-sm font-semibold transition-colors"
                      >
                        <MessageCircle className="size-4" aria-hidden />
                        {t("servicesAsk")}
                      </a>
                    ) : null}
                    {ctx.tel && (
                      <a
                        href={ctx.tel}
                        className="text-site-ink hover:bg-site-mist inline-flex h-11 items-center gap-2 rounded-lg px-4 text-sm font-medium"
                      >
                        <Phone className="size-4" aria-hidden />
                        {t("servicesCall")}
                      </a>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── Doctors: profile grid with a Book button per doctor ─────────────────────

export async function SiteDoctors({
  ctx,
  doctors,
  branches,
  isDemo,
}: {
  ctx: Ctx;
  doctors: ClinicSiteData["doctors"];
  branches: ClinicSiteData["branches"];
  isDemo: boolean;
}) {
  const t = await getTranslations("site");
  const L = langPick(ctx.locale);
  if (!doctors.length) return null;
  const cols =
    doctors.length === 5
      ? "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
      : doctors.length % 3 === 0
        ? "sm:grid-cols-2 lg:grid-cols-3"
        : "sm:grid-cols-2 lg:grid-cols-4";

  return (
    <section id="doctors" className="bg-site-mist scroll-mt-28 py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading
            eyebrow={t("doctorsEyebrow")}
            title={t("doctorsTitle")}
            text={t("doctorsText")}
          />
          {ctx.canBook && (
            <Link
              href="/book"
              className="text-brand-strong inline-flex items-center gap-2 text-sm font-semibold hover:underline"
            >
              <CalendarCheck className="size-4" aria-hidden />
              {t("doctorsAll")}
            </Link>
          )}
        </div>
        {isDemo && (
          <p className="text-site-subtle mt-4 text-sm" data-testid="team-demo">
            {t("teamDemo")}
          </p>
        )}
        <ul className={cn("mt-10 grid gap-5", cols)}>
          {doctors.map((d) => {
            const docName = pick(ctx.locale, d.nameAr, d.nameEn);
            const branch = branches.find((b) => b.id === d.branchId);
            const p: MemberProfile = d.profile ?? {};
            const specialty =
              L(p.specialtyAr, p.specialtyEn) || L(d.titleAr ?? "", d.titleEn ?? "");
            return (
              <li
                key={d.id}
                className="border-site-line bg-card shadow-card flex flex-col overflow-hidden rounded-2xl border"
                data-testid="site-doctor"
              >
                <div className="aspect-[4/5]">
                  <SiteImage
                    slot={`doctor-${d.id}`}
                    spec={doctorImageSlot(d.id, d.nameAr, d.nameEn ?? d.nameAr)}
                    src={ctx.site.images?.[`doctor-${d.id}`]}
                    locale={ctx.locale}
                  />
                </div>
                <div className="flex flex-1 flex-col gap-4 p-5">
                  <div>
                    <h3 className="text-site-ink text-lg leading-snug font-bold">{docName}</h3>
                    {specialty && (
                      <p className="text-brand-strong mt-1 text-sm font-medium">{specialty}</p>
                    )}
                  </div>
                  <dl className="border-site-line flex flex-col gap-3 border-t pt-4 text-sm">
                    {p.credentials && p.credentials.length > 0 && (
                      <div className="flex gap-2.5">
                        <dt className="sr-only">{t("doctorCredentials")}</dt>
                        <GraduationCap
                          className="text-site-subtle mt-0.5 size-4 shrink-0"
                          aria-hidden
                        />
                        <dd className="text-site-slate flex flex-col gap-1">
                          {p.credentials.map((c) => (
                            <span key={c.en}>{L(c.ar, c.en)}</span>
                          ))}
                        </dd>
                      </div>
                    )}
                    {p.languages && p.languages.length > 0 && (
                      <div className="flex gap-2.5">
                        <dt className="sr-only">{t("doctorLanguages")}</dt>
                        <Languages
                          className="text-site-subtle mt-0.5 size-4 shrink-0"
                          aria-hidden
                        />
                        <dd className="text-site-slate">
                          {p.languages
                            .map((l) => L(l.ar, l.en))
                            .join(ctx.locale === "ar" ? "، " : ", ")}
                        </dd>
                      </div>
                    )}
                    <div className="flex gap-2.5">
                      <dt className="sr-only">{t("doctorBranch")}</dt>
                      <MapPin className="text-site-subtle mt-0.5 size-4 shrink-0" aria-hidden />
                      <dd className="text-site-slate">
                        {branch ? pick(ctx.locale, branch.cityAr, branch.cityEn) : ctx.cityList}
                      </dd>
                    </div>
                  </dl>
                  {ctx.canBook && (
                    <Link
                      href={`/book?doctor=${d.id}`}
                      aria-label={t("doctorBookWith", { name: docName })}
                      className="bg-brand text-brand-foreground hover:bg-brand-strong mt-auto inline-flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors"
                      data-testid="doctor-book"
                    >
                      <CalendarCheck className="size-4" aria-hidden />
                      {t("doctorBook")}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
