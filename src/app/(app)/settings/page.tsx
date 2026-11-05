import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  RefreshDemoButton,
  HoursSettingForm,
  ScheduleSettingForm,
  ScribeSettingForm,
} from "@/components/clinic/settings-forms";
import {
  BookingLink,
  OnlineServicesList,
  OnlineSettingsForm,
  StaffGenderList,
} from "@/components/clinic/online-settings";
import { asc, eq } from "drizzle-orm";
import QRCode from "qrcode";
import { services, tenantMembers, users } from "@/db/schema";
import { mainAppUrl } from "@/lib/app-url";
import { withActor } from "@/lib/auth/db";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/booking/engine";
import { consentRulesByCode, currentTemplates } from "@/lib/consents/consents";
import { pick } from "@/lib/brand";
import type { Locale } from "@/i18n/config";

export default async function SettingsPage() {
  const ctx = await requirePermission("settings:manage");
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("settings");
  const tw = await getTranslations("whatsapp");
  const tr = await getTranslations("consentRules");
  const { settings, templates, rules, serviceRows, doctors } = await withActor(
    actorOf(ctx),
    async (tx) => ({
      settings: await getSettings(tx),
      templates: await currentTemplates(tx),
      rules: await consentRulesByCode(tx),
      serviceRows: await tx
        .select({
          id: services.id,
          nameAr: services.nameAr,
          nameEn: services.nameEn,
          onlineBookable: services.onlineBookable,
        })
        .from(services)
        .where(eq(services.isActive, true))
        .orderBy(asc(services.sortOrder)),
      doctors: (
        await tx
          .select({
            id: tenantMembers.id,
            roles: tenantMembers.roles,
            gender: tenantMembers.gender,
            nameAr: users.name,
            nameEn: users.nameEn,
          })
          .from(tenantMembers)
          .innerJoin(users, eq(users.id, tenantMembers.userId))
          .orderBy(asc(tenantMembers.createdAt))
      ).filter((m) => m.roles.includes("practitioner")),
    }),
  );
  const bookingUrl = `${await mainAppUrl()}/book`;
  // Plain black on white: what QR scanners read best (and what prints best).
  const qrPng = await QRCode.toDataURL(bookingUrl, { width: 480, margin: 2 });
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader title={t("title")} />
      <Link
        href="/settings/whatsapp"
        className="text-brand-strong self-start text-sm font-medium underline"
        data-testid="whatsapp-settings-link"
      >
        {tw("settingsLink")}
      </Link>
      <Card>
        <CardContent className="pt-5">
          <ScheduleSettingForm initial={settings.doctorsManageOwnSchedule} />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-5">
          <HoursSettingForm initial={settings.doctorsEditOwnHours} />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-5">
          <ScribeSettingForm
            initial={settings.aiScribeEnabled}
            keySet={!!process.env.ANTHROPIC_API_KEY?.trim()}
          />
        </CardContent>
      </Card>
      <Card data-testid="online-booking-settings">
        <CardHeader>
          <CardTitle>{t("onlineBooking")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <BookingLink url={bookingUrl} qrPng={qrPng} />
          <OnlineSettingsForm
            initial={{
              onlineBookingEnabled: settings.onlineBookingEnabled,
              onlineHorizonDays: settings.onlineHorizonDays,
              onlineMinNoticeMinutes: settings.onlineMinNoticeMinutes,
              cancellationWindowHours: settings.cancellationWindowHours,
              onlineRequiresApproval: settings.onlineRequiresApproval,
              showPricesOnline: settings.showPricesOnline,
            }}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("onlineServices")}</CardTitle>
        </CardHeader>
        <CardContent>
          <OnlineServicesList services={serviceRows} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("doctorGender")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-2 text-sm">{t("doctorGenderHint")}</p>
          <StaffGenderList
            doctors={doctors.map((d) => ({
              id: d.id,
              name: pick(locale, d.nameAr, d.nameEn),
              gender: d.gender,
            }))}
          />
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
                  <span
                    className="text-muted-foreground block text-xs"
                    data-testid="consent-rule-summary"
                    data-code={tpl.code}
                  >
                    {(() => {
                      const r = rules.get(tpl.code) ?? { rule: "every_visit", months: null };
                      return tr(`summary.${r.rule}`, { months: r.months ?? 0 });
                    })()}
                  </span>
                </span>
                <Link
                  href={`/settings/consents/${tpl.code}`}
                  className="text-brand-strong text-sm underline"
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
