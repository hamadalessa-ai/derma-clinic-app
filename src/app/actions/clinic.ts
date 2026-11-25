"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { conversations, messages, patientMedicalFlags, patients } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withTenant } from "@/db/tenant";
import { withActor } from "@/lib/auth/db";
import {
  blockTime,
  bookAppointment,
  changeStatus,
  getAppointment,
  findFreeSlots,
  moveAppointment,
  removeTimeBlock,
  rescheduleOptions,
} from "@/lib/booking/engine";
import { doctorNames } from "@/lib/booking/doctor-names";
import { can, type Role } from "@/lib/auth/permissions";
import { APPOINTMENT_STATUSES } from "@/lib/booking/status";
import { atRiyadh, riyadhTime } from "@/lib/booking/time";
import { saveConsentRule, saveTemplateVersion, signConsent } from "@/lib/consents/consents";
import { CONSENT_RULES, type SiteContent } from "@/db/schema";
import { refreshDemoWeek } from "@/lib/demo/refresh";
import { addAddendum, correctNote, openDraft, saveDraft, signNote } from "@/lib/notes/notes";
import { anthropicClient } from "@/lib/ai/claude";
import { scribeDraft } from "@/lib/ai/scribe";
import { videoProvider } from "@/lib/video/provider";
import { doctorJoin, VideoVisitError } from "@/lib/video/visit";
import {
  addHoursException,
  removeHoursException,
  saveWeeklyHours,
} from "@/lib/booking/working-hours";
import { addLabReport, cancelRequest, requestRepeat, voidLabReport } from "@/lib/labs/labs";
import {
  cancelMembership,
  recordMembershipPayment,
  renewMembership,
  sellMembership,
} from "@/lib/memberships/memberships";
import { overrideSessions, recordPayment, sellPackage } from "@/lib/packages/packages";
import { nextFileNumber, searchPatients } from "@/lib/patients/queries";
import { notifyLater, sendTestPush } from "@/lib/push/notify";
import { normalizeSaudiMobile } from "@/lib/phone";
import {
  runScheduledNow,
  sendTestMessage,
  updateServiceTexts,
  updateTemplate,
} from "@/lib/whatsapp/admin";
import { TEMPLATE_KINDS } from "@/lib/whatsapp/catalog";
import { whatsappMode } from "@/lib/whatsapp/config";
import { handleInbound } from "@/lib/whatsapp/inbound";
import { whatsappLater } from "@/lib/whatsapp/later";
import {
  addConcernNote,
  askForPhoto,
  bookFollowUpRequest,
  followUpConcern,
  replyToConcern,
  resolveConcern,
} from "@/lib/whatsapp/concern-actions";
import {
  createPatientFromConversation,
  doctorRunningLate,
  linkConversation,
  markDemoThreadRead,
  markHandled,
  setAiPaused,
  setWhatsappConsent,
  staffReply,
} from "@/lib/whatsapp/staff";
import {
  sendBookingConfirmation,
  sendLabReady,
  sendVisitInstructions,
} from "@/lib/whatsapp/outbox";
import { checkOut } from "@/lib/visits/checkout";
import { deskSearch, walkIn } from "@/lib/front-desk/desk";
import { recordTeeth, recordTooth } from "@/lib/dental/chart";
import { voidPhoto } from "@/lib/photos/photos";
import { addPlanItem, cancelPlanItem, markPlanDone } from "@/lib/dental/plan";
import { createLabCase, LAB_STATUSES, LAB_WORK, setLabStatus } from "@/lib/dental/lab";
import { TOOTH_CONDITIONS } from "@/lib/dental/teeth";
import { removeSubscription, savePrefs, saveSubscription } from "@/lib/push/subscriptions";
import { saveSiteContent, setMemberGender, setServiceOnline, updateSettings } from "@/lib/settings";
import { checkIn } from "@/lib/visits/check-in";
import { createClinic, clinicAddress, SLUG_RULE } from "@/lib/platform/clinics";
import { SPECIALTIES } from "@/lib/platform/templates";
import { setClinicLimits, setClinicStatus } from "@/lib/platform/status";
import { planAllows, PLAN_TIERS } from "@/lib/platform/plans";
import { endSupport, grantSupport, SUPPORT_HOURS } from "@/lib/support/grants";
import { checkImport, MAX_IMPORT_BYTES, runImport } from "@/lib/patients/import";
import { setClinicWhatsApp, testClinicWhatsApp } from "@/lib/platform/whatsapp";
import { setCareTeam } from "@/lib/care-team/care-team";
import {
  createConsentForm,
  saveBillingItem,
  saveBranch,
  saveDepartment,
  saveDevice,
  saveMembershipPlan,
  savePackage,
  saveRoom,
  saveService,
} from "@/lib/setup/admin";
import {
  issueStatement,
  recordStatementPayment,
  setClinicPlan,
  voidStatement,
} from "@/lib/platform/billing";
import { CLINIC_STATUSES } from "@/lib/tenant/status";
import { addMember, inviteInfo, linkWebsiteDoctor, setActive, updateMember } from "@/lib/team/team";
import { inviteToken } from "@/lib/team/invite";
import {
  addCharge,
  addOrder,
  postVisit,
  readyForDoctor,
  removeCharge,
  removeOrder,
  signAndComplete,
  startVisit,
} from "@/lib/visits/visit";
import { decideRequest, doctorReschedule } from "@/lib/visits/reschedule";
import { parse, staffAction, ValidationError, PAUSED_OK } from "@/lib/actions";

const uuid = z.uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^\d{2}:\d{2}$/);
const text = (max: number) => z.string().trim().max(max);

function refreshScreens() {
  for (const p of ["/calendar", "/my-day", "/patients", "/requests", "/"])
    revalidatePath(p, "layout");
}

// ─── Patients ───────────────────────────────────────────────────────────────

export async function searchPatientsAction(query: string) {
  return staffAction(
    ["calendar:view", "patients:read"],
    async (_ctx, actor) => {
      const q = parse(text(100), query);
      const rows = await withActor(actor, (tx) => searchPatients(tx, q, 12));
      return rows.map((p) => ({
        id: p.id,
        fileNumber: p.fileNumber,
        nameAr: p.fullNameAr,
        nameEn: p.fullNameEn,
        phone: p.phone,
      }));
    },
    PAUSED_OK,
  );
}

const newPatient = z.object({
  fullNameAr: text(120).min(3),
  fullNameEn: text(120).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^05\d{8}$/),
  gender: z.enum(["male", "female"]),
  dateOfBirth: day.optional().or(z.literal("")),
  idType: z.enum(["national_id", "iqama", "passport"]).optional(),
  idNumber: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z]{6,15}$/)
    .optional()
    .or(z.literal("")),
  guardianFile: text(20).optional(),
  guardianRelationAr: text(40).optional(),
});

export async function createPatientAction(input: z.input<typeof newPatient>) {
  return staffAction("patients:edit", async (ctx, actor) => {
    const v = parse(newPatient, input);
    const prefix = ctx.tenant.slug.charAt(0).toUpperCase();
    return withActor(actor, async (tx) => {
      const fileNumber = await nextFileNumber(tx, prefix);
      let guardianId: string | null = null;
      if (v.guardianFile) {
        const [g] = await tx
          .select({ id: patients.id })
          .from(patients)
          .where(eq(patients.fileNumber, v.guardianFile.toUpperCase()));
        if (!g) throw new ValidationError("guardian not found");
        guardianId = g.id;
      }
      const [p] = await tx
        .insert(patients)
        .values({
          tenantId: actor.tenantId,
          fileNumber,
          fullNameAr: v.fullNameAr,
          fullNameEn: v.fullNameEn || null,
          phone: v.phone,
          gender: v.gender,
          dateOfBirth: v.dateOfBirth || null,
          idType: v.idType ?? null,
          idNumber: v.idNumber || null,
          guardianId,
          guardianRelationAr: guardianId ? v.guardianRelationAr || null : null,
          isFake: true,
        })
        .returning();
      await audit(tx, {
        actorUserId: actor.userId,
        action: "patient.create",
        entityType: "patient",
        entityId: p.id,
      });
      return { id: p.id };
    });
  });
}

export async function addMedicalFlagAction(input: {
  patientId: string;
  kind: string;
  label: string;
}) {
  return staffAction(["patients:edit", "notes:write"], async (_ctx, actor) => {
    const v = parse(
      z.object({
        patientId: uuid,
        kind: z.enum(["allergy", "contraindication", "medication"]),
        label: text(200).min(2),
      }),
      input,
    );
    await withActor(actor, async (tx) => {
      const [f] = await tx
        .insert(patientMedicalFlags)
        .values({
          tenantId: actor.tenantId,
          patientId: v.patientId,
          kind: v.kind,
          label: v.label,
          createdBy: actor.userId,
        })
        .returning();
      await audit(tx, {
        actorUserId: actor.userId,
        action: "patient.alert_add",
        entityType: "patient",
        entityId: v.patientId,
        metadata: { flagId: f.id, kind: v.kind },
      });
    });
    revalidatePath(`/patients/${v.patientId}`);
    return null;
  });
}

export async function removeMedicalFlagAction(input: { patientId: string; flagId: string }) {
  return staffAction(["patients:edit", "notes:write"], async (_ctx, actor) => {
    const v = parse(z.object({ patientId: uuid, flagId: uuid }), input);
    await withActor(actor, async (tx) => {
      await tx.delete(patientMedicalFlags).where(eq(patientMedicalFlags.id, v.flagId));
      await audit(tx, {
        actorUserId: actor.userId,
        action: "patient.alert_remove",
        entityType: "patient",
        entityId: v.patientId,
        metadata: { flagId: v.flagId },
      });
    });
    revalidatePath(`/patients/${v.patientId}`);
    return null;
  });
}

// ─── Booking ────────────────────────────────────────────────────────────────

const booking = z.object({
  branchId: uuid,
  patientId: uuid,
  serviceId: uuid,
  practitionerId: uuid,
  day,
  time,
  note: text(500).optional(),
});

export async function bookAction(input: z.input<typeof booking>) {
  return staffAction("appointments:manage", async (ctx, actor) => {
    const v = parse(booking, input);
    const a = await withActor(actor, (tx) =>
      bookAppointment(tx, actor, {
        branchId: v.branchId,
        patientId: v.patientId,
        serviceId: v.serviceId,
        practitionerId: v.practitionerId,
        startsAt: atRiyadh(v.day, v.time),
        receptionNote: v.note,
      }),
    );
    refreshScreens();
    notifyLater(actor.tenantId, [
      { type: "new_booking", appointmentId: a.id, actorUserId: actor.userId },
    ]);
    whatsappLater(() => sendBookingConfirmation(ctx.tenant, a.id));
    return { id: a.id };
  });
}

