import Link from "next/link";
import { Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EXPORT_KINDS } from "@/lib/export/clinic-export";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/notice";
import { SettingsTabs, type SettingsTab } from "@/components/clinic/settings-tabs";
import {
  RefreshDemoButton,
  HoursSettingForm,
  ScheduleSettingForm,
  ScribeSettingForm,
} from "@/components/clinic/settings-forms";
import { SiteSettingsForm } from "@/components/clinic/site-settings";
import { TeamSettings } from "@/components/clinic/team-settings";
import { listTeam } from "@/lib/team/team";
import {
  BookingLink,
  OnlineSettingsForm,
  StaffGenderList,
} from "@/components/clinic/online-settings";
import { asc, eq } from "drizzle-orm";
import QRCode from "qrcode";
import { tenantMembers, users } from "@/db/schema";
import { mainAppUrl } from "@/lib/app-url";
import { withActor } from "@/lib/auth/db";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getSettings } from "@/lib/booking/engine";
import { consentRulesByCode, currentTemplates } from "@/lib/consents/consents";
import { pick } from "@/lib/brand";
import type { Locale } from "@/i18n/config";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requirePermission("settings:manage");
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("settings");
  const tr = await getTranslations("consentRules");
  const { settings, templates, rules, doctors } = await withActor(actorOf(ctx), async (tx) => ({
    settings: await getSettings(tx),
    templates: await currentTemplates(tx),
    rules: await consentRulesByCode(tx),
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
  }));
  const bookingUrl = `${await mainAppUrl()}/book`;
  // Plain black on white: what QR scanners read best (and what prints best).
  const qrPng = await QRCode.toDataURL(bookingUrl, { width: 480, margin: 2 });
  const allowed: SettingsTab[] = [
    "clinic",
    "team",
    "booking",
    "website",
    "consents",
    ...(ctx.tenant.isDemo ? (["demo"] as const) : []),
  ];
  const tab: SettingsTab = (allowed as string[]).includes(sp.tab ?? "")
    ? (sp.tab as SettingsTab)
    : "clinic";
  const team = tab === "team" ? await withActor(actorOf(ctx), (tx) => listTeam(tx)) : null;
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader title={t("title")} />
      <SettingsTabs active={tab} isDemo={ctx.tenant.isDemo} />
      {tab === "clinic" && (
        <>
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
          {can(ctx.roles, "data:export") && (
            <Card data-testid="data-export">
              <CardHeader>
                <CardTitle>{t("exportTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-muted-foreground text-sm">{t("exportHint")}</p>
                <div className="flex flex-wrap gap-2">
                  {EXPORT_KINDS.map((k) => (
                    <a
                      key={k}
                      href={`/export/${k}`}
                      download
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      <Download />
                      {t(`export_${k}`)}
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
      {tab === "team" && team && (
        <Card data-testid="team-settings">
          <CardHeader>
            <CardTitle>{t("tabTeam")}</CardTitle>
          </CardHeader>
          <CardContent>
            <TeamSettings
              members={team.members.map((m) => ({
                ...m,
                deactivatedAt: m.deactivatedAt ? m.deactivatedAt.toISOString() : null,
              }))}
              websiteDoctors={team.websiteDoctors}
              branches={ctx.branches.map((b) => ({
                id: b.id,
                name: pick(locale, b.nameAr, b.nameEn),
              }))}
              selfId={ctx.memberId}
            />
          </CardContent>
        </Card>
      )}
      {tab === "website" && (
        <Card data-testid="site-settings">
          <CardHeader>
            <CardTitle>{t("tabWebsite")}</CardTitle>
          </CardHeader>
          <CardContent>
            <SiteSettingsForm initial={settings.site ?? {}} />
          </CardContent>
        </Card>
      )}
      {tab === "booking" && (
        <>
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
          <Notice tone="info">
            <Link href="/services" className="underline">
              {t("servicesOnlineLink")}
            </Link>
          </Notice>
        </>
      )}
      {tab === "consents" && (
        <>
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
        </>
      )}
      {tab === "demo" && (
        <>
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
        </>
      )}
    </div>
  );
}
