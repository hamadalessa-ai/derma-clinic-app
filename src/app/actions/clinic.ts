"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { patientMedicalFlags, patients } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withActor } from "@/lib/auth/db";
import {
  blockTime,
  bookAppointment,
  changeStatus,
  findFreeSlots,
  moveAppointment,
  removeTimeBlock,
} from "@/lib/booking/engine";
import { APPOINTMENT_STATUSES } from "@/lib/booking/status";
import { atRiyadh } from "@/lib/booking/time";
import { saveTemplateVersion, signConsent } from "@/lib/consents/consents";
import { refreshDemoWeek } from "@/lib/demo/refresh";
import { addAddendum, openDraft, saveDraft, signNote } from "@/lib/notes/notes";
import { overrideSessions, recordPayment, sellPackage } from "@/lib/packages/packages";
import { nextFileNumber, searchPatients } from "@/lib/patients/queries";
import { updateSettings } from "@/lib/settings";
import { checkIn } from "@/lib/visits/check-in";
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
  return staffAction("appointments:manage", async (_ctx, actor) => {
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
    return { id: a.id };
  });
}

export async function freeSlotsAction(input: {
  branchId: string;
  serviceId: string;
  practitionerId?: string;
  day: string;
  time?: string;
}) {
  return staffAction(["appointments:manage", "appointments:own"], async (_ctx, actor) => {
    const v = parse(
      z.object({
        branchId: uuid,
        serviceId: uuid,
        practitionerId: uuid.optional(),
        day,
        time: time.optional(),
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
        limit: 6,
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
    return null;
  });
}

export async function statusAction(input: { appointmentId: string; to: string; reason?: string }) {
  return staffAction(["appointments:manage", "appointments:own"], async (_ctx, actor) => {
    const v = parse(
      z.object({
        appointmentId: uuid,
        to: z.enum(APPOINTMENT_STATUSES),
        reason: text(300).optional(),
      }),
      input,
    );
    await withActor(actor, (tx) =>
      changeStatus(tx, actor, v.appointmentId, v.to, { reason: v.reason }),
    );
    refreshScreens();
    return null;
  });
}

export async function checkInAction(appointmentId: string) {
  return staffAction("appointments:manage", async (_ctx, actor) => {
    const id = parse(uuid, appointmentId);
    const r = await withActor(actor, (tx) => checkIn(tx, actor, id));
    refreshScreens();
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
    await withActor(actor, (tx) => decideRequest(tx, actor, v));
    refreshScreens();
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

export async function updateSettingsAction(input: { doctorsManageOwnSchedule: boolean }) {
  return staffAction("settings:manage", async (_ctx, actor) => {
    const v = parse(z.object({ doctorsManageOwnSchedule: z.boolean() }), input);
    await withActor(actor, (tx) => updateSettings(tx, actor, v));
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
