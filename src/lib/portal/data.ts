/**
 * Everything the patient page (/my) shows. Patient data is read AS THE PATIENT (role "patient"
 * + app.patient_id), so the database itself limits it to their own and their family's rows.
 * Clinical notes are never loaded here (and the database would refuse them anyway).
 */
import { asc, desc, eq, inArray } from "drizzle-orm";
import {
  appointments,
  branches,
  consentTemplates,
  patientConsents,
  patientPackages,
  patients,
  services,
  tenantMembers,
  users,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { getSettings } from "@/lib/booking/engine";
import { MOVABLE_STATUSES } from "@/lib/booking/status";
import { consentStatusFor } from "@/lib/consents/consents";
import { patientDbContext } from "./session";

export async function loadPortal(tenantId: string, patientId: string, now = new Date()) {
  const data = await withTenant(patientDbContext(tenantId, patientId), async (tx) => {
    const settings = await getSettings(tx);
    const family = await tx
      .select({
        id: patients.id,
        fileNumber: patients.fileNumber,
        nameAr: patients.fullNameAr,
        nameEn: patients.fullNameEn,
        guardianId: patients.guardianId,
      })
      .from(patients)
      .orderBy(asc(patients.fileNumber));
    const appts = await tx
      .select({
        id: appointments.id,
        patientId: appointments.patientId,
        serviceId: appointments.serviceId,
        practitionerId: appointments.practitionerId,
        branchId: appointments.branchId,
        startsAt: appointments.startsAt,
        status: appointments.status,
        source: appointments.source,
        serviceAr: services.nameAr,
        serviceEn: services.nameEn,
        onlineBookable: services.onlineBookable,
        branchAr: branches.nameAr,
        branchEn: branches.nameEn,
      })
      .from(appointments)
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .innerJoin(branches, eq(branches.id, appointments.branchId))
      .orderBy(asc(appointments.startsAt));
    const packages = await tx
      .select({
        id: patientPackages.id,
        patientId: patientPackages.patientId,
        nameAr: patientPackages.nameAr,
        nameEn: patientPackages.nameEn,
        total: patientPackages.sessionsTotal,
        used: patientPackages.sessionsUsed,
        expiresAt: patientPackages.expiresAt,
      })
      .from(patientPackages)
      .orderBy(desc(patientPackages.purchasedAt));
    const signed = await tx
      .select({
        id: patientConsents.id,
        patientId: patientConsents.patientId,
        titleAr: patientConsents.titleAr,
        titleEn: patientConsents.titleEn,
        version: patientConsents.templateVersion,
        signedAt: patientConsents.signedAt,
        signedVia: patientConsents.signedVia,
      })
      .from(patientConsents)
      .orderBy(desc(patientConsents.signedAt));

    const upcoming = appts.filter(
      (a) => a.startsAt > now && (MOVABLE_STATUSES as readonly string[]).includes(a.status),
    );
    const status = await consentStatusFor(tx, upcoming);
    const neededIds = [
      ...new Set([...status.values()].filter((c) => !c.signed).map((c) => c.templateId)),
    ];
    const templates = neededIds.length
      ? await tx.select().from(consentTemplates).where(inArray(consentTemplates.id, neededIds))
      : [];
    // One entry per (person, consent): the first upcoming appointment that needs it.
    const pendingConsents: {
      patientId: string;
      appointmentId: string;
      template: (typeof templates)[number];
    }[] = [];
    for (const a of upcoming) {
      const c = status.get(a.id);
      if (!c || c.signed) continue;
      if (
        pendingConsents.some((p) => p.patientId === a.patientId && p.template.id === c.templateId)
      )
        continue;
      const template = templates.find((t) => t.id === c.templateId);
      if (template) pendingConsents.push({ patientId: a.patientId, appointmentId: a.id, template });
    }
    return { settings, family, appts, packages, signed, pendingConsents };
  });

  // Doctors' names are public (they're on the booking page too); patients can't read staff logins.
  const doctorIds = [...new Set(data.appts.map((a) => a.practitionerId))];
  const doctors = doctorIds.length
    ? await withTenant(tenantId, (tx) =>
        tx
          .select({ id: tenantMembers.id, nameAr: users.name, nameEn: users.nameEn })
          .from(tenantMembers)
          .innerJoin(users, eq(users.id, tenantMembers.userId))
          .where(inArray(tenantMembers.id, doctorIds)),
      )
    : [];

  const windowMs = data.settings.cancellationWindowHours * 3600_000;
  const view = (a: (typeof data.appts)[number]) => ({
    id: a.id,
    patientId: a.patientId,
    startsAt: a.startsAt.toISOString(),
    status: a.status,
    serviceId: a.serviceId,
    serviceAr: a.serviceAr,
    serviceEn: a.serviceEn,
    branchId: a.branchId,
    branchAr: a.branchAr,
    branchEn: a.branchEn,
    practitionerId: a.practitionerId,
    doctorAr: doctors.find((d) => d.id === a.practitionerId)?.nameAr ?? "",
    doctorEn: doctors.find((d) => d.id === a.practitionerId)?.nameEn ?? null,
    /** Patients may cancel/reschedule online until the window before the visit. */
    canChange:
      (MOVABLE_STATUSES as readonly string[]).includes(a.status) &&
      a.startsAt.getTime() - now.getTime() >= windowMs,
    canReschedule: data.settings.onlineBookingEnabled && a.onlineBookable,
  });
  return {
    me: data.family.find((p) => p.id === patientId) ?? null,
    family: data.family,
    upcoming: data.appts
      .filter((a) => a.startsAt > now && a.status !== "cancelled" && a.status !== "no_show")
      .map(view),
    past: data.appts
      .filter((a) => a.startsAt <= now || a.status === "cancelled" || a.status === "no_show")
      .reverse()
      .slice(0, 20)
      .map(view),
    packages: data.packages.map((p) => ({
      ...p,
      remaining: p.total - p.used,
      expiresAt: p.expiresAt.toISOString(),
    })),
    signed: data.signed.map((c) => ({ ...c, signedAt: c.signedAt.toISOString() })),
    pendingConsents: data.pendingConsents.map((p) => ({
      patientId: p.patientId,
      appointmentId: p.appointmentId,
      templateId: p.template.id,
      titleAr: p.template.titleAr,
      titleEn: p.template.titleEn,
      bodyAr: p.template.bodyAr,
      bodyEn: p.template.bodyEn,
      version: p.template.version,
    })),
    cancellationWindowHours: data.settings.cancellationWindowHours,
    horizonDays: data.settings.onlineHorizonDays,
  };
}

export type PortalData = Awaited<ReturnType<typeof loadPortal>>;