export async function freeSlotsAction(input: {
  branchId: string;
  serviceId: string;
  practitionerId?: string;
  day: string;
  time?: string;
  limit?: number;
}) {
  return staffAction(
    ["appointments:manage", "appointments:own"],
    async (_ctx, actor) => {
      const v = parse(
        z.object({
          branchId: uuid,
          serviceId: uuid,
          practitionerId: uuid.optional(),
          day,
          time: time.optional(),
          limit: z.number().int().min(1).max(12).optional(),
        }),
        input,
      );
      const from = new Date(Math.max(atRiyadh(v.day, v.time ?? "00:00").getTime(), Date.now()));
      const slots = await withActor(actor, (tx) =>
        findFreeSlots(tx, {
          branchId: v.branchId,
          serviceId: v.serviceId,
          practitionerId: v.practitionerId,
          from,
          limit: v.limit ?? 6,
        }),
      );
      return slots.map((s) => ({
        startsAt: s.startsAt.toISOString(),
        practitionerId: s.practitionerId,
      }));
    },
    PAUSED_OK,
  );
}

export async function moveAction(input: {
  appointmentId: string;
  day: string;
  time: string;
  practitionerId?: string;
}) {
  return staffAction("appointments:manage", async (_ctx, actor) => {
    const v = parse(
      z.object({ appointmentId: uuid, day, time, practitionerId: uuid.optional() }),
      input,
    );
    await withActor(actor, (tx) =>
      moveAppointment(tx, actor, v.appointmentId, {
        startsAt: atRiyadh(v.day, v.time),
        practitionerId: v.practitionerId,
      }),
    );
    refreshScreens();
    notifyLater(actor.tenantId, [
      { type: "rescheduled", appointmentId: v.appointmentId, actorUserId: actor.userId },
    ]);
    return null;
  });
}

export async function statusAction(input: { appointmentId: string; to: string; reason?: string }) {
  return staffAction(["appointments:manage", "appointments:own"], async (ctx, actor) => {
    const v = parse(
      z.object({
        appointmentId: uuid,
        to: z.enum(APPOINTMENT_STATUSES),
        reason: text(300).optional(),
      }),
      input,
    );
    const before = await withActor(actor, async (tx) => {
      const prev = await getAppointment(tx, v.appointmentId);
      await changeStatus(tx, actor, v.appointmentId, v.to, { reason: v.reason });
      return prev.status;
    });
    refreshScreens();
    // An approved online request: now the patient gets the booking confirmation.
    if (before === "pending" && v.to === "confirmed") {
      whatsappLater(() => sendBookingConfirmation(ctx.tenant, v.appointmentId));
    }
    if (v.to === "cancelled") {
      notifyLater(actor.tenantId, [
        { type: "cancelled", appointmentId: v.appointmentId, actorUserId: actor.userId },
      ]);
    }
    return null;
  });
}

export async function checkInAction(appointmentId: string) {
  return staffAction("appointments:manage", async (_ctx, actor) => {
    const id = parse(uuid, appointmentId);
    const r = await withActor(actor, (tx) => checkIn(tx, actor, id));
    refreshScreens();
    if (r.status === "checked_in") {
      notifyLater(actor.tenantId, [
        { type: "checked_in", appointmentId: id, actorUserId: actor.userId },
      ]);
    }
    if (r.status === "consent_required") {
      const t = r.template;
      return {
        status: r.status,
        template: {
          id: t.id,
          code: t.code,
          version: t.version,
          titleAr: t.titleAr,
          titleEn: t.titleEn,
          bodyAr: t.bodyAr,
          bodyEn: t.bodyEn,
        },
      };
    }
    return r;
  });
}

export async function blockTimeAction(input: {
  branchId: string;
  memberId: string;
  day: string;
  from: string;
  to: string;
  reason?: string;
}) {
  return staffAction(["appointments:manage", "appointments:own"], async (_ctx, actor) => {
    const v = parse(
      z.object({
        branchId: uuid,
        memberId: uuid,
        day,
        from: time,
        to: time,
        reason: text(200).optional(),
      }),
      input,
    );
    await withActor(actor, (tx) =>
      blockTime(tx, actor, {
        branchId: v.branchId,
        memberId: v.memberId,
        startsAt: atRiyadh(v.day, v.from),
        endsAt: atRiyadh(v.day, v.to),
        reason: v.reason,
      }),
    );
    refreshScreens();
    return null;
  });
}

export async function removeBlockAction(blockId: string) {
  return staffAction(["appointments:manage", "appointments:own"], async (_ctx, actor) => {
    await withActor(actor, (tx) => removeTimeBlock(tx, actor, parse(uuid, blockId)));
    refreshScreens();
    return null;
  });
}

export async function doctorRescheduleAction(input: {
  appointmentId: string;
  day: string;
  time: string;
  reason?: string;
}) {
  return staffAction("appointments:own", async (_ctx, actor) => {
    const v = parse(
      z.object({ appointmentId: uuid, day, time, reason: text(300).optional() }),
      input,
    );
    const r = await withActor(actor, (tx) =>
      doctorReschedule(tx, actor, {
        appointmentId: v.appointmentId,
        startsAt: atRiyadh(v.day, v.time),
        reason: v.reason,
      }),
    );
    refreshScreens();
    if (r.mode === "requested") {
      notifyLater(actor.tenantId, [
        { type: "reschedule_request", appointmentId: v.appointmentId, actorUserId: actor.userId },
      ]);
    }
    return { mode: r.mode };
  });
}

export async function decideRequestAction(input: {
  requestId: string;
  approve: boolean;
  note?: string;
}) {
  return staffAction("requests:decide", async (_ctx, actor) => {
    const v = parse(
      z.object({ requestId: uuid, approve: z.boolean(), note: text(300).optional() }),
      input,
    );
    const decided = await withActor(actor, (tx) => decideRequest(tx, actor, v));
    refreshScreens();
    notifyLater(actor.tenantId, [
      {
        type: "request_answered",
        appointmentId: decided.appointmentId,
        actorUserId: actor.userId,
      },
    ]);
    return null;
  });
}

// ─── Packages ───────────────────────────────────────────────────────────────

const method = z.enum(["cash", "card", "transfer"]);
const sar = z.number().positive().max(1_000_000);

export async function sellPackageAction(input: {
  patientId: string;
  templateId: string;
  paySar?: number;
  method?: string;
}) {
  return staffAction("packages:sell", async (_ctx, actor) => {
    const v = parse(
      z.object({
        patientId: uuid,
        templateId: uuid,
        paySar: sar.optional(),
        method: method.optional(),
      }),
      input,
    );
    await withActor(actor, (tx) =>
      sellPackage(tx, actor, {
        patientId: v.patientId,
        templateId: v.templateId,
        payment: v.paySar
          ? { amountHalalas: Math.round(v.paySar * 100), method: v.method ?? "card" }
          : undefined,
      }),
    );
    revalidatePath(`/patients/${v.patientId}`);
    return null;
  });
}

// ─── Memberships ────────────────────────────────────────────────────────────

const memberPayment = z
  .object({ paySar: sar, method, invoiceNumber: z.string().trim().max(60).nullish() })
  .nullish();
const toPayment = (p: z.infer<typeof memberPayment>) =>
  p && p.paySar > 0
    ? {
        amountHalalas: Math.round(p.paySar * 100),
        method: p.method,
        invoiceNumber: p.invoiceNumber,
      }
    : null;
function membershipsChanged(patientId: string) {
  revalidatePath(`/patients/${patientId}`);
  revalidatePath("/memberships");
}

export async function sellMembershipAction(input: unknown) {
  return staffAction("memberships:sell", async (_ctx, actor) => {
    const v = parse(z.object({ patientId: uuid, planId: uuid, payment: memberPayment }), input);
    const row = await withActor(actor, (tx) =>
      sellMembership(tx, actor, {
        patientId: v.patientId,
        planId: v.planId,
        payment: toPayment(v.payment),
      }),
    );
    membershipsChanged(v.patientId);
    return { id: row.id };
  });
}

export async function renewMembershipAction(input: unknown) {
  return staffAction("memberships:sell", async (_ctx, actor) => {
    const v = parse(z.object({ membershipId: uuid, payment: memberPayment }), input);
    const row = await withActor(actor, (tx) =>
      renewMembership(tx, actor, { membershipId: v.membershipId, payment: toPayment(v.payment) }),
    );
    membershipsChanged(row.patientId);
    return { id: row.id };
  });
}

export async function membershipPaymentAction(input: unknown) {
  return staffAction("memberships:sell", async (_ctx, actor) => {
    const v = parse(
      z.object({
        membershipId: uuid,
        patientId: uuid,
        paySar: sar,
        method,
        invoiceNumber: z.string().trim().max(60).nullish(),
      }),
      input,
    );
    await withActor(actor, (tx) =>
      recordMembershipPayment(tx, actor, {
        membershipId: v.membershipId,
        amountHalalas: Math.round(v.paySar * 100),
        method: v.method,
        invoiceNumber: v.invoiceNumber,
      }),
    );
    membershipsChanged(v.patientId);
    return null;
  });
}

export async function cancelMembershipAction(input: unknown) {
  return staffAction("memberships:sell", async (_ctx, actor) => {
    const v = parse(z.object({ membershipId: uuid }), input);
    const row = await withActor(actor, (tx) => cancelMembership(tx, actor, v.membershipId));
    membershipsChanged(row.patientId);
    return null;
  });
}

export async function saveMembershipPlanAction(input: unknown) {
  return staffAction("setup:manage", async (_ctx, actor) => {
    const v = parse(
      z.object({
        id: optId,
        nameAr: label(),
        nameEn: label(),
        priceSar: z.number().min(0).max(1_000_000),
        periodMonths: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
        includedServiceId: uuid.nullish(),
        includedVisits: z.number().int().min(0).max(100),
        discountPercent: z.number().int().min(0).max(50),
        isActive: z.boolean(),
      }),
      input,
    );
    const { priceSar, ...rest } = v;
    const row = await withActor(actor, (tx) =>
      saveMembershipPlan(tx, actor, { ...rest, priceHalalas: sarToHalalas(priceSar) }),
    );
    setupDone();
    return { id: row.id };
  });
}

export async function recordPaymentAction(input: {
  patientId: string;
  packageId: string;
  sar: number;
  method: string;
}) {
  return staffAction("packages:sell", async (_ctx, actor) => {
    const v = parse(z.object({ patientId: uuid, packageId: uuid, sar, method }), input);
    await withActor(actor, (tx) =>
      recordPayment(tx, actor, {
        patientPackageId: v.packageId,
        amountHalalas: Math.round(v.sar * 100),
        method: v.method,
      }),
    );
    revalidatePath(`/patients/${v.patientId}`);
    return null;
  });
}

export async function overrideSessionsAction(input: {
  patientId: string;
  packageId: string;
  delta: number;
  reason: string;
}) {
  return staffAction("packages:override", async (_ctx, actor) => {
    const v = parse(
      z.object({
        patientId: uuid,
        packageId: uuid,
        delta: z.union([z.literal(1), z.literal(-1)]),
        reason: z.string().max(300),
      }),
      input,
    );
    await withActor(actor, (tx) =>
      overrideSessions(tx, actor, {
        patientPackageId: v.packageId,
        delta: v.delta,
        reason: v.reason,
      }),
    );
    revalidatePath(`/patients/${v.patientId}`);
    return null;
  });
}

// ─── Consents ───────────────────────────────────────────────────────────────

const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;

