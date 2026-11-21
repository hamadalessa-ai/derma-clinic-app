import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ClinicSite } from "@/components/site/clinic-site";
import { brandStyle, pick } from "@/lib/brand";
import { getStaffContext } from "@/lib/auth/session";
import { loadClinicSite } from "@/lib/site/data";
import { getCurrentTenant } from "@/lib/tenant/current";
import { publicPagesOpen } from "@/lib/tenant/status";
import type { Locale } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getCurrentTenant();
  if (!tenant) return {};
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("site");
  const name = pick(locale, tenant.nameAr, tenant.nameEn);
  return {
    title: t("metaTitle", { name }),
    description: t("metaDescription", { name }),
    openGraph: { title: t("metaTitle", { name }), description: t("metaDescription", { name }) },
  };
}

/**
 * The clinic's public website, built from the clinic's own data (Settings → Website).
 * Everyone sees it, signed-in staff too: for them the top bar's "Staff sign-in" becomes "Open app".
 */
export default async function ClinicHome() {
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/clinic-not-found");
  if (!publicPagesOpen(tenant)) redirect("/unavailable");
  const staff = !!(await getStaffContext());
  const locale = (await getLocale()) as Locale;
  const data = await loadClinicSite(tenant.id);
  return (
    <div style={brandStyle(tenant.brandColor)}>
      <ClinicSite clinic={tenant} data={data} locale={locale} staff={staff} />
    </div>
  );
}
