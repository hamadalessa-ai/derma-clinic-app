import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Search, UserPlus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertBadge } from "@/components/clinic/badges";
import { withActor } from "@/lib/auth/db";
import { can } from "@/lib/auth/permissions";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { pick } from "@/lib/brand";
import { formatGregorian } from "@/lib/format";
import { getPatientAlerts, searchPatients } from "@/lib/patients/queries";
import type { Locale } from "@/i18n/config";

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const ctx = await requirePermission("patients:read");
  const { q = "" } = await searchParams;
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("patients");
  const tx2 = await getTranslations("patientsX");
  const tc = await getTranslations("calendar");

  // RLS guarantees these are only this clinic's patients.
  const { rows, alerts } = await withActor(actorOf(ctx), async (tx) => {
    const rows = await searchPatients(tx, q, 500);
    return {
      rows,
      alerts: await getPatientAlerts(
        tx,
        rows.map((r) => r.id),
      ),
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("title")}
        subtitle={t("count", { count: rows.length })}
        actions={
          can(ctx.roles, "patients:edit") && (
            <Link href="/patients/new" className={buttonVariants({ size: "sm" })}>
              <UserPlus />
              {tx2("new")}
            </Link>
          )
        }
      />
      <form className="relative max-w-xl" role="search">
        <Search className="text-muted-foreground pointer-events-none absolute start-3 top-3 size-4" />
        <Input
          name="q"
          defaultValue={q}
          placeholder={tx2("searchPlaceholder")}
          className="ps-9"
          aria-label={tx2("searchPlaceholder")}
        />
      </form>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("fileNumber")}</TableHead>
                <TableHead>{t("name")}</TableHead>
                <TableHead>{t("phone")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("gender")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("dateOfBirth")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.fileNumber}</TableCell>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      <Link href={`/patients/${p.id}`} className="hover:text-brand hover:underline">
                        {pick(locale, p.fullNameAr, p.fullNameEn)}
                      </Link>
                      <AlertBadge alerts={alerts.get(p.id)} label={tc("allergy")} compact />
                    </span>
                  </TableCell>
                  <TableCell>
                    <span dir="ltr">{p.phone}</span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{t(p.gender)}</TableCell>
                  <TableCell className="hidden whitespace-nowrap sm:table-cell">
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
