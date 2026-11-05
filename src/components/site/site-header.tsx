import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CalendarCheck, ChevronDown, MapPin, MessageCircle, Phone, UserRound } from "lucide-react";
import { LanguageToggle } from "@/components/language-toggle";
import { pick } from "@/lib/brand";
import type { Locale } from "@/i18n/config";
import type { SiteContent } from "@/db/schema";
import { SiteImage } from "./site-image";
import { SiteMobileMenu, type MobileMenuGroup } from "./site-mobile-menu";

export interface HeaderDoctor {
  id: string;
  name: string;
  title: string | null;
  city: string | null;
}

/**
 * Utility bar (contact, branches, patient portal, Book, language) + sticky main navigation with
 * dropdowns: Our Departments, Medical Services (mega menu with every treatment), Our Doctors.
 * Desktop menus open on hover and on keyboard focus (no script); phones get a full-screen menu.
 */
export async function SiteHeader({
  locale,
  name,
  site,
  doctors,
  canBook,
}: {
  locale: Locale;
  name: string;
  site: SiteContent;
  doctors: HeaderDoctor[];
  canBook: boolean;
}) {
  const t = await getTranslations("site");
  const ar = locale === "ar";
  const L = (a?: string, e?: string) => (ar ? a || e : e || a) ?? "";
  const tel = site.phone ? `tel:+966${site.phone.replace(/\D/g, "").replace(/^0/, "")}` : null;
  const wa = site.whatsapp ? `https://wa.me/${site.whatsapp.replace(/\D/g, "")}` : null;
  const specialties = site.specialties ?? [];
  const departments = site.departments ?? [];
  const firstSpecialty = (keys: string[]) => keys.find((k) => specialties.some((x) => x.key === k));

  const groups: MobileMenuGroup[] = [
    {
      label: t("navDepartments"),
      links: departments.map((d) => ({
        label: L(d.nameAr, d.nameEn),
        href: `#service-${firstSpecialty(d.specialties) ?? d.key}`,
      })),
    },
    {
      label: t("navServices"),
      links: specialties.map((x) => ({
        label: L(x.nameAr, x.nameEn),
        href: `#service-${x.key}`,
      })),
    },
    {
      label: t("navDoctors"),
      links: [
        ...doctors.map((d) => ({ label: d.name, href: "#doctors" })),
        { label: t("menuAllDoctors"), href: "#doctors" },
      ],
    },
  ].filter((g) => g.links.length > 0);

  const navTrigger =
    "flex h-full items-center gap-1 border-b-2 border-transparent px-1 text-sm font-medium whitespace-nowrap text-site-ink transition-colors group-hover/nav:border-brand group-hover/nav:text-brand-strong group-focus-within/nav:border-brand";
  const panel =
    "invisible absolute top-full z-50 translate-y-1 opacity-0 transition-[opacity,transform,visibility] duration-150 group-focus-within/nav:visible group-focus-within/nav:translate-y-0 group-focus-within/nav:opacity-100 group-hover/nav:visible group-hover/nav:translate-y-0 group-hover/nav:opacity-100";

  return (
    <>
      {/* ── Utility bar ─────────────────────────────────────────────────── */}
      <div className="bg-site-ink text-site-ivory/80 text-xs" data-testid="site-utility">
        <div className="mx-auto flex h-10 max-w-7xl items-center gap-5 px-5 lg:px-8">
          {tel && (
            <a href={tel} className="hover:text-site-ivory flex items-center gap-1.5">
              <Phone className="size-3.5" aria-hidden />
              <span dir="ltr">{site.phone}</span>
            </a>
          )}
          {wa && (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-site-ivory hidden items-center gap-1.5 sm:flex"
            >
              <MessageCircle className="size-3.5" aria-hidden />
              {t("utilityWhatsapp")}
            </a>
          )}
          <span className="hidden items-center gap-1.5 md:flex">
            <MapPin className="size-3.5" aria-hidden />
            {t("utilityLocations")}
          </span>
          <div className="ms-auto flex items-center gap-1 sm:gap-3">
            <Link
              href="/my"
              className="hover:text-site-ivory flex items-center gap-1.5 px-1"
              data-testid="utility-portal"
            >
              <UserRound className="size-3.5" aria-hidden />
              {t("utilityPortal")}
            </Link>
            {canBook && (
              <Link
                href="/book"
                className="text-site-ivory hover:bg-site-ivory/10 hidden items-center gap-1.5 rounded-md px-2 py-1 font-medium sm:flex"
                data-testid="utility-book"
              >
                <CalendarCheck className="size-3.5" aria-hidden />
                {t("book")}
              </Link>
            )}
            <LanguageToggle
              variant="ghost"
              className="text-site-ivory/80 hover:bg-site-ivory/10 hover:text-site-ivory h-7 px-2 text-xs"
            />
          </div>
        </div>
      </div>

      {/* ── Main navigation ─────────────────────────────────────────────── */}
      <header className="border-site-line bg-card/95 sticky top-0 z-40 border-b backdrop-blur-md">
        <div className="relative mx-auto flex h-20 max-w-7xl items-center gap-8 px-5 lg:px-8">
          <Link href="/" className="flex min-w-0 items-center gap-3" aria-label={name}>
            <span className="bg-brand text-brand-foreground flex size-10 shrink-0 items-center justify-center rounded-lg text-lg font-bold">
              {name.charAt(0)}
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="text-site-ink truncate text-lg font-bold whitespace-nowrap">{name}</span>
              {site.since && (
                <span className="text-site-subtle hidden text-[11px] whitespace-nowrap sm:block">
                  {t("sinceShort", { year: site.since })}
                </span>
              )}
            </span>
          </Link>

          <nav className="hidden h-full items-stretch gap-6 xl:flex" aria-label={name}>
            <Link
              href="/"
              className="text-site-ink hover:border-brand flex items-center border-b-2 border-transparent px-1 text-sm font-medium whitespace-nowrap"
            >
              {t("navHome")}
            </Link>

            {/* Our Departments */}
            {departments.length > 0 && (
              <div className="group/nav relative flex">
                <button type="button" className={navTrigger} aria-haspopup="true">
                  {t("navDepartments")}
                  <ChevronDown className="size-4 opacity-60" aria-hidden />
                </button>
                <div className={`${panel} start-0 w-[34rem]`}>
                  <div className="border-site-line bg-card shadow-float mt-px grid gap-2 rounded-b-xl border p-3">
                    {departments.map((d) => {
                      const slot = `dept-${d.key}` as "dept-skin" | "dept-dental" | "dept-plastic";
                      return (
                        <a
                          key={d.key}
                          href={`#service-${firstSpecialty(d.specialties) ?? d.key}`}
                          className="hover:bg-site-mist flex items-center gap-4 rounded-lg p-2"
                        >
                          <span className="h-14 w-20 shrink-0 overflow-hidden rounded-md">
                            <SiteImage
                              slot={slot}
                              src={site.images?.[slot]}
                              locale={locale}
                              showSpec={false}
                              className="[&_span]:hidden"
                            />
                          </span>
                          <span className="flex flex-col">
                            <span className="text-site-ink font-medium">
                              {L(d.nameAr, d.nameEn)}
                            </span>
                            <span className="text-site-subtle text-xs">
                              {d.specialties
                                .map((k) => specialties.find((x) => x.key === k))
                                .filter(Boolean)
                                .map((x) => L(x!.nameAr, x!.nameEn))
                                .join(" · ")}
                            </span>
                          </span>
                        </a>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Medical Services: mega menu with every treatment */}
            {specialties.length > 0 && (
              <div className="group/nav flex">
                <button type="button" className={navTrigger} aria-haspopup="true">
                  {t("navServices")}
                  <ChevronDown className="size-4 opacity-60" aria-hidden />
                </button>
                <div className={`${panel} inset-x-5 lg:inset-x-8`}>
                  <div className="border-site-line bg-card shadow-float mt-px grid grid-cols-4 gap-8 rounded-b-xl border p-8">
                    {specialties.map((x) => (
                      <div key={x.key} className="flex flex-col gap-3">
                        <a
                          href={`#service-${x.key}`}
                          className="text-brand-strong text-sm font-semibold hover:underline"
                        >
                          {L(x.nameAr, x.nameEn)}
                        </a>
                        <ul className="text-site-slate flex flex-col gap-1.5 text-[13px] leading-snug">
                          {(x.items ?? []).map((it) => (
                            <li key={it.en}>
                              <a href={`#service-${x.key}`} className="hover:text-site-ink">
                                {L(it.ar, it.en)}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Our Doctors */}
            {doctors.length > 0 && (
              <div className="group/nav relative flex">
                <button type="button" className={navTrigger} aria-haspopup="true">
                  {t("navDoctors")}
                  <ChevronDown className="size-4 opacity-60" aria-hidden />
                </button>
                <div className={`${panel} start-0 w-80`}>
                  <div className="border-site-line bg-card shadow-float mt-px rounded-b-xl border p-2">
                    <ul>
                      {doctors.map((d) => (
                        <li key={d.id}>
                          <a
                            href="#doctors"
                            className="hover:bg-site-mist flex items-center gap-3 rounded-lg p-2"
                          >
                            <span className="bg-brand-soft text-brand-strong flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
                              {d.name.replace(/^(د\.|Dr\.?)\s*/i, "").charAt(0)}
                            </span>
                            <span className="flex min-w-0 flex-col">
                              <span className="text-site-ink truncate text-sm font-medium">
                                {d.name}
                              </span>
                              <span className="text-site-subtle truncate text-xs">
                                {[d.title, d.city].filter(Boolean).join(" · ")}
                              </span>
                            </span>
                          </a>
                        </li>
                      ))}
                    </ul>
                    <a
                      href="#doctors"
                      className="text-brand-strong border-site-line mt-1 block border-t px-2 pt-3 pb-2 text-sm font-medium hover:underline"
                    >
                      {t("menuAllDoctors")}
                    </a>
                  </div>
                </div>
              </div>
            )}

            <a
              href="#visit"
              className="text-site-ink hover:border-brand flex items-center border-b-2 border-transparent px-1 text-sm font-medium whitespace-nowrap"
            >
              {t("navClinics")}
            </a>
            <a
              href="#faq"
              className="text-site-ink hover:border-brand hidden items-center border-b-2 border-transparent px-1 text-sm font-medium whitespace-nowrap 2xl:flex"
            >
              {t("navFaq")}
            </a>
          </nav>

          <div className="ms-auto flex items-center gap-2">
            {canBook && (
              <Link
                href="/book"
                className="bg-brand text-brand-foreground hover:bg-brand-strong hidden h-11 items-center gap-2 rounded-lg px-5 text-sm font-semibold whitespace-nowrap transition-colors sm:inline-flex"
                data-testid="nav-book"
              >
                <CalendarCheck className="size-4" aria-hidden />
                {t("book")}
              </Link>
            )}
            <SiteMobileMenu
              groups={groups}
              extra={[
                { label: t("navClinics"), href: "#visit" },
                { label: t("navFaq"), href: "#faq" },
                { label: t("utilityPortal"), href: "/my" },
              ]}
              book={canBook ? { label: t("book"), href: "/book" } : null}
              labels={{ open: t("menuOpen"), close: t("menuClose") }}
              phone={site.phone && tel ? { label: site.phone, href: tel } : null}
            />
          </div>
        </div>
      </header>
    </>
  );
}

export function doctorsForHeader(
  locale: Locale,
  doctors: {
    id: string;
    nameAr: string;
    nameEn: string | null;
    titleAr: string | null;
    titleEn: string | null;
    branchId: string | null;
  }[],
  branches: { id: string; cityAr: string; cityEn: string }[],
): HeaderDoctor[] {
  return doctors.map((d) => {
    const b = branches.find((x) => x.id === d.branchId);
    return {
      id: d.id,
      name: pick(locale, d.nameAr, d.nameEn),
      title: d.titleAr || d.titleEn ? pick(locale, d.titleAr ?? d.titleEn ?? "", d.titleEn) : null,
      city: b ? pick(locale, b.cityAr, b.cityEn) : null,
    };
  });
}
