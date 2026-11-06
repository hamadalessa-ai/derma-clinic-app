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
 * Signed-in staff go to their work screens instead; `?preview` shows them the website.
 */
export default async function ClinicHome({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/clinic-not-found");
  if (!publicPagesOpen(tenant)) redirect("/unavailable");
  const { preview } = await searchParams;
  if (preview === undefined && (await getStaffContext())) redirect("/home");
  const locale = (await getLocale()) as Locale;
  const data = await loadClinicSite(tenant.id);
  return (
    <div style={brandStyle(tenant.brandColor)}>
      <ClinicSite clinic={tenant} data={data} locale={locale} />
    </div>
  );
}
