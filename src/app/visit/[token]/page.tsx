import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarClock, Stethoscope } from "lucide-react";
import { LanguageToggle } from "@/components/language-toggle";
import { PublicHeader } from "@/components/public/public-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { RefreshEvery } from "@/components/video/refresh-every";
import { VideoCall } from "@/components/video/video-call";
import { withTenant } from "@/db/tenant";
import { brandStyle, pick } from "@/lib/brand";
import { formatGregorian, formatTime } from "@/lib/format";
import { demoMessagingAllowed } from "@/lib/messaging/sender";
import { getCurrentTenant } from "@/lib/tenant/current";
import { parseVideoToken } from "@/lib/video/link";
import { videoProvider } from "@/lib/video/provider";
import { loadVisit, PATIENT_EARLY_MINUTES, videoState } from "@/lib/video/visit";
import type { Locale } from "@/i18n/config";

export const metadata: Metadata = { title: "Video consultation · استشارة مرئية" };

/**
 * The patient's video consultation page, opened from the link in their WhatsApp message.
 * Shows only the first name, service, doctor and time; the call itself starts on "Join".
 */
export default async function VisitPage({ params }: { params: Promise<{ token: string }> }) {
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/clinic-not-found");
  const { token } = await params;
  const appointmentId = parseVideoToken(tenant.id, token);
  if (!appointmentId) notFound();
  const visit = await withTenant(tenant.id, (tx) => loadVisit(tx, appointmentId));
  if (!visit || !visit.isVirtual) notFound();
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("video");
  const tb = await getTranslations("book");
  const state = videoState(visit, "patient");
  const name = pick(locale, visit.patientFirstAr, visit.patientFirstEn);
  const when = `${formatGregorian(visit.startsAt, locale, "full")} · ${formatTime(visit.startsAt, locale)}`;

  return (
    <div style={brandStyle(tenant.brandColor)} className="bg-background flex min-h-screen flex-col">
      <PublicHeader
        clinicName={pick(locale, tenant.nameAr, tenant.nameEn)}
        demoMode={demoMessagingAllowed(tenant) ? tb("demoMode") : null}
        toggle={<LanguageToggle />}
      />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 pt-4 pb-12">
        <h1 className="text-xl font-semibold">{t("patientTitle", { name })}</h1>
        <Card>
          <CardContent className="flex flex-col gap-2 pt-4 text-sm">
            <div className="flex items-center gap-2">
              <Stethoscope className="text-brand-strong size-4 shrink-0" />
              {pick(locale, visit.serviceAr, visit.serviceEn)} ·{" "}
              {pick(locale, visit.doctorAr, visit.doctorEn ?? visit.doctorAr)}
            </div>
            <div className="flex items-center gap-2">
              <CalendarClock className="text-brand-strong size-4 shrink-0" />
              {when}
            </div>
          </CardContent>
        </Card>

        {state === "cancelled" && <Notice tone="warning">{t("cancelled")}</Notice>}
        {state === "ended" && <Notice tone="info">{t("ended")}</Notice>}
        {state === "too_early" && (
          <>
            <Notice tone="info">{t("tooEarly", { minutes: PATIENT_EARLY_MINUTES })}</Notice>
            <RefreshEvery />
          </>
        )}
        {state === "open" && visit.consentNeeded && (
          <Notice tone="warning" className="flex flex-col gap-2">
            <span>{t("consentFirst")}</span>
            <Link href="/my" className={buttonVariants({ size: "sm", className: "self-start" })}>
              {t("signConsent")}
            </Link>
          </Notice>
        )}
        {state === "open" && !visit.consentNeeded && !videoProvider() && (
          <Notice tone="warning">{t("notConnected")}</Notice>
        )}
        {state === "open" && !visit.consentNeeded && videoProvider() && (
          <VideoCall as="patient" token={token} />
        )}

        <ul className="text-muted-foreground flex list-disc flex-col gap-1 ps-5 text-xs">
          <li>{t("tipPlace")}</li>
          <li>{t("tipPhotos")}</li>
          <li>{t("tipPrivacy")}</li>
          <li>{t("tipEmergency")}</li>
        </ul>
      </main>
    </div>
  );
}