export async function signConsentAction(input: {
  patientId: string;
  templateId: string;
  signerName: string;
  signerRelation: "self" | "guardian";
  signatureDataUrl: string;
  appointmentId?: string | null;
}) {
  return staffAction("consents:collect", async (_ctx, actor) => {
    const v = parse(
      z.object({
        patientId: uuid,
        templateId: uuid,
        signerName: text(120),
        signerRelation: z.enum(["self", "guardian"]),
        signatureDataUrl: z.string().max(3_000_000).regex(PNG_DATA_URL),
        appointmentId: uuid.nullish(),
      }),
      input,
    );
    const png = Buffer.from(v.signatureDataUrl.match(PNG_DATA_URL)![1], "base64");
    const userAgent = (await headers()).get("user-agent");
    const c = await withActor(actor, (tx) =>
      signConsent(tx, actor, {
        patientId: v.patientId,
        templateId: v.templateId,
        signerName: v.signerName,
        signerRelation: v.signerRelation,
        signaturePng: png,
        appointmentId: v.appointmentId ?? null,
        userAgent,
      }),
    );
    revalidatePath(`/patients/${v.patientId}`);
    return { id: c.id };
  });
}

export async function saveTemplateAction(input: {
  code: string;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
}) {
  return staffAction("consents:templates", async (_ctx, actor) => {
    const v = parse(
      z.object({
        code: z.string().regex(/^[a-z_]{2,40}$/),
        titleAr: text(200),
        titleEn: text(200),
        bodyAr: text(20000),
        bodyEn: text(20000),
      }),
      input,
    );
    const t = await withActor(actor, (tx) => saveTemplateVersion(tx, actor, v.code, v));
    revalidatePath("/settings", "layout");
    return { version: t.version };
  });
}

/** Admin: when a consent needs a new signature (every visit, per package, N months, new text). */
export async function saveConsentRuleAction(input: {
  code: string;
  rule: string;
  months?: number | null;
}) {
  return staffAction("consents:templates", async (_ctx, actor) => {
    const v = parse(
      z.object({
        code: z.string().regex(/^[a-z_]{2,40}$/),
        rule: z.enum(CONSENT_RULES),
        months: z.coerce.number().int().min(1).max(120).nullish(),
      }),
      input,
    );
    await withActor(actor, (tx) =>
      saveConsentRule(tx, actor, { code: v.code, rule: v.rule, months: v.months ?? null }),
    );
    revalidatePath("/settings", "layout");
    return null;
  });
}

// ─── Notes ──────────────────────────────────────────────────────────────────

export async function openDraftAction(input: { patientId: string; appointmentId?: string | null }) {
  return staffAction("notes:write", async (_ctx, actor) => {
    const v = parse(z.object({ patientId: uuid, appointmentId: uuid.nullish() }), input);
    const n = await withActor(actor, (tx) => openDraft(tx, actor, v));
    revalidatePath(`/patients/${v.patientId}`);
    return { id: n.id };
  });
}

export async function saveDraftAction(input: { patientId: string; noteId: string; body: string }) {
  return staffAction("notes:write", async (_ctx, actor) => {
    const v = parse(
      z.object({ patientId: uuid, noteId: uuid, body: z.string().max(20000) }),
      input,
    );
    await withActor(actor, (tx) => saveDraft(tx, actor, v.noteId, v.body));
    revalidatePath(`/patients/${v.patientId}`);
    return null;
  });
}

export async function signNoteAction(input: {
  patientId: string;
  noteId: string;
  body: string;
  aiReviewed?: boolean;
}) {
  return staffAction("notes:write", async (_ctx, actor) => {
    const v = parse(
      z.object({
        patientId: uuid,
        noteId: uuid,
        body: z.string().max(20000),
        aiReviewed: z.boolean().optional(),
      }),
      input,
    );
    await withActor(actor, (tx) => signNote(tx, actor, v.noteId, v.body, v.aiReviewed ?? false));
    revalidatePath(`/patients/${v.patientId}`);
    revalidatePath("/clinical-notes");
    return null;
  });
}

/** The doctor starts the visit: patient → "with the doctor", the visit's note draft ready. */
export async function startVisitAction(input: { appointmentId: string }) {
  return staffAction("notes:write", async (_ctx, actor) => {
    const v = parse(z.object({ appointmentId: uuid }), input);
    const r = await withActor(actor, (tx) => startVisit(tx, actor, v.appointmentId));
    refreshScreens();
    revalidatePath(`/visits/${v.appointmentId}`);
    return r;
  });
}

/** "Sign & complete": the visit's note is signed and the visit completed, together. */
export async function signAndCompleteAction(input: {
  appointmentId: string;
  noteId: string;
  body: string;
  aiReviewed?: boolean;
}) {
  return staffAction("notes:write", async (_ctx, actor) => {
    const v = parse(
      z.object({
        appointmentId: uuid,
        noteId: uuid,
        body: z.string().max(20000),
        aiReviewed: z.boolean().optional(),
      }),
      input,
    );
    const r = await withActor(actor, (tx) => signAndComplete(tx, actor, v));
    refreshScreens();
    revalidatePath("/clinical-notes");
    revalidatePath(`/visits/${v.appointmentId}`);
    return r;
  });
}

// ─── Visit: orders, invoice codes, Post visit ───────────────────────────────

function visitChanged(appointmentId: string) {
  refreshScreens();
  revalidatePath(`/visits/${appointmentId}`);
}

export async function postVisitAction(input: {
  appointmentId: string;
  noteId: string;
  body: string;
  aiReviewed?: boolean;
}) {
  return staffAction("notes:write", async (_ctx, actor) => {
    const v = parse(
      z.object({
        appointmentId: uuid,
        noteId: uuid,
        body: z.string().max(20000),
        aiReviewed: z.boolean().optional(),
      }),
      input,
    );
    const r = await withActor(actor, (tx) => postVisit(tx, actor, v));
    visitChanged(v.appointmentId);
    revalidatePath("/clinical-notes");
    if (r.completed) {
      notifyLater(actor.tenantId, [
        { type: "ready_for_checkout", appointmentId: v.appointmentId, actorUserId: actor.userId },
      ]);
    }
    return r;
  });
}

/** Nurse / assistant: the patient is prepared — tell the doctor ("ready for doctor"). */
export async function readyForDoctorAction(appointmentId: string) {
  return staffAction("visits:assist", async (_ctx, actor) => {
    const id = parse(uuid, appointmentId);
    const r = await withActor(actor, (tx) => readyForDoctor(tx, actor, id));
    visitChanged(id);
    if (r.changed) {
      notifyLater(actor.tenantId, [
        { type: "doctor_needed", appointmentId: id, actorUserId: actor.userId },
      ]);
    }
    return r;
  });
}

export async function addVisitChargeAction(input: {
  appointmentId: string;
  serviceId?: string | null;
  billingItemId?: string | null;
  quantity: number;
}) {
  return staffAction("notes:write", async (_ctx, actor) => {
    const v = parse(
      z
        .object({
          appointmentId: uuid,
          serviceId: uuid.nullish(),
          billingItemId: uuid.nullish(),
          quantity: z.number().int().min(1).max(1000),
        })
        .refine((x) => !!x.serviceId !== !!x.billingItemId),
      input,
    );
    await withActor(actor, (tx) => addCharge(tx, actor, v));
    visitChanged(v.appointmentId);
    return null;
  });
}

export async function removeVisitChargeAction(input: { appointmentId: string; chargeId: string }) {
  return staffAction("notes:write", async (_ctx, actor) => {
    const v = parse(z.object({ appointmentId: uuid, chargeId: uuid }), input);
    await withActor(actor, (tx) => removeCharge(tx, actor, v));
    visitChanged(v.appointmentId);
    return null;
  });
}

export async function addVisitOrderAction(input: unknown) {
  return staffAction("notes:write", async (_ctx, actor) => {
    const opt = (n: number) => z.string().trim().max(n).nullish();
    const v = parse(
      z.object({
        appointmentId: uuid,
        kind: z.enum(["medication", "treatment"]),
        name: z.string().trim().min(1).max(200),
        dose: opt(200),
        frequency: opt(200),
        duration: opt(200),
        sessions: z.number().int().min(1).max(50).nullish(),
        intervalWeeks: z.number().int().min(1).max(104).nullish(),
        serviceId: uuid.nullish(),
        instructions: opt(1000),
      }),
      input,
    );
    await withActor(actor, (tx) => addOrder(tx, actor, v));
    visitChanged(v.appointmentId);
    return null;
  });
}

export async function removeVisitOrderAction(input: { appointmentId: string; orderId: string }) {
  return staffAction("notes:write", async (_ctx, actor) => {
    const v = parse(z.object({ appointmentId: uuid, orderId: uuid }), input);
    await withActor(actor, (tx) => removeOrder(tx, actor, v));
    visitChanged(v.appointmentId);
    return null;
  });
}

/** AI scribe: the doctor's spoken notes → an English draft in their own draft note. */
export async function scribeDraftAction(input: {
  patientId: string;
  noteId: string;
  transcript: string;
}) {
  return staffAction("notes:write", async (_ctx, actor) => {
    const v = parse(
      z.object({ patientId: uuid, noteId: uuid, transcript: z.string().max(20000) }),
      input,
    );
    const r = await scribeDraft(actor, v, { client: anthropicClient() });
    revalidatePath(`/patients/${v.patientId}`);
    revalidatePath("/clinical-notes");
    return r;
  });
}

// ─── Working hours ──────────────────────────────────────────────────────────

const clock = z.string().regex(/^\d{2}:\d{2}$/);

function refreshHours() {
  refreshScreens();
  revalidatePath("/working-hours");
}

/** Replaces a doctor's weekly hours. Returns upcoming appointments now outside the hours. */
export async function saveWeeklyHoursAction(input: {
  memberId: string;
  shifts: { weekday: number; branchId: string; start: string; end: string }[];
}) {
  return staffAction("hours:edit", async (_ctx, actor) => {
    const v = parse(
      z.object({
        memberId: uuid,
        shifts: z
          .array(
            z.object({
              weekday: z.number().int().min(0).max(6),
              branchId: uuid,
              start: clock,
              end: clock,
            }),
          )
          .max(42),
      }),
      input,
    );
    const r = await withActor(actor, (tx) => saveWeeklyHours(tx, actor, v));
    refreshHours();
    return r;
  });
}

/** A one-off change for one date: day off, or special hours (also an extra working day). */
export async function addHoursExceptionAction(input: {
  memberId: string;
  day: string;
  kind: "off" | "hours";
  branchId?: string | null;
  start?: string | null;
  end?: string | null;
  note?: string | null;
}) {
  return staffAction("hours:edit", async (_ctx, actor) => {
    const v = parse(
      z.object({
        memberId: uuid,
        day,
        kind: z.enum(["off", "hours"]),
        branchId: uuid.nullish(),
        start: clock.nullish(),
        end: clock.nullish(),
        note: text(200).nullish(),
      }),
      input,
    );
    const r = await withActor(actor, (tx) => addHoursException(tx, actor, v));
    refreshHours();
    return r;
  });
}

export async function removeHoursExceptionAction(input: { id: string }) {
  return staffAction("hours:edit", async (_ctx, actor) => {
    const v = parse(z.object({ id: uuid }), input);
    const r = await withActor(actor, (tx) => removeHoursException(tx, actor, v.id));
    refreshHours();
    return r;
  });
}

