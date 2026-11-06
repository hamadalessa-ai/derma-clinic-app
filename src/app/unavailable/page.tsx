import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { brandStyle, pick } from "@/lib/brand";
import { getCurrentTenant } from "@/lib/tenant/current";
import { publicPagesOpen } from "@/lib/tenant/status";
import type { Locale } from "@/i18n/config";

export const metadata: Metadata = { robots: { index: false } };

/** Shown instead of the website / booking / patient page while a clinic's account is paused. */
export default async function UnavailablePage() {
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/clinic-not-found");
  if (publicPagesOpen(tenant)) redirect("/");
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("clinicStatus");
  return (
    <main
      style={brandStyle(tenant.brandColor)}
      className="bg-background flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <h1 className="text-brand-strong text-2xl font-bold">
        {pick(locale, tenant.nameAr, tenant.nameEn)}
      </h1>
      <p className="text-muted-foreground max-w-md">{t("unavailable")}</p>
      <Link href="/login" className="text-muted-foreground text-xs underline">
        {t("staffLogin")}
      </Link>
    </main>
  );
}
