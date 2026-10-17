import { asc } from "drizzle-orm";
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
import { patients } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { pick } from "@/lib/brand";
import { formatGregorian } from "@/lib/format";
import type { Locale } from "@/i18n/config";

export default async function PatientsPage() {
  const ctx = await requirePermission("patients:read");
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("patients");

  // RLS guarantees these are only this clinic's patients.
  const rows = await withTenant(ctx.tenant.id, (tx) =>
    tx.select().from(patients).orderBy(asc(patients.fileNumber)),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <span className="text-muted-foreground text-sm">{t("count", { count: rows.length })}</span>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("fileNumber")}</TableHead>
                <TableHead>{t("name")}</TableHead>
                <TableHead>{t("phone")}</TableHead>
                <TableHead>{t("gender")}</TableHead>
                <TableHead>{t("dateOfBirth")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.fileNumber}</TableCell>
                  <TableCell className="font-medium">
                    {pick(locale, p.fullNameAr, p.fullNameEn)}
                  </TableCell>
                  <TableCell>
                    <span dir="ltr">{p.phone}</span>
                  </TableCell>
                  <TableCell>{t(p.gender)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {p.dateOfBirth
                      ? formatGregorian(new Date(`${p.dateOfBirth}T12:00:00Z`), locale, "medium")
                      : ""}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground py-8 text-center">
                    {t("empty")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
