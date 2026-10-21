import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { RefreshDemoButton, ScheduleSettingForm } from "@/components/clinic/settings-forms";
import { withActor } from "@/lib/auth/db";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/booking/engine";
import { currentTemplates } from "@/lib/consents/consents";
import { pick } from "@/lib/brand";
import type { Locale } from "@/i18n/config";

export default async function SettingsPage() {
  const ctx = await requirePermission("settings:manage");
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("settings");
  const { settings, templates } = await withActor(actorOf(ctx), async (tx) => ({
    settings: await getSettings(tx),
    templates: await currentTemplates(tx),
  }));
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader title={t("title")} />
      <Card>
        <CardContent className="pt-5">
          <ScheduleSettingForm initial={settings.doctorsManageOwnSchedule} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("consentTemplates")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y">
            {templates.map((tpl) => (
              <li key={tpl.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  {pick(locale, tpl.titleAr, tpl.titleEn)}{" "}
                  <span className="text-muted-foreground text-xs">· v{tpl.version}</span>
                </span>
                <Link
                  href={`/settings/consents/${tpl.code}`}
                  className="text-brand text-sm underline"
                >
                  {t("editTemplate")}
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      {ctx.tenant.isDemo && (
        <Card>
          <CardHeader>
            <CardTitle>{t("demo")}</CardTitle>
          </CardHeader>
          <CardContent>
            <RefreshDemoButton />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
