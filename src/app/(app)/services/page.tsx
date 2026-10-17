import { asc, eq } from "drizzle-orm";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
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
import { requirePermission } from "@/lib/auth/session";
import { pick } from "@/lib/brand";
import { formatSAR } from "@/lib/format";
import type { Locale } from "@/i18n/config";

export default async function ServicesPage() {
  const ctx = await requirePermission("services:read");
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("services");
  const tDevices = await getTranslations("deviceTypes");

  const rows = await withTenant(ctx.tenant.id, (tx) =>
    tx
      .select({ service: services, department: departments })
      .from(services)
      .innerJoin(departments, eq(departments.id, services.departmentId))
      .orderBy(asc(services.sortOrder), asc(services.code)),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <span className="text-muted-foreground text-sm">{t("count", { count: rows.length })}</span>
      </div>
      <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("demoPrices")}</p>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("name")}</TableHead>
                <TableHead>{t("department")}</TableHead>
                <TableHead>{t("duration")}</TableHead>
                <TableHead>{t("buffer")}</TableHead>
                <TableHead>{t("price")}</TableHead>
                <TableHead>{t("device")}</TableHead>
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
                  <TableCell className="whitespace-nowrap">
                    {pick(locale, d.nameAr, d.nameEn)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {t("minutes", { count: s.durationMinutes })}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {t("minutes", { count: s.bufferMinutes })}
                  </TableCell>
                  <TableCell className="font-semibold whitespace-nowrap">
                    {formatSAR(s.priceHalalas, locale)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {s.requiredDeviceType ? tDevices(s.requiredDeviceType) : t("none")}
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
