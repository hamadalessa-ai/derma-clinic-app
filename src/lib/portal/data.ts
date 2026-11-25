/**
 * Everything the patient page (/my) shows. Patient data is read AS THE PATIENT (role "patient"
 * + app.patient_id), so the database itself limits it to their own and their family's rows.
 * Clinical notes are never loaded here (and the database would refuse them anyway).
 */
import { and, asc, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import {
  appointments,
  branches,
  consentTemplates,
  dentalPlanItems,
  patientConsents,
  patientMemberships,
  patientPackages,
  patients,
  services,
  tenantMembers,
  users,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { getSettings } from "@/lib/booking/engine";
import { riyadhDay } from "@/lib/booking/time";
import { MOVABLE_STATUSES } from "@/lib/booking/status";
import { canOfferSelfCheckIn } from "@/lib/visits/self-check-in";
import { consentStatusFor } from "@/lib/consents/consents";
import { reasonView, type ConsentReasonView } from "@/lib/consents/rules";
import { videoToken } from "@/lib/video/link";
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
        whatsappOptInAt: patients.whatsappOptInAt,
        whatsappOptedOutAt: patients.whatsappOptedOutAt,
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
        selfCheckedInAt: appointments.selfCheckedInAt,
        serviceAr: services.nameAr,
        serviceEn: services.nameEn,
        onlineBookable: services.onlineBookable,
        isVirtual: services.isVirtual,
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

    // The dental treatment plan still to do = the estimate (procedure, tooth, price). Never the
    // chart: that is clinical (the database hides it from patients).
    const dentalPlan = await tx
      .select({
        id: dentalPlanItems.id,
        patientId: dentalPlanItems.patientId,
        tooth: dentalPlanItems.tooth,
        nameAr: dentalPlanItems.nameAr,
        nameEn: dentalPlanItems.nameEn,
        priceHalalas: dentalPlanItems.priceHalalas,
      })
      .from(dentalPlanItems)
      .where(eq(dentalPlanItems.status, "planned"))
      .orderBy(asc(dentalPlanItems.createdAt));

    // Memberships still running (or starting soon): plan, dates, included visits, discount.
    const memberships = await tx
      .select({
        id: patientMemberships.id,
        patientId: patientMemberships.patientId,
        nameAr: patientMemberships.nameAr,
        nameEn: patientMemberships.nameEn,
        endsOn: patientMemberships.endsOn,
        includedVisits: patientMemberships.includedVisits,
        discountPercent: patientMemberships.discountPercent,
      })
      .from(patientMemberships)
      .where(
        and(isNull(patientMemberships.cancelledAt), gte(patientMemberships.endsOn, riyadhDay(now))),
      )
      .orderBy(asc(patientMemberships.endsOn));

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
      reason: ConsentReasonView;
    }[] = [];
    for (const a of upcoming) {
      const c = status.get(a.id);
      if (!c || c.signed) continue;
      if (
        pendingConsents.some((p) => p.patientId === a.patientId && p.template.id === c.templateId)
      )
        continue;
      const template = templates.find((t) => t.id === c.templateId);
      if (template) {
        pendingConsents.push({
          patientId: a.patientId,
          appointmentId: a.id,
          template,
          reason: reasonView(c),
        });
      }
    }
    return { settings, family, appts, packages, signed, pendingConsents, dentalPlan, memberships };
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
  const selfSettings = {
    enabled: data.settings.selfCheckInEnabled,
    beforeMinutes: data.settings.selfCheckInBeforeMinutes,
    afterMinutes: data.settings.selfCheckInAfterMinutes,
  };
  // A visit that started a few minutes ago stays "today's visit" while it can still be checked in
  // (or is under way), not "past".
  const stillCurrent = (a: (typeof data.appts)[number]) =>
    a.startsAt > now ||
    (a.startsAt.getTime() > now.getTime() - selfSettings.afterMinutes * 60_000 &&
      ["booked", "confirmed", "arrived", "in_session"].includes(a.status));
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
    /** Today, inside the self check-in window: show "I've arrived". */
    canArrive: canOfferSelfCheckIn(a, a.isVirtual, selfSettings, now),
    /** Checked in (at the desk or by themselves) and waiting / under way. */
    checkedIn: a.status === "arrived" || a.status === "in_session",
    /** Video consultation: the same join page as the WhatsApp link. */
    videoPath:
      a.isVirtual && ["booked", "confirmed", "arrived", "in_session"].includes(a.status)
        ? `/visit/${videoToken(tenantId, a.id)}`
        : null,
  });
  return {
    me: data.family.find((p) => p.id === patientId) ?? null,
    family: data.family,
    upcoming: data.appts
      .filter((a) => stillCurrent(a) && a.status !== "cancelled" && a.status !== "no_show")
      .map(view),
    past: data.appts
      .filter((a) => !stillCurrent(a) || a.status === "cancelled" || a.status === "no_show")
      .reverse()
      .slice(0, 20)
      .map(view),
    packages: data.packages.map((p) => ({
      ...p,
      remaining: p.total - p.used,
      expiresAt: p.expiresAt.toISOString(),
    })),
    dentalPlan: data.dentalPlan,
    memberships: data.memberships,
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
      reason: p.reason,
    })),
    cancellationWindowHours: data.settings.cancellationWindowHours,
    horizonDays: data.settings.onlineHorizonDays,
  };
}

export type PortalData = Awaited<ReturnType<typeof loadPortal>>;