/** The doctor joins a video consultation: returns a personal link into the video room. */
export async function joinVideoAction(input: { appointmentId: string }) {
  return staffAction("video:join", async (ctx, actor) => {
    const v = parse(z.object({ appointmentId: uuid }), input);
    if (!planAllows(ctx.tenant, "video")) throw new VideoVisitError("not_in_plan");
    return doctorJoin(actor, v.appointmentId, { provider: videoProvider() });
  });
}

/** "Correct note": the author's signed note, within 7 days; the earlier text is kept. */
export async function correctNoteAction(input: { patientId: string; noteId: string; body: string }) {
  return staffAction("notes:write", async (_ctx, actor) => {
    const v = parse(
      z.object({ patientId: uuid, noteId: uuid, body: z.string().max(20000) }),
      input,
    );
    await withActor(actor, (tx) => correctNote(tx, actor, v.noteId, v.body));
    revalidatePath(`/patients/${v.patientId}`);
    return null;
  });
}

export async function addAddendumAction(input: {
  patientId: string;
  noteId: string;
  body: string;
}) {
  return staffAction("notes:write", async (_ctx, actor) => {
    const v = parse(
      z.object({ patientId: uuid, noteId: uuid, body: z.string().max(20000) }),
      input,
    );
    await withActor(actor, (tx) => addAddendum(tx, actor, v.noteId, v.body));
    revalidatePath(`/patients/${v.patientId}`);
    return null;
  });
}

// ─── Settings ───────────────────────────────────────────────────────────────

const settingsInput = z.object({
  doctorsManageOwnSchedule: z.boolean().optional(),
  doctorsEditOwnHours: z.boolean().optional(),
  onlineBookingEnabled: z.boolean().optional(),
  onlineHorizonDays: z.number().int().min(1).max(180).optional(),
  onlineMinNoticeMinutes: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 60)
    .optional(),
  cancellationWindowHours: z
    .number()
    .int()
    .min(0)
    .max(14 * 24)
    .optional(),
  onlineRequiresApproval: z.boolean().optional(),
  showPricesOnline: z.boolean().optional(),
  showServiceInMessages: z.boolean().optional(),
  aiReceptionistEnabled: z.boolean().optional(),
  aiDailyLimit: z.number().int().min(10).max(2000).optional(),
  aiScribeEnabled: z.boolean().optional(),
});

export async function updateSettingsAction(input: z.input<typeof settingsInput>) {
  return staffAction("settings:manage", async (_ctx, actor) => {
    const v = parse(settingsInput, input);
    await withActor(actor, (tx) => updateSettings(tx, actor, v));
    revalidatePath("/settings");
    return null;
  });
}

const siteText = (max: number) => z.string().trim().max(max).optional();
const siteInput = z.object({
  headlineAr: siteText(120),
  headlineEn: siteText(120),
  taglineAr: siteText(300),
  taglineEn: siteText(300),
  aboutAr: siteText(1000),
  aboutEn: siteText(1000),
  since: z.number().int().min(1900).max(2100).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[\d\s-]{6,20}$/)
    .optional(),
  whatsapp: z
    .string()
    .trim()
    .regex(/^\+?[\d\s-]{6,20}$/)
    .optional(),
  instagram: z
    .string()
    .trim()
    .regex(/^@?[\w.]{1,30}$/)
    .optional(),
  licence: siteText(40),
  x: z
    .string()
    .trim()
    .regex(/^@?[\w.]{1,30}$/)
    .optional(),
  tiktok: z
    .string()
    .trim()
    .regex(/^@?[\w.]{1,30}$/)
    .optional(),
  eyebrowAr: siteText(80),
  eyebrowEn: siteText(80),
  footerAr: siteText(200),
  footerEn: siteText(200),
  departments: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(30),
        nameAr: z.string().trim().min(1).max(80),
        nameEn: z.string().trim().min(1).max(80),
        textAr: z.string().trim().max(600).optional(),
        textEn: z.string().trim().max(600).optional(),
        specialties: z.array(z.string().trim().min(1).max(30)).max(8),
      }),
    )
    .max(8)
    .optional(),
  clinicsAr: siteText(1500),
  clinicsEn: siteText(1500),
  doctorsAr: siteText(1500),
  doctorsEn: siteText(1500),
  findAr: siteText(400),
  findEn: siteText(400),
  // Lists kept as they are by the form (edited with the clinic's content): shape-checked only.
  silos: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
  doctors: z.array(z.record(z.string(), z.unknown())).max(80).optional(),
  partners: z.array(z.record(z.string(), z.unknown())).max(60).optional(),
  images: z
    .record(
      z.string().max(40),
      z
        .string()
        .trim()
        .max(500)
        .regex(/^(\/|https:\/\/)/),
    )
    .optional(),
  credentials: z
    .array(
      z.object({ ar: z.string().trim().min(2).max(120), en: z.string().trim().min(2).max(120) }),
    )
    .max(8)
    .optional(),
  specialties: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(30),
        nameAr: z.string().trim().min(1).max(80),
        nameEn: z.string().trim().min(1).max(80),
        textAr: z.string().trim().max(400),
        textEn: z.string().trim().max(400),
        items: z
          .array(z.object({ ar: z.string().trim().max(200), en: z.string().trim().max(200) }))
          .max(20)
          .optional(),
        bookable: z.boolean().optional(),
      }),
    )
    .max(8)
    .optional(),
  reviews: z
    .array(
      z.object({
        quote: z.string().trim().min(3).max(400),
        name: z.string().trim().min(1).max(60),
        treatment: siteText(60),
      }),
    )
    .max(6)
    .optional(),
});

/** Settings → Website: the clinic website's texts, contacts and real reviews. Admins only. */
export async function saveSiteAction(input: z.input<typeof siteInput>) {
  return staffAction("settings:manage", async (_ctx, actor) => {
    const v = parse(siteInput, input);
    // Empty fields are left out, so the website hides them.
    const site = Object.fromEntries(
      Object.entries(v).filter(
        ([, x]) => x !== undefined && x !== "" && !(Array.isArray(x) && !x.length),
      ),
    ) as SiteContent;
    await withActor(actor, (tx) => saveSiteContent(tx, actor, site));
    revalidatePath("/settings");
    revalidatePath("/");
    return null;
  });
}

export async function setServiceOnlineAction(input: { serviceId: string; online: boolean }) {
  return staffAction("settings:manage", async (_ctx, actor) => {
    const v = parse(z.object({ serviceId: uuid, online: z.boolean() }), input);
    const row = await withActor(actor, (tx) => setServiceOnline(tx, actor, v.serviceId, v.online));
    if (!row) throw new ValidationError("service not found");
    revalidatePath("/settings");
    return null;
  });
}

export async function setMemberGenderAction(input: { memberId: string; gender: string }) {
  return staffAction("settings:manage", async (_ctx, actor) => {
    const v = parse(z.object({ memberId: uuid, gender: z.enum(["male", "female", ""]) }), input);
    const row = await withActor(actor, (tx) =>
      setMemberGender(tx, actor, v.memberId, v.gender || null),
    );
    if (!row) throw new ValidationError("member not found");
    revalidatePath("/settings");
    return null;
  });
}

export async function refreshDemoAction() {
  return staffAction("demo:refresh", async (_ctx, actor) => {
    const r = await withActor(actor, (tx) => refreshDemoWeek(tx, actor));
    refreshScreens();
    return r;
  });
}

// ─── My account: phone notifications ────────────────────────────────────────

const subscription = z.object({
  endpoint: z.string().url().max(1000).startsWith("https://"),
  p256dh: z.string().min(20).max(200),
  auth: z.string().min(8).max(100),
  userAgent: z.string().max(300).nullish(),
});

export async function savePushSubscriptionAction(input: z.input<typeof subscription>) {
  return staffAction(
    "account:manage",
    async (_ctx, actor) => {
      const sub = parse(subscription, input);
      // System context: a shared device may still be registered to the previous user.
      await withTenant(actor.tenantId, (tx) =>
        saveSubscription(tx, { tenantId: actor.tenantId, userId: actor.userId, sub }),
      );
      return null;
    },
    PAUSED_OK,
  );
}

export async function removePushSubscriptionAction(input: { endpoint: string }) {
  return staffAction(
    "account:manage",
    async (_ctx, actor) => {
      const v = parse(z.object({ endpoint: z.string().max(1000) }), input);
      await withActor(actor, (tx) => removeSubscription(tx, actor.userId, v.endpoint));
      revalidatePath("/account");
      return null;
    },
    PAUSED_OK,
  );
}

export async function saveNotificationPrefsAction(input: {
  enabled: boolean;
  mutedTypes: string[];
}) {
  return staffAction(
    "account:manage",
    async (_ctx, actor) => {
      const v = parse(
        z.object({ enabled: z.boolean(), mutedTypes: z.array(z.string().max(40)).max(20) }),
        input,
      );
      await withActor(actor, (tx) =>
        savePrefs(tx, { tenantId: actor.tenantId, userId: actor.userId, ...v }),
      );
      revalidatePath("/account");
      return null;
    },
    PAUSED_OK,
  );
}

export async function testPushAction() {
  return staffAction("account:manage", async (_ctx, actor) =>
    sendTestPush(actor.tenantId, actor.userId),
  );
}

// ─── WhatsApp (inbox, simulator, settings) ──────────────────────────────────

const conversationId = z.object({ conversationId: uuid });

export async function whatsappReplyAction(input: { conversationId: string; text: string }) {
  return staffAction("whatsapp:inbox", async (ctx, actor) => {
    const v = parse(conversationId.extend({ text: text(4000).min(1) }), input);
    const r = await staffReply(ctx.tenant, actor, v.conversationId, v.text);
    revalidatePath("/whatsapp", "layout");
    return { outcome: r.outcome, error: r.outcome === "failed" ? r.error : null };
  });
}

export async function whatsappHandledAction(input: { conversationId: string }) {
  return staffAction("whatsapp:inbox", async (_ctx, actor) => {
    const v = parse(conversationId, input);
    await withActor(actor, (tx) => markHandled(tx, actor, v.conversationId));
    revalidatePath("/whatsapp", "layout");
    return null;
  });
}

/** Staff take over a WhatsApp chat (the AI receptionist stays quiet) or let the AI answer again. */
export async function whatsappAiPauseAction(input: { conversationId: string; paused: boolean }) {
  return staffAction("whatsapp:inbox", async (_ctx, actor) => {
    const v = parse(conversationId.extend({ paused: z.boolean() }), input);
    await withActor(actor, (tx) => setAiPaused(tx, actor, v.conversationId, v.paused));
    revalidatePath("/whatsapp", "layout");
    return null;
  });
}

export async function whatsappLinkAction(input: { conversationId: string; patientId: string }) {
  return staffAction("whatsapp:inbox", async (_ctx, actor) => {
    const v = parse(conversationId.extend({ patientId: uuid }), input);
    await withActor(actor, (tx) => linkConversation(tx, actor, v.conversationId, v.patientId));
    revalidatePath("/whatsapp", "layout");
    return null;
  });
}

