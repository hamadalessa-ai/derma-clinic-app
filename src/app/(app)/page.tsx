import { and, count, eq, gte, inArray, lt } from "drizzle-orm";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { withTenant } from "@/db/tenant";
import {
  appointments,
  departments,
  devices,
  patients,
  rooms,
  services,
  tenantMembers,
} from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { withActor } from "@/lib/auth/db";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/clinic/badges";
import { APPOINTMENT_STATUSES } from "@/lib/booking/status";
import { dayRange, riyadhDay } from "@/lib/booking/time";
import { pendingRequests } from "@/lib/visits/reschedule";
import { pick } from "@/lib/brand";
import { formatGregorian, formatHijri } from "@/lib/format";
import type { Locale } from "@/i18n/config";

export default async function DashboardPage() {
  const ctx = await requirePermission("dashboard:view");
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("dashboard");
  const tDevices = await getTranslations("deviceTypes");
  const branchId = ctx.activeBranch?.id;
  const showClinicData = can(ctx.roles, "patients:read");

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const [patientCount] = showClinicData
      ? await tx.select({ n: count() }).from(patients)
      : [{ n: 0 }];
    const [serviceCount] = await tx.select({ n: count() }).from(services);
    const depts = await tx.select().from(departments).orderBy(departments.sortOrder);
    const branchIds = branchId ? [branchId] : [];
    const branchRooms = branchIds.length
      ? await tx.select().from(rooms).where(inArray(rooms.branchId, branchIds))
      : [];
    const branchDevices = branchIds.length
      ? await tx.select().from(devices).where(inArray(devices.branchId, branchIds))
      : [];
    const [staffCount] = branchId
      ? await tx
          .select({ n: count() })
          .from(tenantMembers)
          .where(eq(tenantMembers.branchId, branchId))
      : [{ n: 0 }];
    return { patientCount, serviceCount, depts, branchRooms, branchDevices, staffCount };
  });

  const now = new Date();
  const branchName = ctx.activeBranch
    ? pick(locale, ctx.activeBranch.nameAr, ctx.activeBranch.nameEn)
    : "";

  const stats = [
    ...(showClinicData ? [{ label: t("patients"), value: data.patientCount.n }] : []),
    { label: t("services"), value: data.serviceCount.n },
    { label: t("staff"), value: data.staffCount.n, sub: t("inBranch", { branch: branchName }) },
    {
      label: t("rooms"),
      value: data.branchRooms.length,
      sub: t("inBranch", { branch: branchName }),
    },
    {
      label: t("devices"),
      value: data.branchDevices.length,
      sub: t("inBranch", { branch: branchName }),
    },
  ];

  const today =
    can(ctx.roles, "calendar:view") && ctx.activeBranch
      ? await withActor(actorOf(ctx), async (tx) => {
          const [from, to] = dayRange(riyadhDay(new Date()));
          const rows = await tx
            .select({ status: appointments.status, n: count() })
            .from(appointments)
            .where(
              and(
                eq(appointments.branchId, ctx.activeBranch!.id),
                gte(appointments.startsAt, from),
                lt(appointments.startsAt, to),
              ),
            )
            .groupBy(appointments.status);
          const pending = can(ctx.roles, "requests:decide")
            ? (await pendingRequests(tx)).length
            : 0;
          return {
            byStatus: Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<
              string,
              number
            >,
            pendingRequests: pending,
          };
        })
      : null;
  const ts = await getTranslations("statuses");
  const tn = await getTranslations("nav");
  const tc = await getTranslations("calendar");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">
          {t("welcome", { name: pick(locale, ctx.user.name, ctx.user.nameEn) })}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("today")}: {formatGregorian(now, locale, "full")} · {formatHijri(now, locale)}
        </p>
      </div>

      {today && (
        <Card data-testid="today-card">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>
              {t("today")} · {t("inBranch", { branch: branchName })}
            </CardTitle>
            <div className="flex gap-2">
              {can(ctx.roles, "my_day:view") && (
                <Link href="/my-day" className={buttonVariants({ size: "sm" })}>
                  {tn("myDay")}
                </Link>
              )}
              <Link href="/calendar" className={buttonVariants({ size: "sm", variant: "outline" })}>
                {tn("calendar")}
              </Link>
              {today.pendingRequests > 0 && (
                <Link
                  href="/requests"
                  className={buttonVariants({ size: "sm", variant: "outline" })}
                >
                  {tn("requests")} ({today.pendingRequests})
                </Link>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {APPOINTMENT_STATUSES.filter((s) => today.byStatus[s]).map((s) => (
              <StatusBadge
                key={s}
                status={s}
                label={`${ts(s)}: ${today.byStatus[s]}`}
                className="text-sm"
              />
            ))}
            {Object.keys(today.byStatus).length === 0 && (
              <span className="text-muted-foreground text-sm">{tc("empty")}</span>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <div className="text-muted-foreground text-sm">{s.label}</div>
              <div className="text-brand text-3xl font-bold">{s.value}</div>
              {s.sub && <div className="text-muted-foreground text-xs">{s.sub}</div>}
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("departments")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {data.depts.map((d) => (
              <div key={d.id} className="flex items-center justify-between">
                <span>{pick(locale, d.nameAr, d.nameEn)}</span>
                <Badge variant={d.isActive ? "default" : "secondary"}>
                  {d.isActive ? t("active") : t("inactive")}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              {t("devices")} · {branchName}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {data.branchDevices.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2">
                <span>{pick(locale, d.nameAr, d.nameEn)}</span>
                <Badge variant="outline">{tDevices(d.deviceType)}</Badge>
              </div>
            ))}
            {data.branchRooms.length > 0 && (
              <p className="text-muted-foreground pt-2 text-sm">
                {t("rooms")}:{" "}
                {data.branchRooms.map((r) => pick(locale, r.nameAr, r.nameEn)).join("، ")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
