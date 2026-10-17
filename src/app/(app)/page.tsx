import { count, eq, inArray } from "drizzle-orm";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { withTenant } from "@/db/tenant";
import { departments, devices, patients, rooms, services, tenantMembers } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { pick } from "@/lib/brand";
import { formatGregorian, formatHijri } from "@/lib/format";
import type { Locale } from "@/i18n/config";

export default async function DashboardPage() {
  const ctx = await requirePermission("dashboard:view");
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("dashboard");
  const tDevices = await getTranslations("deviceTypes");
  const branchId = ctx.activeBranch?.id;
  const showClinicData = can(ctx.role, "patients:read");

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
