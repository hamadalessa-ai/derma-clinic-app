import Link from "next/link";
import { SupportAccess } from "@/components/clinic/support-access";
import { activeGrant, supportActivity } from "@/lib/support/grants";
import { Badge } from "@/components/ui/badge";
import { statementsIn } from "@/lib/platform/billing";
import { FEATURES, planAllows } from "@/lib/platform/plans";
import { Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EXPORT_KINDS } from "@/lib/export/clinic-export";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { redirect } from "next/navigation";
import { ClinicSettingsShell } from "@/components/clinic/clinic-settings-shell";

type SettingsTab = "clinic" | "team" | "subscription" | "booking" | "website" | "consents" | "demo";
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
  const tp = await getTranslations("platformClinic");
  const { settings, doctors } = await withActor(actorOf(ctx), async (tx) => ({
    settings: await getSettings(tx),
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
    "subscription",
    "booking",
    "website",
    "consents",
    ...(ctx.tenant.isDemo ? (["demo"] as const) : []),
  ];
  const tab: SettingsTab = (allowed as string[]).includes(sp.tab ?? "")
    ? (sp.tab as SettingsTab)
    : "clinic";
  // Consent forms have ONE place: Clinic settings → Consent forms (each opens its own edit page).
  if (tab === "consents") redirect("/setup?tab=consents");
  const team = tab === "team" ? await withActor(actorOf(ctx), (tx) => listTeam(tx)) : null;
  // Support access is the clinic's own decision: not shown to the platform during a support session.
  const support =
    tab === "team" && can(ctx.roles, "support:grant") && !ctx.support
      ? await withActor(actorOf(ctx), async (tx) => ({
          active: await activeGrant(tx),
          activity: await supportActivity(tx),
        }))
      : null;
  const statements =
    tab === "subscription" && can(ctx.roles, "billing:view")
      ? await withActor(actorOf(ctx), (tx) => statementsIn(tx))
      : null;
  return (
    <ClinicSettingsShell
      active={tab === "clinic" ? "details" : tab}
      isDemo={ctx.tenant.isDemo}
    >
      <div className="flex max-w-3xl flex-col gap-4">
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
        {tab === "subscription" && statements && (
          <Card data-testid="subscription">
            <CardHeader>
              <CardTitle>{t("tabSubscription")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground text-xs">{tp("plan.label")}</dt>
                  <dd className="font-semibold">{tp(`plan.${ctx.tenant.plan}`)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">{tp("price")}</dt>
                  <dd className="font-semibold tabular-nums">
                    {(ctx.tenant.monthlyPriceHalalas / 100).toFixed(2)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">{tp("trialEnds")}</dt>
                  <dd className="font-semibold" dir="ltr">
                    {ctx.tenant.trialEndsOn ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">{t("subscriptionStatus")}</dt>
                  <dd className="font-semibold">{tp(`status.${ctx.tenant.status}`)}</dd>
                </div>
              </dl>
              <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {FEATURES.map((f) => (
                  <li key={f}>
                    {planAllows(ctx.tenant, f) ? "✓" : "–"} {tp(`feature.${f}`)}
                  </li>
                ))}
              </ul>
              {statements.length === 0 ? (
                <p className="text-muted-foreground text-sm">{tp("noStatements")}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {statements.map((st) => (
                    <li
                      key={st.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                    >
                      <span className="font-medium" dir="ltr">
                        {st.number}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {tp("statementTotal", { amount: (st.totalHalalas / 100).toFixed(2) })} ·{" "}
                        {tp("statementDue", { day: st.dueOn })}
                      </span>
                      <Badge
                        variant={
                          st.status === "paid"
                            ? "default"
                            : st.overdue
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {st.overdue ? tp("overdue") : tp(`statementStatus.${st.status}`)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-muted-foreground text-xs">{t("subscriptionHint")}</p>
            </CardContent>
          </Card>
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
        {tab === "team" && support && (
          <Card>
            <CardHeader>
              <CardTitle>{t("supportTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <SupportAccess
                active={
                  support.active
                    ? {
                        expiresAt: support.active.expiresAt.toISOString(),
                        allowChanges: support.active.allowChanges,
                      }
                    : null
                }
                activity={support.activity.map((a) => ({
                  at: a.at.toISOString(),
                  action: a.action,
                  path: ((a.metadata ?? {}) as { path?: string | null }).path ?? null,
                }))}
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
    </ClinicSettingsShell>
  );
}