export async function whatsappCreatePatientAction(input: {
  conversationId: string;
  fullNameAr: string;
  gender: "male" | "female";
}) {
  return staffAction("whatsapp:inbox", async (ctx, actor) => {
    const v = parse(
      conversationId.extend({ fullNameAr: text(120).min(3), gender: z.enum(["male", "female"]) }),
      input,
    );
    const p = await withActor(actor, (tx) =>
      createPatientFromConversation(tx, actor, {
        ...v,
        filePrefix: ctx.tenant.slug.charAt(0).toUpperCase(),
      }),
    );
    revalidatePath("/whatsapp", "layout");
    return { id: p.id, fileNumber: p.fileNumber };
  });
}

export async function whatsappConsentAction(input: {
  patientId: string;
  optIn: boolean;
  language?: "ar" | "en";
}) {
  return staffAction("whatsapp:inbox", async (_ctx, actor) => {
    const v = parse(
      z.object({ patientId: uuid, optIn: z.boolean(), language: z.enum(["ar", "en"]).optional() }),
      input,
    );
    await withActor(actor, (tx) => setWhatsappConsent(tx, actor, v.patientId, v));
    revalidatePath(`/patients/${v.patientId}`);
    return null;
  });
}

export async function runningLateAction(input: { memberId: string; day: string; minutes: number }) {
  return staffAction("appointments:manage", async (ctx, actor) => {
    const v = parse(
      z.object({ memberId: uuid, day, minutes: z.number().int().min(5).max(240) }),
      input,
    );
    return doctorRunningLate(ctx.tenant, actor, v);
  });
}

/** Simulator (demo only): the patient taps a button in a message. Same handler as real WhatsApp. */
export async function simulatorTapAction(input: { messageId: string; buttonIndex: number }) {
  return staffAction("whatsapp:simulator", async (ctx, actor) => {
    const v = parse(
      z.object({ messageId: uuid, buttonIndex: z.number().int().min(0).max(9) }),
      input,
    );
    if (whatsappMode(ctx.tenant) !== "demo") throw new ValidationError("not demo");
    const target = await withActor(actor, async (tx) => {
      const [m] = await tx
        .select({ m: messages, phone: conversations.phone })
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(eq(messages.id, v.messageId));
      return m ?? null;
    });
    const button = target?.m.buttons?.[v.buttonIndex];
    if (!target || !button) throw new ValidationError("no such button");
    await handleInbound(ctx.tenant, [
      {
        type: "message",
        eventId: `sim-${randomUUID()}`,
        from: target.phone,
        kind: "button",
        buttonPayload: button.id,
        buttonTitle: button.title,
      },
    ]);
    refreshScreens();
    revalidatePath("/whatsapp", "layout");
    return null;
  });
}

/** Simulator (demo only): the patient types a message — also from a brand-new number. */
export async function simulatorTypeAction(input: {
  phone: string;
  text: string;
  profileName?: string;
}) {
  return staffAction("whatsapp:simulator", async (ctx) => {
    const v = parse(
      z.object({
        phone: z.string().trim().max(30),
        text: text(1000).min(1),
        profileName: text(60).optional(),
      }),
      input,
    );
    if (whatsappMode(ctx.tenant) !== "demo") throw new ValidationError("not demo");
    const phone = normalizeSaudiMobile(v.phone);
    if (!phone) throw new ValidationError("bad phone");
    await handleInbound(ctx.tenant, [
      {
        type: "message",
        eventId: `sim-${randomUUID()}`,
        from: phone,
        profileName: v.profileName || null,
        kind: "text",
        text: v.text,
      },
    ]);
    revalidatePath("/whatsapp", "layout");
    const convo = await withTenant(ctx.tenant.id, async (tx) => {
      const [c] = await tx.select().from(conversations).where(eq(conversations.phone, phone));
      return c;
    });
    return { conversationId: convo?.id ?? null };
  });
}

/** Simulator (demo only): the patient opened the chat → messages show as read. */
export async function simulatorReadAction(input: { conversationId: string }) {
  return staffAction(
    "whatsapp:simulator",
    async (ctx, actor) => {
      const v = parse(conversationId, input);
      if (whatsappMode(ctx.tenant) !== "demo") return null;
      await withActor(actor, (tx) => markDemoThreadRead(tx, v.conversationId));
      return null;
    },
    PAUSED_OK,
  );
}

export async function runScheduledNowAction(input: {
  fastForward: boolean;
  ignoreQuietHours: boolean;
}) {
  return staffAction("whatsapp:manage", async (ctx, actor) => {
    const v = parse(z.object({ fastForward: z.boolean(), ignoreQuietHours: z.boolean() }), input);
    const summary = await runScheduledNow(ctx.tenant, actor, v);
    if (!summary) throw new ValidationError("not demo");
    revalidatePath("/whatsapp", "layout");
    return summary;
  });
}

export async function updateTemplateAction(input: {
  kind: string;
  enabled: boolean;
  bodyAr: string;
  bodyEn: string;
}) {
  return staffAction("whatsapp:manage", async (_ctx, actor) => {
    const v = parse(
      z.object({
        kind: z.enum(TEMPLATE_KINDS),
        enabled: z.boolean(),
        bodyAr: text(1024),
        bodyEn: text(1024),
      }),
      input,
    );
    await withActor(actor, (tx) => updateTemplate(tx, actor, v));
    revalidatePath("/settings/whatsapp");
    return null;
  });
}

export async function updateServiceTextsAction(input: {
  serviceId: string;
  preVisitAr: string;
  preVisitEn: string;
  postCareAr: string;
  postCareEn: string;
  recallAfterDays: number | null;
}) {
  return staffAction("whatsapp:manage", async (_ctx, actor) => {
    const v = parse(
      z.object({
        serviceId: uuid,
        preVisitAr: text(500),
        preVisitEn: text(500),
        postCareAr: text(500),
        postCareEn: text(500),
        recallAfterDays: z.number().int().min(1).max(730).nullable(),
      }),
      input,
    );
    const row = await withActor(actor, (tx) => updateServiceTexts(tx, actor, v));
    if (!row) throw new ValidationError("service not found");
    revalidatePath("/settings/whatsapp");
    return null;
  });
}

export async function sendTestWhatsappAction(input: { phone: string }) {
  return staffAction("whatsapp:manage", async (ctx, actor) => {
    const v = parse(z.object({ phone: z.string().max(30) }), input);
    const phone = normalizeSaudiMobile(v.phone);
    if (!phone) throw new ValidationError("bad phone");
    const r = await sendTestMessage(ctx.tenant, actor, phone);
    revalidatePath("/settings/whatsapp/status");
    return r.ok ? { ok: true, errorCode: null } : { ok: false, errorCode: r.errorCode };
  });
}

/** Move dialog: free times that day — same doctor first, then (for reception) other doctors. */
export async function rescheduleOptionsAction(input: { appointmentId: string; day: string }) {
  return staffAction(
    ["appointments:manage", "appointments:own"],
    async (ctx, actor) => {
      const v = parse(z.object({ appointmentId: uuid, day }), input);
      return withActor(actor, async (tx) => {
        const r = await rescheduleOptions(tx, v);
        if (!r.ok) return { ok: false as const, reason: r.reason };
        const canChangeDoctor = can(ctx.roles, "appointments:manage");
        const others = canChangeDoctor ? r.otherDoctors : [];
        const names = await doctorNames(tx, [
          r.practitionerId,
          ...others.map((o) => o.practitionerId),
        ]);
        const time = (slots: { startsAt: Date }[]) => slots.map((s) => riyadhTime(s.startsAt));
        return {
          ok: true as const,
          doctor: names.get(r.practitionerId) ?? null,
          sameDoctor: time(r.sameDoctor),
          otherDoctors: others.map((o) => ({
            practitionerId: o.practitionerId,
            doctor: names.get(o.practitionerId) ?? null,
            times: time(o.slots),
          })),
        };
      });
    },
    PAUSED_OK,
  );
}

// ─── Post-care concerns (doctor's Concern card; reception too) ──────────────

const concernId = z.object({ appointmentId: uuid });

function refreshConcern() {
  for (const p of ["/patients", "/my-day", "/whatsapp", "/requests"]) revalidatePath(p, "layout");
}

/** Reply to the patient on WhatsApp, signed with the sender's name (24-hour window). */
export async function concernReplyAction(input: { appointmentId: string; text: string }) {
  return staffAction("concerns:handle", async (ctx, actor) => {
    const v = parse(concernId.extend({ text: text(3500).min(1) }), input);
    await replyToConcern(ctx.tenant, actor, v.appointmentId, v.text);
    refreshConcern();
    return null;
  });
}

/** "Please send a photo of the area" (ready-made wording). */
export async function concernAskPhotoAction(input: { appointmentId: string }) {
  return staffAction("concerns:handle", async (ctx, actor) => {
    const v = parse(concernId, input);
    await askForPhoto(ctx.tenant, actor, v.appointmentId);
    refreshConcern();
    return null;
  });
}

/** Internal note (never sent to the patient); notifies the other side. */
export async function concernNoteAction(input: { appointmentId: string; text: string }) {
  return staffAction("concerns:handle", async (_ctx, actor) => {
    const v = parse(concernId.extend({ text: text(2000).min(1) }), input);
    const push = await withActor(actor, (tx) => addConcernNote(tx, actor, v.appointmentId, v.text));
    notifyLater(actor.tenantId, push);
    refreshConcern();
    return null;
  });
}

export async function concernResolveAction(input: { appointmentId: string; note?: string }) {
  return staffAction("concerns:handle", async (_ctx, actor) => {
    const v = parse(concernId.extend({ note: text(2000).optional() }), input);
    await withActor(actor, (tx) => resolveConcern(tx, actor, v.appointmentId, v.note));
    refreshConcern();
    return null;
  });
}

/** Free times with the treated visit's doctor on a day (for "Book follow-up"). */
export async function concernFollowUpTimesAction(input: {
  appointmentId: string;
  serviceId: string;
  day: string;
}) {
  return staffAction(
    "concerns:handle",
    async (_ctx, actor) => {
      const v = parse(concernId.extend({ serviceId: uuid, day }), input);
      return withActor(actor, async (tx) => {
        const appt = await getAppointment(tx, v.appointmentId);
        const from = new Date(Math.max(atRiyadh(v.day, "00:00").getTime(), Date.now()));
        const until = atRiyadh(v.day, "23:59");
        const slots = await findFreeSlots(tx, {
          branchId: appt.branchId,
          serviceId: v.serviceId,
          practitionerId: appt.practitionerId,
          from,
          days: 1,
          limit: 24,
        });
        return slots
          .filter((s) => s.startsAt <= until)
          .map((s) => ({ startsAt: s.startsAt.toISOString(), time: riyadhTime(s.startsAt) }));
      });
    },
    PAUSED_OK,
  );
}

/**
 * "Book follow-up": booked now (reception/admin, or the doctor when doctors manage their own
 * schedule), otherwise sent to reception as a ready request.
 */
