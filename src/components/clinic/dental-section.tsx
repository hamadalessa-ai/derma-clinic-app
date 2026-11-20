import { getLocale, getTranslations } from "next-intl/server";
import { and, asc, eq, isNull } from "drizzle-orm";
import { FlaskConical } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { departments, labCases, services, tenantMembers, users } from "@/db/schema";
import type { Locale } from "@/i18n/config";
import { withActor, type Actor } from "@/lib/auth/db";
import { can } from "@/lib/auth/permissions";
import { riyadhDay } from "@/lib/booking/time";
import { pick } from "@/lib/brand";
import { chartHistory } from "@/lib/dental/chart";
import { isOverdue, listLabCases, nextLabStatuses } from "@/lib/dental/lab";
import { planFor } from "@/lib/dental/plan";
import { DentalPlan } from "./dental-plan";
import { LabCaseList, NewLabCase } from "./lab-cases";
import { ToothChart } from "./tooth-chart";

/**
 * Dental for one patient: the chart (doctors and nurses only), the treatment plan and lab work.
 * On the patient file, and on a dental visit's screen (then "Done in this visit" and the lab
 * form know the visit). Callers show it only when the clinic has dental (dentalEnabled).
 */
export async function DentalSection({
  actor,
  patientId,
  appointmentId,
  visitOpen,
  practitionerId,
}: {
  actor: Actor;
  patientId: string;
  /** Visit screen: this visit. */
  appointmentId?: string;
  /** The visit is still open (orders and codes can be added). */
  visitOpen?: boolean;
  /** The visit's dentist (default for lab work). */
  practitionerId?: string;
}) {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("dental");
  const clinical = can(actor.roles, "dental:chart");
  const today = riyadhDay(new Date());
  const data = await withActor(actor, async (tx) => {
    const [chart, plan, cases, dentalServices, dentists, labs] = await Promise.all([
      clinical ? chartHistory(tx, actor, patientId) : Promise.resolve([]),
      planFor(tx, patientId),
      can(actor.roles, "lab:view") ? listLabCases(tx, actor, { patientId }) : Promise.resolve([]),
      tx
        .select({
          id: services.id,
          nameAr: services.nameAr,
          nameEn: services.nameEn,
          priceHalalas: services.priceHalalas,
        })
        .from(services)
        .innerJoin(departments, eq(departments.id, services.departmentId))
        .where(and(eq(departments.code, "dental"), eq(services.isActive, true)))
        .orderBy(asc(services.sortOrder)),
      tx
        .select({
          id: tenantMembers.id,
          nameAr: users.name,
          nameEn: users.nameEn,
          roles: tenantMembers.roles,
        })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .where(isNull(tenantMembers.deactivatedAt)),
      tx.selectDistinct({ name: labCases.labName }).from(labCases).limit(20),
    ]);
    return { chart, plan, cases, dentalServices, dentists, labs };
  });
  const doctors = data.dentists
    .filter((d) => d.roles.includes("practitioner"))
    .map(({ id, nameAr, nameEn }) => ({ id, nameAr, nameEn }));
  const editPlan = can(actor.roles, "dental:plan");

  return (
    <div className="flex flex-col gap-4" data-testid="dental-section">
      {clinical && (
        <ToothChart
          patientId={patientId}
          editable
          appointmentId={appointmentId ?? null}
          entries={data.chart.map((e) => ({
            id: e.id,
            tooth: e.tooth,
            condition: e.condition,
            surfaces: e.surfaces,
            note: e.note,
            createdAt: e.createdAt.toISOString(),
            recordedByName: e.recordedByName,
          }))}
        />
      )}
      <DentalPlan
        patientId={patientId}
        canEdit={editPlan}
        appointmentId={visitOpen ? appointmentId : null}
        services={data.dentalServices}
        items={data.plan.map((i) => ({
          id: i.id,
          tooth: i.tooth,
          surfaces: i.surfaces,
          code: i.code,
          nameAr: i.nameAr,
          nameEn: i.nameEn,
          priceHalalas: i.priceHalalas,
          status: i.status,
          doneAt: i.doneAt?.toISOString() ?? null,
        }))}
      />
      {can(actor.roles, "lab:view") && (
        <Card data-testid="lab-section">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FlaskConical className="text-brand-strong size-4" />
              {t("lab")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <LabCaseList
              showPatient={false}
              canWhatsApp={false}
              cases={data.cases.map((r) => ({
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
              }))}
            />
            {can(actor.roles, "lab:manage") && doctors.length > 0 && (
              <NewLabCase
                patientId={patientId}
                doctors={doctors}
                defaultDoctorId={practitionerId ?? null}
                appointmentId={appointmentId ?? null}
                labs={data.labs.map((l) => l.name)}
                today={today}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
