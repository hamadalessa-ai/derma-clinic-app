import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { LanguageToggle } from "@/components/language-toggle";
import { PortalHome } from "@/components/public/portal-home";
import { PortalSignIn } from "@/components/public/portal-sign-in";
import { PublicHeader } from "@/components/public/public-header";
import { brandStyle, pick } from "@/lib/brand";
import { demoMessagingAllowed } from "@/lib/messaging/sender";
import { loadPortal } from "@/lib/portal/data";
import { PATIENT_COOKIE, patientForToken } from "@/lib/portal/session";
import { getCurrentTenant } from "@/lib/tenant/current";
import type { Locale } from "@/i18n/config";

export const metadata: Metadata = { title: "My page · صفحتي" };

/** The patient page: sign in with a code; then own and family appointments, balances, consents. */
export default async function MyPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/clinic-not-found");
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("book");
  const session = await patientForToken(tenant.id, (await cookies()).get(PATIENT_COOKIE)?.value);
  const data = session ? await loadPortal(tenant.id, session.patientId) : null;

  return (
    <div style={brandStyle(tenant.brandColor)} className="bg-background flex min-h-screen flex-col">
      <PublicHeader
        clinicName={pick(locale, tenant.nameAr, tenant.nameEn)}
        demoMode={demoMessagingAllowed(tenant) ? t("demoMode") : null}
        toggle={<LanguageToggle />}
      />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 pt-4 pb-12">
        {data?.me ? <PortalHome data={data} /> : <PortalSignIn />}
      </main>
    </div>
  );
}
