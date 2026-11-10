import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { withTenant } from "@/db/tenant";
import { departments, services } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { ServiceOnlineToggle } from "@/components/clinic/online-settings";
import { pick } from "@/lib/brand";
import { formatSAR } from "@/lib/format";
import type { Locale } from "@/i18n/config";

export default async function ServicesPage() {
  const ctx = await requirePermission("services:read");
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("services");
  const tDevices = await getTranslations("deviceTypes");
  const canEdit = can(ctx.roles, "settings:manage");

  const rows = await withTenant(ctx.tenant.id, (tx) =>
    tx
      .select({ service: services, department: departments })
      .from(services)
      .innerJoin(departments, eq(departments.id, services.departmentId))
      // Only what the clinic offers (inactive departments and services stay hidden).
      .where(and(eq(services.isActive, true), eq(departments.isActive, true)))
      .orderBy(asc(services.sortOrder), asc(services.code)),
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("title")}
        subtitle={`${t("count", { count: rows.length })}${canEdit ? ` · ${t("onlineHint")}` : ""}`}
      />
      <Notice tone="warning">{t("demoPrices")}</Notice>
      {can(ctx.roles, "setup:manage") && (
        <Notice tone="info">
          <Link href="/setup?tab=services" className="underline" data-testid="setup-link">
            {t("editInSetup")}
          </Link>
        </Notice>
      )}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("name")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("department")}</TableHead>
                <TableHead>{t("duration")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("buffer")}</TableHead>
                <TableHead>{t("price")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("device")}</TableHead>
                <TableHead>{t("online")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ service: s, department: d }) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">
                    {pick(locale, s.nameAr, s.nameEn)}
                    {locale === "ar" && (
                      <div className="text-muted-foreground text-xs" dir="ltr">
                        {s.nameEn}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap sm:table-cell">
                    {pick(locale, d.nameAr, d.nameEn)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {t("minutes", { count: s.durationMinutes })}
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap sm:table-cell">
                    {t("minutes", { count: s.bufferMinutes })}
                  </TableCell>
                  <TableCell className="font-semibold whitespace-nowrap">
                    {formatSAR(s.priceHalalas, locale)}
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap sm:table-cell">
                    {s.requiredDeviceType ? tDevices(s.requiredDeviceType) : t("none")}
                  </TableCell>
                  <TableCell>
                    {canEdit ? (
                      <ServiceOnlineToggle
                        serviceId={s.id}
                        initial={s.onlineBookable}
                        label={t("online")}
                      />
                    ) : s.onlineBookable ? (
                      t("yes")
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