export async function concernFollowUpAction(input: {
  appointmentId: string;
  serviceId: string;
  day: string;
  time: string;
  note?: string;
}) {
  return staffAction("concerns:handle", async (ctx, actor) => {
    const v = parse(
      concernId.extend({ serviceId: uuid, day, time, note: text(1000).optional() }),
      input,
    );
    const r = await withActor(actor, (tx) =>
      followUpConcern(tx, actor, v.appointmentId, {
        serviceId: v.serviceId,
        startsAt: atRiyadh(v.day, v.time),
        note: v.note,
      }),
    );
    if (r.mode === "book") {
      notifyLater(actor.tenantId, [
        { type: "new_booking", appointmentId: r.appointmentId, actorUserId: actor.userId },
      ]);
      whatsappLater(() => sendBookingConfirmation(ctx.tenant, r.appointmentId));
    } else {
      notifyLater(actor.tenantId, r.push);
    }
    refreshScreens();
    refreshConcern();
    return { mode: r.mode };
  });
}

/** Reception books a doctor's follow-up request (suggested time, or another day/time). */
export async function bookFollowUpRequestAction(input: {
  requestId: string;
  day?: string;
  time?: string;
}) {
  return staffAction("appointments:manage", async (ctx, actor) => {
    const v = parse(
      z.object({ requestId: uuid, day: day.optional(), time: time.optional() }),
      input,
    );
    const r = await withActor(actor, (tx) =>
      bookFollowUpRequest(tx, actor, v.requestId, v.day && v.time ? atRiyadh(v.day, v.time) : null),
    );
    if (r.mode === "book") {
      notifyLater(actor.tenantId, [
        { type: "new_booking", appointmentId: r.appointmentId, actorUserId: actor.userId },
      ]);
      whatsappLater(() => sendBookingConfirmation(ctx.tenant, r.appointmentId));
    }
    refreshScreens();
    refreshConcern();
    return null;
  });
}

const IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

/** Simulator (demo only): the patient sends a photo. Same handler as real WhatsApp. */
export async function simulatorPhotoAction(input: {
  phone: string;
  dataUrl: string;
  caption?: string;
}) {
  return staffAction("whatsapp:simulator", async (ctx) => {
    const v = parse(
      z.object({
        phone: z.string().trim().max(30),
        // Shrunk in the browser first (server actions accept up to 1 MB).
        dataUrl: z.string().max(1_000_000).regex(IMAGE_DATA_URL),
        caption: text(500).optional(),
      }),
      input,
    );
    if (whatsappMode(ctx.tenant) !== "demo") throw new ValidationError("not demo");
    const phone = normalizeSaudiMobile(v.phone);
    if (!phone) throw new ValidationError("bad phone");
    const [, mimeType, base64] = v.dataUrl.match(IMAGE_DATA_URL)!;
    await handleInbound(ctx.tenant, [
      {
        type: "message",
        eventId: `sim-${randomUUID()}`,
        from: phone,
        kind: "image",
        text: v.caption ?? "",
        media: { mimeType, dataBase64: base64 },
      },
    ]);
    revalidatePath("/whatsapp", "layout");
    refreshConcern();
    return null;
  });
}

// ─── Settings → Team ────────────────────────────────────────────────────────

const clinicRole = z.enum(["clinic_admin", "practitioner", "receptionist", "assistant"]);
const memberFields = {
  roles: z.array(clinicRole).min(1).max(3),
  branchId: uuid.nullable(),
  gender: z.enum(["male", "female"]).nullable().optional(),
  titleAr: z.string().trim().max(120).nullish(),
  titleEn: z.string().trim().max(120).nullish(),
};
const addMemberInput = z.object({
  ...memberFields,
  nameAr: z.string().trim().min(2).max(120),
  nameEn: z.string().trim().max(120).nullish(),
  email: z.string().trim().toLowerCase().email().max(200),
  websiteDoctor: z.number().int().min(0).max(200).nullish(),
});

/** The address of THIS clinic (the admin is on it), for invitation links. */
async function clinicUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function addTeamMemberAction(input: z.input<typeof addMemberInput>) {
  return staffAction("team:manage", async (_ctx, actor) => {
    const v = parse(addMemberInput, input);
    const r = await withActor(actor, (tx) => addMember(tx, actor, v));
    revalidatePath("/settings");
    revalidatePath("/");
    return {
      inviteUrl: r.needsPassword
        ? `${await clinicUrl()}/invite/${inviteToken(actor.tenantId, r.userId)}`
        : null,
    };
  });
}

export async function updateTeamMemberAction(
  input: { memberId: string } & z.input<z.ZodObject<typeof memberFields>>,
) {
  return staffAction("team:manage", async (_ctx, actor) => {
    const v = parse(z.object({ memberId: uuid, ...memberFields }), input);
    await withActor(actor, (tx) => updateMember(tx, actor, v.memberId, v));
    revalidatePath("/settings");
    return null;
  });
}

export async function setTeamMemberActiveAction(input: { memberId: string; active: boolean }) {
  return staffAction("team:manage", async (_ctx, actor) => {
    const v = parse(z.object({ memberId: uuid, active: z.boolean() }), input);
    await withActor(actor, (tx) => setActive(tx, actor, v.memberId, v.active));
    revalidatePath("/settings");
    revalidatePath("/");
    return null;
  });
}

export async function linkWebsiteDoctorAction(input: {
  memberId: string;
  websiteDoctor: number | null;
}) {
  return staffAction("team:manage", async (_ctx, actor) => {
    const v = parse(
      z.object({ memberId: uuid, websiteDoctor: z.number().int().min(0).max(200).nullable() }),
      input,
    );
    await withActor(actor, (tx) => linkWebsiteDoctor(tx, actor, v.memberId, v.websiteDoctor));
    revalidatePath("/settings");
    revalidatePath("/");
    return null;
  });
}

/** A fresh invitation link for someone who hasn't set a password yet. */
export async function inviteLinkAction(input: { userId: string }) {
  return staffAction("team:manage", async (_ctx, actor) => {
    const v = parse(z.object({ userId: z.string().regex(/^[A-Za-z0-9_-]{4,80}$/) }), input);
    const info = await withActor(actor, (tx) => inviteInfo(tx, v.userId));
    if (!info || info.passwordSet) throw new ValidationError("no open invitation");
    return { inviteUrl: `${await clinicUrl()}/invite/${inviteToken(actor.tenantId, v.userId)}` };
  });
}

// ── Platform owner: add a new clinic ───────────────────────────────────────

const req = (max: number) => z.string().trim().min(1).max(max);
const newClinicInput = z.object({
  slug: z.string().trim().toLowerCase().regex(SLUG_RULE),
  nameAr: req(120),
  nameEn: req(120),
  brandColor: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^#[0-9a-f]{6}$/),
  isDemo: z.boolean(),
  branchNameAr: req(120),
  branchNameEn: req(120),
  cityAr: req(60),
  cityEn: req(60),
  specialty: z.enum(SPECIALTIES).default("blank"),
  departmentAr: z.string().trim().max(80).default(""),
  departmentEn: z.string().trim().max(80).default(""),
  adminNameAr: req(120),
  adminNameEn: z.string().trim().max(120).nullish(),
  adminEmail: z.string().trim().toLowerCase().email().max(200),
});

export async function createClinicAction(input: z.input<typeof newClinicInput>) {
  return staffAction("platform:clinics", async (ctx) => {
    const v = parse(newClinicInput, input);
    const r = await createClinic(
      { userId: ctx.user.id, roles: ctx.roles },
      {
        slug: v.slug,
        nameAr: v.nameAr,
        nameEn: v.nameEn,
        brandColor: v.brandColor,
        isDemo: v.isDemo,
        branch: {
          nameAr: v.branchNameAr,
          nameEn: v.branchNameEn,
          cityAr: v.cityAr,
          cityEn: v.cityEn,
        },
        specialty: v.specialty,
        department: {
          nameAr: v.departmentAr || "العيادة",
          nameEn: v.departmentEn || "Clinic",
        },
        admin: { nameAr: v.adminNameAr, nameEn: v.adminNameEn ?? null, email: v.adminEmail },
      },
    );
    revalidatePath("/platform");
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
    const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
    const address = clinicAddress(r.slug, { host, proto });
    return {
      slug: r.slug,
      address,
      // The invitation only opens on the clinic's own address (it is checked against that clinic).
      inviteUrl:
        address && r.needsPassword
          ? `${address}/invite/${inviteToken(r.tenantId, r.adminUserId)}`
          : null,
      existingUser: !r.needsPassword,
    };
  });
}

export async function setClinicStatusAction(input: {
  tenantId: string;
  status: string;
  reason?: string | null;
}) {
  return staffAction("platform:clinics", async (ctx) => {
    const v = parse(
      z
        .object({
          tenantId: uuid,
          status: z.enum(CLINIC_STATUSES),
          reason: z.string().trim().max(300).nullish(),
        })
        // Pausing a clinic always says why (the clinic sees it); resuming needs no reason.
        .refine((x) => x.status === "active" || !!x.reason),
      input,
    );
    const r = await setClinicStatus(
      { userId: ctx.user.id, roles: ctx.roles },
      v.tenantId,
      v.status,
      v.reason ?? null,
    );
    revalidatePath("/platform");
    return r;
  });
}

export async function setClinicLimitsAction(input: {
  tenantId: string;
  aiMonthly: number | null;
  whatsappMonthly: number | null;
}) {
  return staffAction("platform:clinics", async (ctx) => {
    const limit = z.number().int().min(0).max(10_000_000).nullable();
    const v = parse(z.object({ tenantId: uuid, aiMonthly: limit, whatsappMonthly: limit }), input);
    await setClinicLimits({ userId: ctx.user.id, roles: ctx.roles }, v.tenantId, {
      aiMonthly: v.aiMonthly,
      whatsappMonthly: v.whatsappMonthly,
    });
    revalidatePath("/platform");
    return null;
  });
}

// ── Platform owner: plans and billing (recorded by hand) ───────────────────

const riyals = z.number().min(0).max(10_000_000); // riyals, 2 decimals → halalas
const halalas = (riyals: number) => Math.round(riyals * 100);
const ownerOf = (ctx: { user: { id: string }; roles: Role[] }) => ({
  userId: ctx.user.id,
  roles: ctx.roles,
});

export async function setClinicPlanAction(input: {
  tenantId: string;
  plan: string;
  priceSar: number;
  trialEndsOn: string | null;
  graceDays: number;
}) {
  return staffAction("platform:billing", async (ctx) => {
    const v = parse(
      z.object({
        tenantId: uuid,
        plan: z.enum(PLAN_TIERS),
        priceSar: riyals,
        trialEndsOn: day.nullable(),
        graceDays: z.number().int().min(0).max(90),
      }),
      input,
    );
    await setClinicPlan(ownerOf(ctx), v.tenantId, {
      plan: v.plan,
      priceHalalas: halalas(v.priceSar),
      trialEndsOn: v.trialEndsOn,
      graceDays: v.graceDays,
    });
    revalidatePath("/platform");
    return null;
  });
}

export async function issueStatementAction(input: {
  tenantId: string;
  periodDay?: string;
  amountSar?: number | null;
  dueOn?: string | null;
  note?: string | null;
}) {
  return staffAction("platform:billing", async (ctx) => {
    const v = parse(
      z.object({
        tenantId: uuid,
        periodDay: day.optional(),
        amountSar: riyals.nullish(),
        dueOn: day.nullish(),
        note: z.string().trim().max(300).nullish(),
      }),
      input,
    );
    const r = await issueStatement(ownerOf(ctx), v.tenantId, {
      periodDay: v.periodDay,
      amountHalalas: v.amountSar == null ? undefined : halalas(v.amountSar),
      dueOn: v.dueOn ?? undefined,
      note: v.note ?? null,
    });
    revalidatePath("/platform");
    return { number: r.number };
  });
}

