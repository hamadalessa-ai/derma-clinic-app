import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { eq } from "drizzle-orm";
import { CalendarClock, CheckCircle2 } from "lucide-react";
import { LanguageToggle } from "@/components/language-toggle";
import { ConsentLinkForm } from "@/components/public/consent-link-form";
import { PublicHeader } from "@/components/public/public-header";
import { Notice } from "@/components/ui/notice";
import { appointments, patients, services } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { brandStyle, pick } from "@/lib/brand";
import { missingConsent } from "@/lib/consents/consents";
import { formatGregorian, formatTime } from "@/lib/format";
import { demoMessagingAllowed } from "@/lib/messaging/sender";
import { getCurrentTenant } from "@/lib/tenant/current";
import { publicPagesOpen } from "@/lib/tenant/status";
import { parseConsentToken, videoToken } from "@/lib/video/link";
import type { Locale } from "@/i18n/config";

export const metadata: Metadata = { title: "Consent · الموافقة" };

/**
 * The consent link from WhatsApp: this visit's consent, ready to sign (no code). Shows only the
 * first name, service and time; nothing else from the file.
 */
export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/clinic-not-found");
  if (!publicPagesOpen(tenant)) redirect("/unavailable");
  const { token } = await params;
  const appointmentId = parseConsentToken(tenant.id, token);
  if (!appointmentId) notFound();
  const data = await withTenant(tenant.id, async (tx) => {
    const [row] = await tx
      .select({ a: appointments, p: patients, s: services })
      .from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .where(eq(appointments.id, appointmentId));
    if (!row) return null;
    const open = ["pending", "booked", "confirmed", "arrived"].includes(row.a.status);
    const template = open ? await missingConsent(tx, row.a) : null;
    let guardianName: string | null = null;
    if (row.p.guardianId) {
      const [g] = await tx
        .select({ nameAr: patients.fullNameAr })
        .from(patients)
        .where(eq(patients.id, row.p.guardianId));
      guardianName = g?.nameAr ?? null;
    }
    return { ...row, open, template, guardianName };
  });
  if (!data) notFound();
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("sign");
  const tb = await getTranslations("book");
  const first = (s: string | null | undefined) => (s ?? "").trim().split(/\s+/)[0] ?? "";
  const patientFirst = pick(locale, first(data.p.fullNameAr), first(data.p.fullNameEn));
  const videoPath =
    data.s.isVirtual && data.open ? `/visit/${videoToken(tenant.id, data.a.id)}` : null;

  return (
    <div style={brandStyle(tenant.brandColor)} className="bg-background flex min-h-screen flex-col">
      <PublicHeader
        clinicName={pick(locale, tenant.nameAr, tenant.nameEn)}
        demoMode={demoMessagingAllowed(tenant) ? tb("demoMode") : null}
        toggle={<LanguageToggle />}
      />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 pt-4 pb-12">
        <h1 className="text-[22px] leading-[30px] font-semibold">
          {t("title", { name: patientFirst })}
        </h1>
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <CalendarClock className="text-brand-strong size-4" />
          {pick(locale, data.s.nameAr, data.s.nameEn)} ·{" "}
          {formatGregorian(data.a.startsAt, locale, "full")} · {formatTime(data.a.startsAt, locale)}
        </p>
        {!data.open ? (
          <Notice tone="info">{t("closed")}</Notice>
        ) : !data.template ? (
          <Notice tone="success" className="flex items-center gap-2" data-testid="sign-nothing">
            <CheckCircle2 className="size-5 shrink-0" />
            {t("nothing")}
          </Notice>
        ) : (
          <ConsentLinkForm
            token={token}
            title={pick(locale, data.template.titleAr, data.template.titleEn)}
            body={locale === "en" ? data.template.bodyEn : data.template.bodyAr}
            otherBody={locale === "en" ? data.template.bodyAr : data.template.bodyEn}
            signer={data.guardianName ?? data.p.fullNameAr}
            forChild={data.guardianName ? patientFirst : null}
            videoPath={videoPath}
          />
        )}
      </main>
    </div>
  );
}
