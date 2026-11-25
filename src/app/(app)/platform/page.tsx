import Link from "next/link";
import { headers } from "next/headers";
import { clinicAddress } from "@/lib/platform/clinics";
import { getLocale, getTranslations } from "next-intl/server";
import { NewClinicForm } from "@/components/clinic/new-clinic-form";
import { PlatformClinic } from "@/components/clinic/platform-clinic";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { pick } from "@/lib/brand";
import { platformOverview, SETUP_STEPS } from "@/lib/platform/overview";
import { PLANS } from "@/lib/platform/plans";
import { clinicWhatsAppView } from "@/lib/platform/whatsapp";
import type { Locale } from "@/i18n/config";

export default async function PlatformPage() {
  const ctx = await requirePermission("platform:read");
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("platform");
  // Clinics with counts only; patient data stays locked by RLS.
  const clinics = await platformOverview();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  /** The clinic's own address, or this address when it IS the clinic on this address. */
  const openUrl = (slug: string, id: string) => {
    const address = clinicAddress(slug, { host, proto });
    return address ? `${address}/home` : id === ctx.tenant.id ? "/home" : null;
  };
  const open = clinics.flatMap((c) => c.statements.filter((x) => x.status === "issued"));
  const outstanding = open.reduce((n, x) => n + x.totalHalalas - x.paidHalalas, 0);
  const overdueClinics = clinics.filter((c) => c.statements.some((x) => x.overdue)).length;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="text-muted-foreground text-sm">{t("noPatientAccess")}</p>
      <Link
        href="/platform/push-keys"
        className="text-brand-strong self-start text-sm font-medium underline"
        data-testid="push-keys-link"
      >
        {t("pushKeys")}
      </Link>
      <Link
        href="/platform/system"
        className="text-brand-strong self-start text-sm font-medium underline"
        data-testid="system-status-link"
      >
        {t("systemStatus")}
      </Link>
      <div className="grid gap-3 sm:grid-cols-3" data-testid="platform-summary">
        {[
          [t("summaryClinics"), String(clinics.length)],
          [t("summaryOutstanding"), `${(outstanding / 100).toFixed(2)} ${t("sar")}`],
          [t("summaryOverdue"), String(overdueClinics)],
        ].map(([label, value]) => (
          <div key={label} className="bg-card shadow-card rounded-xl border p-4">
            <div className="text-muted-foreground text-xs">{label}</div>
            <div className="text-xl font-semibold tabular-nums">{value}</div>
          </div>
        ))}
      </div>
      {can(ctx.roles, "platform:clinics") && <NewClinicForm />}
      <div className="flex flex-col gap-3">
        {clinics.map(({ tenant, setup, usage, statements, support }) => (
          <PlatformClinic
            key={tenant.id}
            clinic={{
              id: tenant.id,
              name: pick(locale, tenant.nameAr, tenant.nameEn),
              slug: tenant.slug,
              brandColor: tenant.brandColor,
              isDemo: tenant.isDemo,
              status: tenant.status,
              statusReason: tenant.statusReason,
              statusChangedAt: tenant.statusChangedAt?.toISOString() ?? null,
              setup: SETUP_STEPS.map((step) => ({ step, done: setup[step] })),
              usage: { ...usage, lastSignInAt: usage.lastSignInAt?.toISOString() ?? null },
              ownLimits: {
                aiMonthly: tenant.limits.aiMonthly ?? null,
                whatsappMonthly: tenant.limits.whatsappMonthly ?? null,
              },
              plan: tenant.plan,
              planLimits: PLANS[tenant.plan].limits,
              priceHalalas: tenant.monthlyPriceHalalas,
              trialEndsOn: tenant.trialEndsOn,
              graceDays: tenant.billingGraceDays,
              pausedForBilling: tenant.pausedForBilling,
              statements,
              support: support
                ? {
                    expiresAt: support.expiresAt.toISOString(),
                    allowChanges: support.allowChanges,
                    reason: support.reason,
                  }
                : null,
              openUrl: openUrl(tenant.slug, tenant.id),
              whatsapp: clinicWhatsAppView(tenant),
            }}
          />
        ))}
      </div>
    </div>
  );
}
