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
import { can } from "@/lib/auth/permissions";
import { APPOINTMENT_STATUSES } from "@/lib/booking/status";
import { atRiyadh, riyadhTime } from "@/lib/booking/time";
import { saveConsentRule, saveTemplateVersion, signConsent } from "@/lib/consents/consents";
import { CONSENT_RULES } from "@/db/schema";
import { refreshDemoWeek } from "@/lib/demo/refresh";
import { addAddendum, openDraft, saveDraft, signNote } from "@/lib/notes/notes";
import { anthropicClient } from "@/lib/ai/claude";
import { scribeDraft } from "@/lib/ai/scribe";
import { videoProvider } from "@/lib/video/provider";
import { doctorJoin } from "@/lib/video/visit";
import {
  addHoursException,
  removeHoursException,
  saveWeeklyHours,
} from "@/lib/booking/working-hours";
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
import { sendBookingConfirmation } from "@/lib/whatsapp/outbox";
import { removeSubscription, savePrefs, saveSubscription } from "@/lib/push/subscriptions";
import { setMemberGender, setServiceOnline, updateSettings } from "@/lib/settings";
import { checkIn } from "@/lib/visits/check-in";
import { signAndComplete, startVisit } from "@/lib/visits/visit";
import { decideRequest, doctorReschedule } from "@/lib/visits/reschedule";
import { parse, staffAction, ValidationError } from "@/lib/actions";

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
  return staffAction(["calendar:view", "patients:read"], async (_ctx, actor) => {
    const q = parse(text(100), query);
    const rows = await withActor(actor, (tx) => searchPatients(tx, q, 12));
    return rows.map((p) => ({
      id: p.id,
      fileNumber: p.fileNumber,
      nameAr: p.fullNameAr,
      nameEn: p.fullNameEn,
      phone: p.phone,
    }));
  });
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
  return staffAction(["appointments:manage", "appointments:own"], async (_ctx, actor) => {
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
  });
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

export async function signNoteAction(input: { patientId: string; noteId: string; body: string }) {
  return staffAction("notes:write", async (_ctx, actor) => {
    const v = parse(
      z.object({ patientId: uuid, noteId: uuid, body: z.string().max(20000) }),
      input,
    );
    await withActor(actor, (tx) => signNote(tx, actor, v.noteId, v.body));
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
}) {
  return staffAction("notes:write", async (_ctx, actor) => {
    const v = parse(
      z.object({ appointmentId: uuid, noteId: uuid, body: z.string().max(20000) }),
      input,
    );
    const r = await withActor(actor, (tx) => signAndComplete(tx, actor, v));
    refreshScreens();
    revalidatePath("/clinical-notes");
    revalidatePath(`/visits/${v.appointmentId}`);
    return r;
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
  return staffAction("video:join", async (_ctx, actor) => {
    const v = parse(z.object({ appointmentId: uuid }), input);
    return doctorJoin(actor, v.appointmentId, { provider: videoProvider() });
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
  return staffAction("account:manage", async (_ctx, actor) => {
    const sub = parse(subscription, input);
    // System context: a shared device may still be registered to the previous user.
    await withTenant(actor.tenantId, (tx) =>
      saveSubscription(tx, { tenantId: actor.tenantId, userId: actor.userId, sub }),
    );
    return null;
  });
}

export async function removePushSubscriptionAction(input: { endpoint: string }) {
  return staffAction("account:manage", async (_ctx, actor) => {
    const v = parse(z.object({ endpoint: z.string().max(1000) }), input);
    await withActor(actor, (tx) => removeSubscription(tx, actor.userId, v.endpoint));
    revalidatePath("/account");
    return null;
  });
}

export async function saveNotificationPrefsAction(input: {
  enabled: boolean;
  mutedTypes: string[];
}) {
  return staffAction("account:manage", async (_ctx, actor) => {
    const v = parse(
      z.object({ enabled: z.boolean(), mutedTypes: z.array(z.string().max(40)).max(20) }),
      input,
    );
    await withActor(actor, (tx) =>
      savePrefs(tx, { tenantId: actor.tenantId, userId: actor.userId, ...v }),
    );
    revalidatePath("/account");
    return null;
  });
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
  return staffAction("whatsapp:simulator", async (ctx, actor) => {
    const v = parse(conversationId, input);
    if (whatsappMode(ctx.tenant) !== "demo") return null;
    await withActor(actor, (tx) => markDemoThreadRead(tx, v.conversationId));
    return null;
  });
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
  return staffAction(["appointments:manage", "appointments:own"], async (ctx, actor) => {
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
  });
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
  return staffAction("concerns:handle", async (_ctx, actor) => {
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
  });
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
