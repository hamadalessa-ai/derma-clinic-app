import Link from "next/link";
import { asc } from "drizzle-orm";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { getDb } from "@/db/client";
import { tenants } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { pick } from "@/lib/brand";
import type { Locale } from "@/i18n/config";

export default async function PlatformPage() {
  await requirePermission("platform:read");
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("platform");
  // The clinic directory only; patient data stays locked by RLS.
  const rows = await getDb().select().from(tenants).orderBy(asc(tenants.createdAt));

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
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((tenant) => (
          <Card key={tenant.id}>
            <CardContent className="flex items-center gap-3 pt-5">
              <span
                className="size-8 shrink-0 rounded-full"
                style={{ background: tenant.brandColor }}
              />
              <div>
                <div className="font-semibold">{pick(locale, tenant.nameAr, tenant.nameEn)}</div>
                <div className="text-muted-foreground text-xs">
                  {t("subdomain")}: <span dir="ltr">{tenant.slug}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