export async function recordStatementPaymentAction(input: {
  tenantId: string;
  statementId: string;
  amountSar: number;
  method: string;
  reference?: string | null;
  receivedOn?: string | null;
}) {
  return staffAction("platform:billing", async (ctx) => {
    const v = parse(
      z.object({
        tenantId: uuid,
        statementId: uuid,
        amountSar: riyals,
        method: z.enum(["transfer", "card", "cash"]),
        reference: z.string().trim().max(120).nullish(),
        receivedOn: day.nullish(),
      }),
      input,
    );
    const r = await recordStatementPayment(ownerOf(ctx), v.tenantId, {
      statementId: v.statementId,
      amountHalalas: halalas(v.amountSar),
      method: v.method,
      reference: v.reference ?? null,
      receivedOn: v.receivedOn ?? undefined,
    });
    revalidatePath("/platform");
    return r;
  });
}

export async function voidStatementAction(input: { tenantId: string; statementId: string }) {
  return staffAction("platform:billing", async (ctx) => {
    const v = parse(z.object({ tenantId: uuid, statementId: uuid }), input);
    const r = await voidStatement(ownerOf(ctx), v.tenantId, v.statementId);
    revalidatePath("/platform");
    return r;
  });
}

// ── Clinic admin: support access for the platform ──────────────────────────

export async function grantSupportAction(input: {
  hours: number;
  allowChanges: boolean;
  reason?: string | null;
}) {
  return staffAction("support:grant", async (_ctx, actor) => {
    const v = parse(
      z.object({
        hours: z
          .number()
          .int()
          .refine((h) => (SUPPORT_HOURS as readonly number[]).includes(h)),
        allowChanges: z.boolean(),
        reason: z.string().trim().max(300).nullish(),
      }),
      input,
    );
    await withActor(actor, (tx) => grantSupport(tx, actor, { ...v, reason: v.reason ?? null }));
    revalidatePath("/settings");
    return null;
  });
}

export async function endSupportAction() {
  return staffAction("support:grant", async (_ctx, actor) => {
    await withActor(actor, (tx) => endSupport(tx, actor));
    revalidatePath("/settings");
    return null;
  });
}

// ── Clinic set-up (clinic admin) ───────────────────────────────────────────

const label = (max = 120) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().max(max).nullish();
const optId = uuid.nullish();
const sarToHalalas = (sar: number) => Math.round(sar * 100);

function setupDone(path = "/setup") {
  revalidatePath(path);
  revalidatePath("/services");
  revalidatePath("/", "layout");
}

export async function saveBranchAction(input: unknown) {
  return staffAction("setup:manage", async (_ctx, actor) => {
    const v = parse(
      z.object({
        id: optId,
        nameAr: label(),
        nameEn: label(),
        cityAr: label(60),
        cityEn: label(60),
        mapUrl: z.string().trim().url().max(500).nullish().or(z.literal("")),
        sortOrder: z.number().int().min(0).max(999).optional(),
      }),
      input,
    );
    const row = await withActor(actor, (tx) =>
      saveBranch(tx, actor, { ...v, mapUrl: v.mapUrl || null }),
    );
    setupDone();
    return { id: row.id };
  });
}

export async function saveDepartmentAction(input: unknown) {
  return staffAction("setup:manage", async (_ctx, actor) => {
    const v = parse(
      z.object({
        id: optId,
        nameAr: label(),
        nameEn: label(),
        isActive: z.boolean(),
        sortOrder: z.number().int().min(0).max(999).optional(),
      }),
      input,
    );
    const row = await withActor(actor, (tx) => saveDepartment(tx, actor, v));
    setupDone();
    return { id: row.id };
  });
}

export async function saveServiceAction(input: unknown) {
  return staffAction("setup:manage", async (_ctx, actor) => {
    const v = parse(
      z.object({
        id: optId,
        departmentId: uuid,
        nameAr: label(),
        nameEn: label(),
        durationMinutes: z.number().int().min(5).max(480),
        bufferMinutes: z.number().int().min(0).max(120),
        priceSar: z.number().min(0).max(1_000_000),
        requiredDeviceType: optText(60),
        consentCode: optText(40),
        onlineBookable: z.boolean(),
        isVirtual: z.boolean(),
        isActive: z.boolean(),
        preVisitAr: optText(2000),
        preVisitEn: optText(2000),
        postCareAr: optText(2000),
        postCareEn: optText(2000),
        recallAfterDays: z.number().int().min(1).max(730).nullish(),
        doctorIds: z.array(uuid).max(200),
      }),
      input,
    );
    const { priceSar, ...rest } = v;
    const row = await withActor(actor, (tx) =>
      saveService(tx, actor, { ...rest, priceHalalas: sarToHalalas(priceSar) }),
    );
    setupDone();
    return { id: row.id };
  });
}

export async function saveRoomAction(input: unknown) {
  return staffAction("setup:manage", async (_ctx, actor) => {
    const v = parse(
      z.object({
        id: optId,
        branchId: uuid,
        nameAr: label(),
        nameEn: label(),
        isVirtual: z.boolean().optional(),
        departmentId: uuid.nullish(),
        isActive: z.boolean(),
      }),
      input,
    );
    const row = await withActor(actor, (tx) => saveRoom(tx, actor, v));
    setupDone();
    return { id: row.id };
  });
}

export async function saveDeviceAction(input: unknown) {
  return staffAction("setup:manage", async (_ctx, actor) => {
    const v = parse(
      z.object({
        id: optId,
        branchId: uuid,
        roomId: optId,
        deviceType: label(60),
        nameAr: label(),
        nameEn: label(),
        isActive: z.boolean(),
      }),
      input,
    );
    const row = await withActor(actor, (tx) => saveDevice(tx, actor, v));
    setupDone();
    return { id: row.id };
  });
}

export async function savePackageAction(input: unknown) {
  return staffAction("setup:manage", async (_ctx, actor) => {
    const v = parse(
      z.object({
        id: optId,
        serviceId: uuid,
        nameAr: label(),
        nameEn: label(),
        sessionsCount: z.number().int().min(1).max(100),
        priceSar: z.number().min(0).max(1_000_000),
        validityDays: z.number().int().min(1).max(3650),
        isActive: z.boolean(),
      }),
      input,
    );
    const { priceSar, ...rest } = v;
    const row = await withActor(actor, (tx) =>
      savePackage(tx, actor, { ...rest, priceHalalas: sarToHalalas(priceSar) }),
    );
    setupDone();
    return { id: row.id };
  });
}

export async function saveBillingItemAction(input: unknown) {
  return staffAction("setup:manage", async (_ctx, actor) => {
    const v = parse(
      z.object({
        id: optId,
        code: z
          .string()
          .trim()
          .min(1)
          .max(30)
          .regex(/^[A-Za-z0-9._-]+$/),
        nameAr: label(),
        nameEn: label(),
        kind: z.enum(["product", "consumable", "procedure", "other"]),
        priceSar: z.number().min(0).max(1_000_000),
        unitAr: z.string().trim().max(40).nullish(),
        unitEn: z.string().trim().max(40).nullish(),
        isActive: z.boolean(),
      }),
      input,
    );
    const { priceSar, ...rest } = v;
    const row = await withActor(actor, (tx) =>
      saveBillingItem(tx, actor, { ...rest, priceHalalas: sarToHalalas(priceSar) }),
    );
    setupDone();
    return { id: row.id };
  });
}

export async function createConsentFormAction(input: unknown) {
  return staffAction("setup:manage", async (_ctx, actor) => {
    const v = parse(
      z.object({
        titleAr: label(200),
        titleEn: label(200),
        bodyAr: z.string().trim().min(1).max(20000),
        bodyEn: z.string().trim().min(1).max(20000),
      }),
      input,
    );
    const row = await withActor(actor, (tx) => createConsentForm(tx, actor, v));
    setupDone();
    revalidatePath("/settings", "layout");
    return { code: row.code };
  });
}

// ── Patient import (clinic admin) ──────────────────────────────────────────

const csvInput = z.object({ csv: z.string().min(1).max(MAX_IMPORT_BYTES) });

export async function checkImportAction(input: { csv: string }) {
  return staffAction(
    "patients:import",
    async (_ctx, actor) => {
      const v = parse(csvInput, input);
      const r = await withActor(actor, (tx) => checkImport(tx, v.csv));
      return {
        ready: r.ok.length,
        withPackage: r.ok.filter((x) => x.package).length,
        problems: r.problems.slice(0, 300),
        problemCount: r.problems.length,
        missingColumns: r.missingColumns,
        total: r.total,
      };
    },
    PAUSED_OK,
  );
}

export async function runImportAction(input: { csv: string }) {
  return staffAction("patients:import", async (ctx, actor) => {
    const v = parse(csvInput, input);
    const r = await withActor(actor, (tx) =>
      runImport(tx, actor, v.csv, {
        filePrefix: ctx.tenant.slug.charAt(0).toUpperCase(),
        isDemo: ctx.tenant.isDemo,
      }),
    );
    revalidatePath("/patients");
    return { imported: r.imported, packages: r.packages, skipped: r.skipped };
  });
}

// ─── Platform owner: a clinic's WhatsApp connection ─────────────────────────

export async function setClinicWhatsAppAction(input: {
  tenantId: string;
  phoneNumberId: string;
  businessAccountId: string;
  displayPhone: string;
  accessToken?: string | null;
  clearToken?: boolean;
  live: boolean;
}) {
  return staffAction("platform:clinics", async (ctx) => {
    const v = parse(
      z.object({
        tenantId: uuid,
        phoneNumberId: z.string().trim().max(40).regex(/^\d*$/),
        businessAccountId: z.string().trim().max(40).regex(/^\d*$/),
        displayPhone: z.string().trim().max(30),
        accessToken: z.string().trim().max(1000).nullish(),
        clearToken: z.boolean().default(false),
        live: z.boolean(),
      }),
      input,
    );
    const r = await setClinicWhatsApp({ userId: ctx.user.id, roles: ctx.roles }, v.tenantId, v);
    revalidatePath("/platform");
    return r;
  });
}

export async function testClinicWhatsAppAction(input: { tenantId: string; phone: string }) {
  return staffAction("platform:clinics", async (ctx) => {
    const v = parse(z.object({ tenantId: uuid, phone: z.string().trim().min(9).max(20) }), input);
    return testClinicWhatsApp({ userId: ctx.user.id, roles: ctx.roles }, v.tenantId, v.phone);
  });
}

// ─── Care team: which doctors a nurse / assistant works with ────────────────

export async function setCareTeamAction(input: { memberId: string; doctorIds: string[] }) {
  return staffAction("team:manage", async (_ctx, actor) => {
    const v = parse(z.object({ memberId: uuid, doctorIds: z.array(uuid).max(50) }), input);
    const r = await withActor(actor, (tx) => setCareTeam(tx, actor, v.memberId, v.doctorIds));
    revalidatePath("/settings");
    return r;
  });
}

// ─── Checkout (reception) ───────────────────────────────────────────────────

