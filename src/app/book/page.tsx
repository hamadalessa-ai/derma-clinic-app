import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { SiteLangSwitch } from "@/components/site/site-lang-switch";
import { OnlineBookingFlow } from "@/components/public/online-booking-flow";
import { PublicHeader } from "@/components/public/public-header";
import { Notice } from "@/components/ui/notice";
import { withTenant } from "@/db/tenant";
import { addDays } from "@/lib/booking/time";
import { brandStyle, pick } from "@/lib/brand";
import { demoMessagingAllowed } from "@/lib/messaging/sender";
import { loadBookingCatalog } from "@/lib/online/catalog";
import { bookingIdentity } from "@/lib/verify/identity";
import { getCurrentTenant } from "@/lib/tenant/current";
import { clinicIsActive, publicPagesOpen } from "@/lib/tenant/status";
import { todayRiyadh } from "@/components/clinic/time";
import type { Locale } from "@/i18n/config";

export const metadata: Metadata = { title: "Book · احجز" };

/** Public online booking. No login: the mobile number is verified with a code. */
export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string; mode?: string; doctor?: string }>;
}) {
  const sp = await searchParams;
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/clinic-not-found");
  if (!publicPagesOpen(tenant)) redirect("/unavailable");
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("book");
  const catalog = await withTenant(tenant.id, (tx) => loadBookingCatalog(tx));
  // Verified earlier in this browser (step 1 done) or signed in on the patient page.
  const identity = await bookingIdentity(tenant.id);
  const UUID = /^[0-9a-f-]{36}$/i;
  const mode: "video" | "clinic" | undefined =
    sp.mode === "video" ? "video" : sp.mode === "clinic" ? "clinic" : undefined;
  const initial = {
    serviceId: sp.service && UUID.test(sp.service) ? sp.service : undefined,
    mode,
    doctorId: sp.doctor && UUID.test(sp.doctor) ? sp.doctor : undefined,
  };
  const today = todayRiyadh();
  const days = Array.from({ length: catalog.settings.horizonDays + 1 }, (_, i) =>
    addDays(today, i),
  );

  return (
    <div
      style={brandStyle(tenant.brandColor)}
      className="font-site bg-site-mist flex min-h-screen flex-col"
    >
      <PublicHeader
        clinicName={pick(locale, tenant.nameAr, tenant.nameEn)}
        demoMode={demoMessagingAllowed(tenant) ? t("demoMode") : null}
        toggle={<SiteLangSwitch tone="light" className="text-site-slate" />}
      />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-4 pt-8 pb-12">
        <div>
          <h1 className="font-display text-site-ink text-3xl font-semibold">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
        {catalog.enabled && clinicIsActive(tenant) && catalog.departments.length > 0 ? (
          <OnlineBookingFlow catalog={catalog} days={days} identity={identity} initial={initial} />
        ) : (
          <Notice tone="warning">{t("disabled")}</Notice>
        )}
        <p className="text-muted-foreground text-xs">{t("privacy")}</p>
        <Link
          href="/my"
          className="text-brand-strong text-sm font-medium underline-offset-2 hover:underline"
        >
          {t("myLink")}
        </Link>
      </main>
    </div>
  );
}
