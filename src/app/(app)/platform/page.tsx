import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { NewClinicForm } from "@/components/clinic/new-clinic-form";
import { PlatformClinic } from "@/components/clinic/platform-clinic";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { pick } from "@/lib/brand";
import { platformOverview, SETUP_STEPS } from "@/lib/platform/overview";
import type { Locale } from "@/i18n/config";

export default async function PlatformPage() {
  const ctx = await requirePermission("platform:read");
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("platform");
  // Clinics with counts only; patient data stays locked by RLS.
  const clinics = await platformOverview();

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
      {can(ctx.roles, "platform:clinics") && <NewClinicForm />}
      <div className="flex flex-col gap-3">
        {clinics.map(({ tenant, setup }) => (
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
            }}
          />
        ))}
      </div>
    </div>
  );
}