export async function checkOutAction(input: {
  appointmentId: string;
  paidSar: number;
  method: "cash" | "card" | "transfer" | null;
  invoiceNumber?: string | null;
  note?: string | null;
}) {
  return staffAction("visits:checkout", async (_ctx, actor) => {
    const v = parse(
      z.object({
        appointmentId: uuid,
        paidSar: z.number().min(0).max(1_000_000),
        method: z.enum(["cash", "card", "transfer"]).nullable(),
        invoiceNumber: z.string().trim().max(60).nullable().optional(),
        note: z.string().trim().max(500).nullable().optional(),
      }),
      input,
    );
    const r = await withActor(actor, (tx) =>
      checkOut(tx, actor, {
        appointmentId: v.appointmentId,
        paidHalalas: Math.round(v.paidSar * 100),
        method: v.method,
        invoiceNumber: v.invoiceNumber ?? null,
        note: v.note ?? null,
      }),
    );
    refreshScreens();
    revalidatePath(`/checkout/${v.appointmentId}`);
    return { id: r.id };
  });
}

/** Sends the patient the link to their after-visit instructions (once per visit). */
export async function sendVisitInstructionsAction(appointmentId: string) {
  return staffAction("visits:checkout", async (ctx) => {
    const id = parse(uuid, appointmentId);
    const r = await sendVisitInstructions(ctx.tenant, id);
    revalidatePath(`/checkout/${id}`);
    return r.outcome === "skipped"
      ? { outcome: "skipped" as const, reason: r.reason }
      : { outcome: r.outcome, error: r.error };
  });
}

// ─── Front desk (fast lane) ─────────────────────────────────────────────────

/** Find a patient by mobile, name or file number — with today's visit, if any. */
export async function deskSearchAction(query: string) {
  return staffAction(
    "appointments:manage",
    async (_ctx, actor) => {
      const q = parse(text(100), query);
      return withActor(actor, (tx) => deskSearch(tx, actor, q));
    },
    PAUSED_OK,
  );
}

/** Walk-in: book the chosen free time and check in, in one step. */
export async function walkInAction(input: {
  branchId: string;
  patientId: string;
  serviceId: string;
  practitionerId: string;
  startsAt: string;
}) {
  return staffAction("appointments:manage", async (_ctx, actor) => {
    const v = parse(
      z.object({
        branchId: uuid,
        patientId: uuid,
        serviceId: uuid,
        practitionerId: uuid,
        startsAt: z.string().datetime({ offset: true }),
      }),
      input,
    );
    const r = await withActor(actor, (tx) =>
      walkIn(tx, actor, { ...v, startsAt: new Date(v.startsAt) }),
    );
    refreshScreens();
    notifyLater(actor.tenantId, [
      { type: "new_booking", appointmentId: r.appointmentId, actorUserId: actor.userId },
      ...(r.result.status === "checked_in"
        ? [
            {
              type: "checked_in" as const,
              appointmentId: r.appointmentId,
              actorUserId: actor.userId,
            },
          ]
        : []),
    ]);
    if (r.result.status === "consent_required") {
      const t = r.result.template;
      return {
        appointmentId: r.appointmentId,
        status: "consent_required" as const,
        template: {
          id: t.id,
          code: t.code,
          version: t.version,
          titleAr: t.titleAr,
          titleEn: t.titleEn,
          bodyAr: t.bodyAr,
          bodyEn: t.bodyEn,
        },
      };
    }
    return { appointmentId: r.appointmentId, status: r.result.status };
  });
}

// ─── Dental ─────────────────────────────────────────────────────────────────

/** Patient file and visit screen show the dental chart and plan: refresh both. */
function dentalChanged(patientId: string, appointmentId?: string | null) {
  revalidatePath(`/patients/${patientId}`);
  if (appointmentId) visitChanged(appointmentId);
}

export async function recordToothAction(input: {
  patientId: string;
  tooth: number;
  condition: string;
  surfaces?: string;
  note?: string | null;
  appointmentId?: string | null;
}) {
  return staffAction("dental:chart", async (_ctx, actor) => {
    const v = parse(
      z.object({
        patientId: uuid,
        tooth: z.number().int().min(11).max(48),
        condition: z.enum(TOOTH_CONDITIONS),
        surfaces: text(5).optional(),
        note: text(300).nullish(),
        appointmentId: uuid.nullish(),
      }),
      input,
    );
    await withActor(actor, (tx) => recordTooth(tx, actor, v));
    dentalChanged(v.patientId, v.appointmentId);
    return null;
  });
}

/** Voice charting: the teeth the dentist checked and saved, in one go. */
export async function recordTeethAction(input: {
  patientId: string;
  appointmentId?: string | null;
  items: { tooth: number; condition: string; surfaces?: string }[];
}) {
  return staffAction("dental:chart", async (_ctx, actor) => {
    const v = parse(
      z.object({
        patientId: uuid,
        appointmentId: uuid.nullish(),
        items: z
          .array(
            z.object({
              tooth: z.number().int().min(11).max(48),
              condition: z.enum(TOOTH_CONDITIONS),
              surfaces: text(5).optional(),
            }),
          )
          .min(1)
          .max(32),
      }),
      input,
    );
    await withActor(actor, (tx) => recordTeeth(tx, actor, v));
    dentalChanged(v.patientId, v.appointmentId);
    return null;
  });
}

export async function addPlanItemAction(input: {
  patientId: string;
  serviceId: string;
  tooth?: number | null;
  surfaces?: string;
  note?: string | null;
  appointmentId?: string | null;
}) {
  return staffAction("dental:plan", async (_ctx, actor) => {
    const v = parse(
      z.object({
        patientId: uuid,
        serviceId: uuid,
        tooth: z.number().int().min(11).max(48).nullish(),
        surfaces: text(5).optional(),
        note: text(300).nullish(),
        appointmentId: uuid.nullish(),
      }),
      input,
    );
    await withActor(actor, (tx) => addPlanItem(tx, actor, v));
    dentalChanged(v.patientId, v.appointmentId);
    return null;
  });
}

export async function planDoneAction(input: {
  patientId: string;
  itemId: string;
  appointmentId: string;
}) {
  return staffAction("dental:plan", async (_ctx, actor) => {
    const v = parse(z.object({ patientId: uuid, itemId: uuid, appointmentId: uuid }), input);
    await withActor(actor, (tx) => markPlanDone(tx, actor, v));
    dentalChanged(v.patientId, v.appointmentId);
    return null;
  });
}

export async function cancelPlanItemAction(input: {
  patientId: string;
  itemId: string;
  appointmentId?: string | null;
}) {
  return staffAction("dental:plan", async (_ctx, actor) => {
    const v = parse(
      z.object({ patientId: uuid, itemId: uuid, appointmentId: uuid.nullish() }),
      input,
    );
    await withActor(actor, (tx) => cancelPlanItem(tx, actor, v.itemId));
    dentalChanged(v.patientId, v.appointmentId);
    return null;
  });
}

export async function createLabCaseAction(input: {
  patientId: string;
  practitionerId: string;
  appointmentId?: string | null;
  labName: string;
  work: string;
  teeth?: string;
  shade?: string | null;
  sentOn: string;
  dueOn: string;
  notes?: string | null;
}) {
  return staffAction("lab:manage", async (_ctx, actor) => {
    const v = parse(
      z.object({
        patientId: uuid,
        practitionerId: uuid,
        appointmentId: uuid.nullish(),
        labName: text(80).min(2),
        work: z.enum(LAB_WORK),
        teeth: text(40).optional(),
        shade: text(20).nullish(),
        sentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        notes: text(300).nullish(),
      }),
      input,
    );
    await withActor(actor, (tx) => createLabCase(tx, actor, v));
    dentalChanged(v.patientId, v.appointmentId);
    revalidatePath("/lab-cases");
    return null;
  });
}

export async function setLabStatusAction(input: { id: string; status: string; patientId: string }) {
  return staffAction("lab:manage", async (ctx, actor) => {
    const v = parse(z.object({ id: uuid, status: z.enum(LAB_STATUSES), patientId: uuid }), input);
    await withActor(actor, (tx) => setLabStatus(tx, actor, v));
    // Back from the lab: the patient gets "book your fitting" on WhatsApp.
    if (v.status === "received") whatsappLater(() => sendLabReady(ctx.tenant, v.id));
    dentalChanged(v.patientId);
    revalidatePath("/lab-cases");
    return null;
  });
}

// ─── Lab results (doctors and nurses) ───────────────────────────────────────

const labNumber = z.number().finite().nullish();

export async function addLabReportAction(input: unknown) {
  return staffAction("labs:manage", async (_ctx, actor) => {
    const v = parse(
      z.object({
        patientId: uuid,
        appointmentId: uuid.nullish(),
        takenOn: day,
        labName: text(120).nullish(),
        note: text(1000).nullish(),
        fileId: uuid.nullish(),
        values: z
          .array(
            z.object({
              testName: text(120),
              valueText: text(60),
              unit: text(30).nullish(),
              refLow: labNumber,
              refHigh: labNumber,
              abnormal: z.boolean().optional(),
            }),
          )
          .max(60),
      }),
      input,
    );
    const r = await withActor(actor, (tx) => addLabReport(tx, actor, v));
    dentalChanged(v.patientId, v.appointmentId);
    return { requestsDone: r.requestsDone };
  });
}

export async function voidLabReportAction(input: unknown) {
  return staffAction("labs:manage", async (_ctx, actor) => {
    const v = parse(
      z.object({
        reportId: uuid,
        reason: text(300),
        patientId: uuid,
        appointmentId: uuid.nullish(),
      }),
      input,
    );
    await withActor(actor, (tx) => voidLabReport(tx, actor, v));
    dentalChanged(v.patientId, v.appointmentId);
    return null;
  });
}

export async function requestLabRepeatAction(input: unknown) {
  return staffAction("labs:manage", async (_ctx, actor) => {
    const v = parse(
      z.object({
        patientId: uuid,
        testName: text(120),
        dueOn: day,
        reason: text(300).nullish(),
        appointmentId: uuid.nullish(),
      }),
      input,
    );
    await withActor(actor, (tx) => requestRepeat(tx, actor, v));
    dentalChanged(v.patientId, v.appointmentId);
    return null;
  });
}

export async function cancelLabRequestAction(input: unknown) {
  return staffAction("labs:manage", async (_ctx, actor) => {
    const v = parse(
      z.object({ requestId: uuid, patientId: uuid, appointmentId: uuid.nullish() }),
      input,
    );
    await withActor(actor, (tx) => cancelRequest(tx, actor, v.requestId));
    dentalChanged(v.patientId, v.appointmentId);
    return null;
  });
}

/** A wrong before / after photo: hidden with a reason (never deleted). */
export async function voidPhotoAction(input: {
  patientId: string;
  photoId: string;
  reason: string;
}) {
  return staffAction("photos:manage", async (_ctx, actor) => {
    const v = parse(z.object({ patientId: uuid, photoId: uuid, reason: text(300) }), input);
    await withActor(actor, (tx) => voidPhoto(tx, actor, { photoId: v.photoId, reason: v.reason }));
    revalidatePath(`/patients/${v.patientId}`);
    return null;
  });
}
