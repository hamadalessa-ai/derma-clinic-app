import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/config";
import type { SiteContent } from "@/db/schema";
import { SiteLangSwitch } from "./site-lang-switch";
import { SiteMobileMenu, type MobileMenuGroup } from "./site-mobile-menu";

export const telHref = (phone?: string) =>
  phone ? `tel:+966${phone.replace(/\D/g, "").replace(/^0/, "")}` : null;
export const waHref = (n?: string) => (n ? `https://wa.me/${n.replace(/\D/g, "")}` : null);

/**
 * One quiet bar, like a magazine masthead: the clinic's wordmark, four text links (The Practice,
 * Disciplines, Physicians, Visit), the language switch and one outlined invitation. Patient page
 * and staff links live in the footer and the phone menu.
 */
export async function SiteHeader({
  locale,
  name,
  site,
  canBook,
  hasOffers,
  staff = false,
}: {
  locale: Locale;
  name: string;
  site: SiteContent;
  canBook: boolean;
  hasOffers: boolean;
  /** Signed-in staff: "Open app" instead of "Staff sign-in". */
  staff?: boolean;
}) {
  const t = await getTranslations("site");
  const L = (a?: string, e?: string) => (locale === "ar" ? a || e : e || a) ?? "";
  const tel = telHref(site.phone);
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
    "flex h-full items-center text-[14px] tracking-wide whitespace-nowrap text-site-slate transition-colors hover:text-site-ink";

  return (
    <>
      {/* ── One quiet bar: wordmark, four links, language, the invitation ─── */}
      <header className="bg-site-ivory/95 border-site-line sticky top-0 z-40 border-b backdrop-blur-md">
        <div className="relative mx-auto flex h-20 max-w-7xl items-center gap-10 px-5 lg:px-8">
          <Link href="/" className="flex shrink-0 items-center" aria-label={name}>
            {site.images?.logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- the clinic's own logo, any host
              <img src={site.images.logo} alt={name} className="h-10 w-auto" data-slot="logo" />
            ) : (
              <span className="font-display text-site-ink text-2xl">{name}</span>
            )}
          </Link>

          <nav className="hidden h-full items-stretch gap-8 lg:flex" aria-label={name}>
            <a href="#about" className={item}>
              {t("aboutEyebrow")}
            </a>
            {departments.length > 0 && (
              <a href="#departments" className={item}>
                {t("navDepartments")}
              </a>
            )}
            {doctors.length > 0 && (
              <a href="#doctors" className={item}>
                {t("navDoctors")}
              </a>
            )}
            <a href="#contact" className={item}>
              {t("navContact")}
            </a>
          </nav>

          <div className="ms-auto flex items-center gap-5">
            <span className="hidden text-sm md:inline">
              <SiteLangSwitch />
            </span>
            {canBook && (
              <Link
                href="/book"
                className="site-button hidden h-11 whitespace-nowrap sm:inline-flex"
                data-testid="nav-book"
              >
                {t("book")}
              </Link>
            )}
            <SiteMobileMenu
              groups={groups}
              extra={[
                ...(hasOffers ? [{ label: t("navOffers"), href: "#offers" }] : []),
                { label: t("navContact"), href: "#contact" },
                { label: t("utilityPortal"), href: "/my" },
                staff
                  ? { label: t("openApp"), href: "/home" }
                  : { label: t("staff"), href: "/login" },
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
