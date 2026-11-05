import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { and, desc, eq } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { clinicalNotes, patients } from "@/db/schema";
import { withActor } from "@/lib/auth/db";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { pick } from "@/lib/brand";
import { formatDualDate } from "@/lib/format";
import type { Locale } from "@/i18n/config";

/** Practitioners only (also enforced by the database). Drafts waiting to be signed + recent notes. */
export default async function ClinicalNotesPage() {
  const ctx = await requirePermission("clinical_notes:read");
  const locale = (await getLocale()) as Locale;
  const tn = await getTranslations("notes");
  const tnav = await getTranslations("nav");
  const rows = await withActor(actorOf(ctx), (tx) =>
    tx
      .select({ note: clinicalNotes, patient: patients })
      .from(clinicalNotes)
      .innerJoin(patients, eq(patients.id, clinicalNotes.patientId))
      .where(and(eq(clinicalNotes.authorUserId, ctx.user.id)))
      .orderBy(desc(clinicalNotes.updatedAt))
      .limit(50),
  );
  const drafts = rows.filter((r) => r.note.status === "draft");
  const signed = rows.filter((r) => r.note.status === "signed").slice(0, 15);
  const item = (r: (typeof rows)[number]) => (
    <li key={r.note.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
      <Link
        href={
          r.note.status === "draft" && r.note.appointmentId
            ? `/visits/${r.note.appointmentId}`
            : `/patients/${r.patient.id}?tab=notes`
        }
        className="hover:text-brand-strong font-medium hover:underline"
      >
        {pick(locale, r.patient.fullNameAr, r.patient.fullNameEn)}{" "}
        <span className="text-muted-foreground text-xs" dir="ltr">
          {r.patient.fileNumber}
        </span>
      </Link>
      <span className="text-muted-foreground flex items-center gap-2 text-xs">
        {formatDualDate(r.note.updatedAt, locale, "medium").split(" · ")[0]}
        <Badge variant={r.note.status === "signed" ? "default" : "outline"}>
          {r.note.status === "signed" ? tn("signed") : tn("draft")}
        </Badge>
      </span>
    </li>
  );
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader title={tnav("clinicalNotes")} />
      <Card>
        <CardHeader>
          <CardTitle>{tn("myDrafts")}</CardTitle>
        </CardHeader>
        <CardContent>
          {drafts.length ? (
            <ul className="divide-y">{drafts.map(item)}</ul>
          ) : (
            <p className="text-muted-foreground text-sm">{tn("noDrafts")}</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{tn("recent")}</CardTitle>
        </CardHeader>
        <CardContent>
          {signed.length ? (
            <ul className="divide-y">{signed.map(item)}</ul>
          ) : (
            <p className="text-muted-foreground text-sm">{tn("empty")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
