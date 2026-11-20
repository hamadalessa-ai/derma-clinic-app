import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { LanguageToggle } from "@/components/language-toggle";
import { PublicHeader } from "@/components/public/public-header";
import { Notice } from "@/components/ui/notice";
import { InstructionSheet } from "@/components/visits/instruction-sheet";
import { PrintButton } from "@/app/consents/[id]/print/print-button";
import { withTenant } from "@/db/tenant";
import { brandStyle, pick } from "@/lib/brand";
import { demoMessagingAllowed } from "@/lib/messaging/sender";
import { getCurrentTenant } from "@/lib/tenant/current";
import { publicPagesOpen } from "@/lib/tenant/status";
import { parseCareToken } from "@/lib/video/link";
import { instructionsData } from "@/lib/visits/checkout";
import type { Locale } from "@/i18n/config";

export const metadata: Metadata = { title: "Instructions · التعليمات" };

/** The link opens for this many days after the visit. */
const CARE_LINK_DAYS = 60;

/**
 * The patient's after-visit instructions, from the WhatsApp link (signed, this visit only):
 * first name, medication, treatment plan, next appointments. Nothing else from the file.
 */
export default async function CarePage({ params }: { params: Promise<{ token: string }> }) {
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/clinic-not-found");
  if (!publicPagesOpen(tenant)) redirect("/unavailable");
  const { token } = await params;
  const appointmentId = parseCareToken(tenant.id, token);
  if (!appointmentId) notFound();
  const data = await withTenant(tenant.id, (tx) => instructionsData(tx, appointmentId));
  if (!data || data.appointment.status !== "completed") notFound();
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("care");
  const tb = await getTranslations("book");
  const expired =
    Date.now() - data.appointment.startsAt.getTime() > CARE_LINK_DAYS * 86400_000;
  const clinicName = pick(locale, tenant.nameAr, tenant.nameEn);

  return (
    <div style={brandStyle(tenant.brandColor)} className="bg-background flex min-h-screen flex-col">
      <div className="print:hidden">
        <PublicHeader
          clinicName={clinicName}
          demoMode={demoMessagingAllowed(tenant) ? tb("demoMode") : null}
          toggle={<LanguageToggle />}
        />
      </div>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 pt-4 pb-12 print:max-w-none">
        {expired ? (
          <Notice tone="info">{t("expired")}</Notice>
        ) : (
          <>
            <InstructionSheet data={data} clinicName={clinicName} fullName={false} />
            <div className="print:hidden">
              <PrintButton label={t("print")} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
