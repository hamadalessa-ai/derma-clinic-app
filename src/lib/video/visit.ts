/**
 * Joining a video consultation — the patient from their WhatsApp link, the doctor from My Day.
 *
 * Rules (enforced here, not only on the screens):
 *  - only appointments for a video service, not cancelled / no-show / completed;
 *  - only around the appointment time: patients from 15 minutes before, the doctor from 30,
 *    both until 30 minutes after the planned end (the room closes then);
 *  - the patient has signed the video-consultation consent (if the service needs one);
 *  - the doctor is the appointment's own doctor (practitioner role);
 *  - nothing is recorded; the provider only ever sees a coded room name and a first name.
 * Network calls to the video service happen OUTSIDE database transactions.
 */
import { eq } from "drizzle-orm";
import { appointments, patients, services, tenantMembers, users } from "@/db/schema";
import { withTenant, type TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import { withActor, type Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";
import { addMinutes } from "@/lib/booking/time";
import { consentStatusFor } from "@/lib/consents/consents";
import { videoCheckIn } from "@/lib/visits/check-in";
import { videoRoomName, parseVideoToken } from "./link";
import type { VideoProvider } from "./provider";

export const PATIENT_EARLY_MINUTES = 15;
export const DOCTOR_EARLY_MINUTES = 30;
export const LATE_MINUTES = 30;
const JOINABLE = ["booked", "confirmed", "arrived", "in_session"];

export type VideoState = "not_virtual" | "cancelled" | "too_early" | "ended" | "open";

export class VideoVisitError extends Error {
  constructor(
    public code:
      | "not_configured"
      | "not_found"
      | "not_virtual"
      | "cancelled"
      | "too_early"
      | "ended"
      | "consent"
      | "not_yours"
      | "failed",
  ) {
    super(code);
    this.name = "VideoVisitError";
  }
}

export interface VisitInfo {
  appointmentId: string;
  patientId: string;
  patientFirstAr: string;
  patientFirstEn: string;
  practitionerId: string;
  doctorAr: string;
  doctorEn: string | null;
  serviceAr: string;
  serviceEn: string;
  isVirtual: boolean;
  status: string;
  startsAt: Date;
  endsAt: Date;
  /** The video-consultation consent still needs signing for this visit. */
  consentNeeded: boolean;
}

const first = (full: string | null | undefined) => (full ?? "").trim().split(/\s+/)[0] ?? "";

/** Everything the join pages show about one appointment (null = no such appointment). */
export async function loadVisit(tx: TenantTx, appointmentId: string): Promise<VisitInfo | null> {
  const [row] = await tx
    .select({
      a: appointments,
      nameAr: patients.fullNameAr,
      nameEn: patients.fullNameEn,
      serviceAr: services.nameAr,
      serviceEn: services.nameEn,
      isVirtual: services.isVirtual,
    })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .where(eq(appointments.id, appointmentId))
    .limit(1);
  if (!row) return null;
  const [doctor] = await tx
    .select({ nameAr: users.name, nameEn: users.nameEn })
    .from(tenantMembers)
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(eq(tenantMembers.id, row.a.practitionerId));
  const consent = (
    await consentStatusFor(tx, [
      { id: row.a.id, patientId: row.a.patientId, serviceId: row.a.serviceId },
    ])
  ).get(row.a.id);
  return {
    appointmentId: row.a.id,
    patientId: row.a.patientId,
    patientFirstAr: first(row.nameAr),
    patientFirstEn: first(row.nameEn || row.nameAr),
    practitionerId: row.a.practitionerId,
    doctorAr: doctor?.nameAr ?? "",
    doctorEn: doctor?.nameEn ?? null,
    serviceAr: row.serviceAr,
    serviceEn: row.serviceEn,
    isVirtual: row.isVirtual,
    status: row.a.status,
    startsAt: row.a.startsAt,
    endsAt: row.a.endsAt,
    consentNeeded: !!consent && !consent.signed,
  };
}

/** When the video room is open for this person. */
export function joinWindow(v: Pick<VisitInfo, "startsAt" | "endsAt">, who: "patient" | "doctor") {
  return {
    opensAt: addMinutes(
      v.startsAt,
      -(who === "patient" ? PATIENT_EARLY_MINUTES : DOCTOR_EARLY_MINUTES),
    ),
    closesAt: addMinutes(v.endsAt, LATE_MINUTES),
  };
}

export function videoState(
  v: Pick<VisitInfo, "isVirtual" | "status" | "startsAt" | "endsAt">,
  who: "patient" | "doctor",
  now: Date = new Date(),
): VideoState {
  if (!v.isVirtual) return "not_virtual";
  if (!JOINABLE.includes(v.status)) return v.status === "completed" ? "ended" : "cancelled";
  const { opensAt, closesAt } = joinWindow(v, who);
  if (now < opensAt) return "too_early";
  if (now >= closesAt) return "ended";
  return "open";
}

async function enter(
  provider: VideoProvider,
  tenantId: string,
  v: VisitInfo,
  who: { owner: boolean; name: string },
) {
  // The room opens for the doctor's (earlier) window and closes after the visit.
  const { opensAt } = joinWindow(v, "doctor");
  const { closesAt } = joinWindow(v, "patient");
  const room = videoRoomName(tenantId, v.appointmentId);
  try {
    const url = await provider.ensureRoom({ name: room, opensAt, closesAt });
    const token = await provider.joinToken({
      room,
      userName: who.name,
      owner: who.owner,
      expiresAt: closesAt,
    });
    return `${url}?t=${encodeURIComponent(token)}`;
  } catch (err) {
    console.warn("video join failed", err instanceof Error ? err.message : err);
    throw new VideoVisitError("failed");
  }
}

function check(state: VideoState) {
  if (state !== "open") throw new VideoVisitError(state);
}

/** The patient opens their WhatsApp link: a personal URL into the video room. */
export async function patientJoin(
  tenantId: string,
  token: string,
  opts: { provider: VideoProvider | null; now?: Date; lang?: "ar" | "en" },
): Promise<{ url: string }> {
  const appointmentId = parseVideoToken(tenantId, token);
  if (!appointmentId) throw new VideoVisitError("not_found");
  const v = await withTenant(tenantId, (tx) => loadVisit(tx, appointmentId));
  if (!v) throw new VideoVisitError("not_found");
  check(videoState(v, "patient", opts.now));
  if (v.consentNeeded) throw new VideoVisitError("consent");
  if (!opts.provider) throw new VideoVisitError("not_configured");
  const url = await enter(opts.provider, tenantId, v, {
    owner: false,
    name: (opts.lang === "en" ? v.patientFirstEn : v.patientFirstAr) || "Patient",
  });
  await withTenant(tenantId, (tx) =>
    audit(tx, {
      actorUserId: null,
      action: "video.patient_joined",
      entityType: "appointment",
      entityId: v.appointmentId,
    }),
  );
  // Joining is the patient's arrival (reception doesn't need to check them in). Never blocks the call.
  try {
    await withTenant(tenantId, (tx) => videoCheckIn(tx, tenantId, v.appointmentId));
  } catch (err) {
    console.warn("video check-in failed", err instanceof Error ? err.message : err);
  }
  return { url };
}

/** The appointment's own doctor joins (as the room's host). */
export async function doctorJoin(
  actor: Actor,
  appointmentId: string,
  opts: { provider: VideoProvider | null; now?: Date },
): Promise<{ url: string }> {
  assertCan(actor.roles, "video:join");
  const v = await withActor(actor, (tx) => loadVisit(tx, appointmentId));
  if (!v) throw new VideoVisitError("not_found");
  if (!actor.memberId || v.practitionerId !== actor.memberId) {
    throw new VideoVisitError("not_yours");
  }
  check(videoState(v, "doctor", opts.now));
  if (!opts.provider) throw new VideoVisitError("not_configured");
  const url = await enter(opts.provider, actor.tenantId, v, {
    owner: true,
    name: v.doctorAr || v.doctorEn || "Doctor",
  });
  await withActor(actor, (tx) =>
    audit(tx, {
      actorUserId: actor.userId,
      action: "video.doctor_joined",
      entityType: "appointment",
      entityId: v.appointmentId,
    }),
  );
  return { url };
}
