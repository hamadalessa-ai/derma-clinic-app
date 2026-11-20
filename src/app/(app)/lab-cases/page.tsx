import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { LabCaseList } from "@/components/clinic/lab-cases";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import type { Locale } from "@/i18n/config";
import { withActor } from "@/lib/auth/db";
import { can } from "@/lib/auth/permissions";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { riyadhDay } from "@/lib/booking/time";
import { pick } from "@/lib/brand";
import { dentalEnabled } from "@/lib/dental/chart";
import { isOverdue, listLabCases, nextLabStatuses } from "@/lib/dental/lab";

/** Lab cases across the clinic: what is still at the lab (overdue first), or everything. */
export default async function LabCasesPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const ctx = await requirePermission("lab:view");
  const sp = await searchParams;
  const all = sp.all === "1";
  const actor = actorOf(ctx);
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("dental");
  const today = riyadhDay(new Date());
  const rows = await withActor(actor, async (tx) =>
    (await dentalEnabled(tx)) ? listLabCases(tx, actor, { open: !all }) : null,
  );
  if (!rows) notFound();
  const cases = rows
    .map((r) => ({
      id: r.c.id,
      patientId: r.c.patientId,
      patientName: pick(locale, r.patientAr, r.patientEn),
      fileNumber: r.fileNumber,
      phone: r.phone,
      doctorName: pick(locale, r.doctorAr, r.doctorEn),
      labName: r.c.labName,
      work: r.c.work,
      teeth: r.c.teeth,
      shade: r.c.shade,
      sentOn: r.c.sentOn,
      dueOn: r.c.dueOn,
      status: r.c.status,
      overdue: isOverdue(r.c, today),
      next: [...nextLabStatuses(r.c.status)],
    }))
    // Overdue first, then by due day.
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.dueOn.localeCompare(b.dueOn));
  const tab = (on: boolean) => buttonVariants({ size: "sm", variant: on ? "default" : "outline" });

  return (
    <div className="flex flex-col gap-4" data-testid="lab-cases-page">
      <PageHeader title={t("labTitle")} subtitle={t("labSubtitle")} />
      <div className="flex gap-2">
        <Link href="/lab-cases" className={tab(!all)}>
          {t("labOpen")}
        </Link>
        <Link href="/lab-cases?all=1" className={tab(all)}>
          {t("labAll")}
        </Link>
      </div>
      <Card>
        <CardContent className="pt-4 md:pt-5">
          <LabCaseList cases={cases} showPatient canWhatsApp={can(ctx.roles, "whatsapp:inbox")} />
        </CardContent>
      </Card>
    </div>
  );
}
