import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { LanguageToggle } from "@/components/language-toggle";
import { OnlineBookingFlow } from "@/components/public/online-booking-flow";
import { PublicHeader } from "@/components/public/public-header";
import { Notice } from "@/components/ui/notice";
import { withTenant } from "@/db/tenant";
import { addDays } from "@/lib/booking/time";
import { brandStyle, pick } from "@/lib/brand";
import { demoMessagingAllowed } from "@/lib/messaging/sender";
import { loadBookingCatalog } from "@/lib/online/catalog";
import { getCurrentTenant } from "@/lib/tenant/current";
import { todayRiyadh } from "@/components/clinic/time";
import type { Locale } from "@/i18n/config";

export const metadata: Metadata = { title: "Book · احجز" };

/** Public online booking. No login: the mobile number is verified with a code. */
export default async function BookPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/clinic-not-found");
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("book");
  const catalog = await withTenant(tenant.id, (tx) => loadBookingCatalog(tx));
  const today = todayRiyadh();
  const days = Array.from({ length: catalog.settings.horizonDays + 1 }, (_, i) =>
    addDays(today, i),
  );

  return (
    <div style={brandStyle(tenant.brandColor)} className="bg-background flex min-h-screen flex-col">
      <PublicHeader
        clinicName={pick(locale, tenant.nameAr, tenant.nameEn)}
        demoMode={demoMessagingAllowed(tenant) ? t("demoMode") : null}
        toggle={<LanguageToggle />}
      />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 pt-4 pb-12">
        <div>
          <h1 className="text-xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
        {catalog.enabled && catalog.departments.length > 0 ? (
          <OnlineBookingFlow catalog={catalog} days={days} />
        ) : (
          <Notice tone="warning">{t("disabled")}</Notice>
        )}
        <p className="text-muted-foreground text-xs">{t("privacy")}</p>
        <Link
          href="/my"
          className="text-brand text-sm font-medium underline-offset-2 hover:underline"
        >
          {t("myLink")}
        </Link>
      </main>
    </div>
  );
}
