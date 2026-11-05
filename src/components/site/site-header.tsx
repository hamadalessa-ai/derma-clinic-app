import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CalendarCheck, ChevronDown, MapPin, MessageCircle, Phone, UserRound } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { SiteContent } from "@/db/schema";
import { SiteLangSwitch } from "./site-lang-switch";
import { SiteMobileMenu, type MobileMenuGroup } from "./site-mobile-menu";

export const telHref = (phone?: string) =>
  phone ? `tel:+966${phone.replace(/\D/g, "").replace(/^0/, "")}` : null;
export const waHref = (n?: string) => (n ? `https://wa.me/${n.replace(/\D/g, "")}` : null);

/**
 * The "double header": a thin utility strip (phone, WhatsApp, patient portal, Book, strict
 * EN | AR switch) above a sticky main navigation: Home, Our Departments (dropdown),
 * Our Doctors (dropdown by department), Offers, Contact — and the Book appointment button.
 */
export async function SiteHeader({
  locale,
  name,
  site,
  canBook,
  hasOffers,
}: {
  locale: Locale;
  name: string;
  site: SiteContent;
  canBook: boolean;
  hasOffers: boolean;
}) {
  const t = await getTranslations("site");
  const L = (a?: string, e?: string) => (locale === "ar" ? a || e : e || a) ?? "";
  const tel = telHref(site.phone);
  const wa = waHref(site.whatsapp);
  const departments = site.departments ?? [];
  const doctors = site.doctors ?? [];
  const deptName = (key: string) => {
    const d = departments.find((x) => x.key === key || x.specialties.includes(key));
    return d ? L(d.nameAr, d.nameEn) : key;
  };
  const doctorDepts = [...new Set(doctors.map((d) => (d.dept === "hair" ? "skin" : d.dept)))];

  const groups: MobileMenuGroup[] = [
    {
      label: t("navDepartments"),
      links: departments.map((d) => ({ label: L(d.nameAr, d.nameEn), href: `#dept-${d.key}` })),
    },
    {
      label: t("navDoctors"),
      links: [
        ...doctorDepts.map((k) => ({ label: deptName(k), href: `#doctors` })),
        { label: t("menuAllDoctors"), href: "#doctors" },
      ],
    },
  ].filter((g) => g.links.length > 0);

  const item =
    "flex h-full items-center gap-1 border-b-2 border-transparent px-1 text-[15px] font-medium whitespace-nowrap text-site-slate transition-colors hover:text-site-primary";
  const panel =
    "invisible absolute top-full z-50 translate-y-1 opacity-0 transition-[opacity,transform,visibility] duration-150 group-focus-within/nav:visible group-focus-within/nav:translate-y-0 group-focus-within/nav:opacity-100 group-hover/nav:visible group-hover/nav:translate-y-0 group-hover/nav:opacity-100";

  return (
    <>
      {/* ── Top utility bar ─────────────────────────────────────────────── */}
      <div className="bg-site-night text-site-ivory/85 text-xs" data-testid="site-utility">
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
          <div className="ms-auto flex items-center gap-4">
            <Link
              href="/my"
              className="hover:text-site-ivory hidden items-center gap-1.5 sm:flex"
              data-testid="utility-portal"
            >
              <UserRound className="size-3.5" aria-hidden />
              {t("utilityPortal")}
            </Link>
            {canBook && (
              <Link
                href="/book"
                className="text-site-champagne hover:text-site-ivory hidden items-center gap-1.5 font-semibold md:flex"
                data-testid="utility-book"
              >
                <CalendarCheck className="size-3.5" aria-hidden />
                {t("book")}
              </Link>
            )}
            <SiteLangSwitch />
          </div>
        </div>
      </div>

      {/* ── Main navigation (sticky) ────────────────────────────────────── */}
      <header className="bg-card/95 shadow-soft sticky top-0 z-40 backdrop-blur-md">
        <div className="relative mx-auto flex h-20 max-w-7xl items-center gap-10 px-5 lg:px-8">
          <Link href="/" className="flex shrink-0 items-center" aria-label={name}>
            {site.images?.logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- the clinic's own logo, any host
              <img src={site.images.logo} alt={name} className="h-11 w-auto" data-slot="logo" />
            ) : (
              <span className="font-display text-site-ink text-2xl font-semibold">{name}</span>
            )}
          </Link>

          <nav className="hidden h-full items-stretch gap-8 lg:flex" aria-label={name}>
            <Link href="/" className={item}>
              {t("navHome")}
            </Link>

            {departments.length > 0 && (
              <div className="group/nav relative flex">
                <a href="#departments" className={item} aria-haspopup="true">
                  {t("navDepartments")}
                  <ChevronDown className="size-4 opacity-50" aria-hidden />
                </a>
                <div className={`${panel} start-0 w-[26rem]`}>
                  <ul className="bg-card shadow-float mt-px flex flex-col gap-1 rounded-2xl p-3">
                    {departments.map((d) => (
                      <li key={d.key}>
                        <a
                          href={`#dept-${d.key}`}
                          className="hover:bg-site-mist flex flex-col rounded-xl px-4 py-3"
                        >
                          <span className="text-site-ink font-semibold">
                            {L(d.nameAr, d.nameEn)}
                          </span>
                          <span className="text-site-subtle text-xs">
                            {t("deptCounts", {
                              doctors: doctors.filter(
                                (x) => (x.dept === "hair" ? "skin" : x.dept) === d.key,
                              ).length,
                              treatments: (site.silos ?? [])
                                .filter((x) => (x.dept === "hair" ? "skin" : x.dept) === d.key)
                                .reduce((n, x) => n + x.items.length, 0),
                            })}
                          </span>
                        </a>
                      </li>
                    ))}
                    <li>
                      <a
                        href="#treatments"
                        className="text-site-primary mt-1 block px-4 py-2 text-sm font-semibold hover:underline"
                      >
                        {t("menuAllTreatments")}
                      </a>
                    </li>
                  </ul>
                </div>
              </div>
            )}

            {doctors.length > 0 && (
              <div className="group/nav relative flex">
                <a href="#doctors" className={item} aria-haspopup="true">
                  {t("navDoctors")}
                  <ChevronDown className="size-4 opacity-50" aria-hidden />
                </a>
                <div className={`${panel} start-0 w-80`}>
                  <ul className="bg-card shadow-float mt-px flex flex-col gap-1 rounded-2xl p-3">
                    {doctorDepts.map((k) => (
                      <li key={k}>
                        <a
                          href="#doctors"
                          className="hover:bg-site-mist flex items-center justify-between rounded-xl px-4 py-3"
                        >
                          <span className="text-site-ink text-sm font-semibold">{deptName(k)}</span>
                          <span className="text-site-subtle text-xs">
                            {t("doctorsCount", {
                              n: doctors.filter((d) => (d.dept === "hair" ? "skin" : d.dept) === k)
                                .length,
                            })}
                          </span>
                        </a>
                      </li>
                    ))}
                    <li>
                      <a
                        href="#doctors"
                        className="text-site-primary mt-1 block px-4 py-2 text-sm font-semibold hover:underline"
                      >
                        {t("menuAllDoctors")}
                      </a>
                    </li>
                  </ul>
                </div>
              </div>
            )}

            {hasOffers && (
              <a href="#offers" className={item}>
                {t("navOffers")}
              </a>
            )}
            <a href="#contact" className={item}>
              {t("navContact")}
            </a>
          </nav>

          <div className="ms-auto flex items-center gap-3">
            {canBook && (
              <Link
                href="/book"
                className="bg-site-primary text-site-ivory hover:bg-site-primary-hover hidden h-12 items-center gap-2 rounded-xl px-6 text-sm font-semibold whitespace-nowrap shadow-sm transition-colors sm:inline-flex"
                data-testid="nav-book"
              >
                <CalendarCheck className="size-4" aria-hidden />
                {t("book")}
              </Link>
            )}
            <SiteMobileMenu
              groups={groups}
              extra={[
                ...(hasOffers ? [{ label: t("navOffers"), href: "#offers" }] : []),
                { label: t("navContact"), href: "#contact" },
                { label: t("utilityPortal"), href: "/my" },
              ]}
              book={canBook ? { label: t("book"), href: "/book" } : null}
              labels={{ open: t("menuOpen"), close: t("menuClose") }}
              logo={site.images?.logo ?? null}
              name={name}
              phone={site.phone && tel ? { label: site.phone, href: tel } : null}
            />
          </div>
        </div>
      </header>
    </>
  );
}
