/**
 * Handling a post-care concern — by the doctor from the Concern card (patient file / My Day), or by
 * reception/admin. Every action checks the permission, runs as the signed-in user (so branch walls
 * apply), and is written to the audit log.
 *
 *  - reply: a WhatsApp message through the ONE sender (simulator in demo), signed with the staff
 *    member's name; free text only inside WhatsApp's 24-hour window;
 *  - ask for a photo: a ready-made message (same window rule); the photo comes back through
 *    handleInbound() and is stored in the patient's file (FileStore);
 *  - internal note: never sent to the patient; shown in the inbox and on the file; notifies the
 *    other side (doctor ↔ reception);
 *  - follow-up: booked directly when "Doctors manage their own schedule" is ON (same doctor, same
 *    booking engine), otherwise a ready request to reception; reception/admin can always book;
 *  - resolve: with an optional note; the concern leaves My Day.
 */
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { appointments, concernEvents, conversations, patients, users } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import { withActor, type Actor } from "@/lib/auth/db";
import { assertCan, can } from "@/lib/auth/permissions";
import { bookFollowUp, getSettings } from "@/lib/booking/engine";
import type { PushEvent } from "@/lib/push/notify";
import { findConcerns } from "./concerns";
import { sendMessage, type SendOutcome, type Tenant } from "./send";
import { insideWindow } from "./staff";

type Env = Record<string, string | undefined>;

export class ConcernError extends Error {
  constructor(public code: "not_found" | "outside_window" | "empty_message" | "not_configured") {
    super(code);
    this.name = "ConcernError";
  }
}

/** The concern about this visit, its chat and the patient — as this user may see them. */
async function load(tx: TenantTx, appointmentId: string) {
  const [concern] = await findConcerns(tx, { appointmentId });
  if (!concern) throw new ConcernError("not_found");
  const [convo] = await tx
    .select()
    .from(conversations)
    .where(eq(conversations.id, concern.conversationId));
  const [appt] = await tx
    .select({
      branchId: appointments.branchId,
      practitionerId: appointments.practitionerId,
      serviceId: appointments.serviceId,
    })
    .from(appointments)
    .where(eq(appointments.id, appointmentId));
  const [patient] = await tx
    .select({ preferredLanguage: patients.preferredLanguage })
    .from(patients)
    .where(eq(patients.id, concern.patientId));
  if (!convo || !appt) throw new ConcernError("not_found");
  return { concern, convo, appt, lang: patient?.preferredLanguage === "en" ? "en" : "ar" };
}

/** The staff member's name as the patient sees it (in their language). */
async function staffName(tx: TenantTx, userId: string, lang: "ar" | "en") {
  const [u] = await tx
    .select({ name: users.name, nameEn: users.nameEn })
    .from(users)
    .where(eq(users.id, userId));
  return (lang === "en" ? u?.nameEn || u?.name : u?.name) ?? "";
}

/** Reply to the patient on WhatsApp, signed with the sender's name (24-hour window). */
export async function replyToConcern(
  tenant: Tenant,
  actor: Actor,
  appointmentId: string,
  text: string,
  env: Env = process.env,
): Promise<SendOutcome> {
  assertCan(actor.roles, "concerns:handle");
  const body = text.trim().slice(0, 3500);
  if (!body) throw new ConcernError("empty_message");
  const ctx = await withActor(actor, async (tx) => {
    const c = await load(tx, appointmentId);
    return { ...c, name: await staffName(tx, actor.userId, c.lang as "ar" | "en") };
  });
  if (!insideWindow(ctx.convo.lastInboundAt)) throw new ConcernError("outside_window");
  const result = await sendMessage(
    tenant,
    {
      kind: "staff_reply",
      phone: ctx.convo.phone,
      patientId: ctx.concern.patientId,
      appointmentId,
      text: ctx.name ? `${body}\n\n— ${ctx.name}` : body,
      sentBy: actor.userId,
    },
    env,
  );
  if (result.outcome === "skipped" && result.reason === "not_configured") {
    throw new ConcernError("not_configured");
  }
  await withActor(actor, async (tx) => {
    // Answered: reception's "needs reply" list no longer shows it (the concern stays open).
    await tx
      .update(conversations)
      .set({ needsReply: false })
      .where(eq(conversations.id, ctx.convo.id));
    await audit(tx, {
      actorUserId: actor.userId,
      action: "concern.reply",
      entityType: "appointment",
      entityId: appointmentId,
      metadata: {
        conversationId: ctx.convo.id,
        messageId: "messageId" in result ? result.messageId : null,
      },
    });
  });
  return result;
}

/** "Please send a photo of the area" (ready-made wording, same 24-hour rule). */
export async function askForPhoto(
  tenant: Tenant,
  actor: Actor,
  appointmentId: string,
  env: Env = process.env,
): Promise<SendOutcome> {
  assertCan(actor.roles, "concerns:handle");
  const ctx = await withActor(actor, async (tx) => {
    const c = await load(tx, appointmentId);
    return { ...c, name: await staffName(tx, actor.userId, c.lang as "ar" | "en") };
  });
  if (!insideWindow(ctx.convo.lastInboundAt)) throw new ConcernError("outside_window");
  const result = await sendMessage(
    tenant,
    {
      kind: "photo_request",
      phone: ctx.convo.phone,
      patientId: ctx.concern.patientId,
      appointmentId,
      vars: { doctor: ctx.name || (ctx.lang === "en" ? "the clinic" : "العيادة") },
      sentBy: actor.userId,
    },
    env,
  );
  if (result.outcome === "skipped" && result.reason === "not_configured") {
    throw new ConcernError("not_configured");
  }
  await withActor(actor, (tx) =>
    audit(tx, {
      actorUserId: actor.userId,
      action: "concern.photo_request",
      entityType: "appointment",
      entityId: appointmentId,
      metadata: { conversationId: ctx.convo.id },
    }),
  );
  return result;
}

/** Internal note (never sent to the patient). Returns the notification to send afterwards. */
export async function addConcernNote(
  tx: TenantTx,
  actor: Actor,
  appointmentId: string,
  text: string,
): Promise<PushEvent[]> {
  assertCan(actor.roles, "concerns:handle");
  const body = text.trim().slice(0, 2000);
  if (!body) throw new ConcernError("empty_message");
  const { concern } = await load(tx, appointmentId);
  const [row] = await tx
    .insert(concernEvents)
    .values({
      tenantId: actor.tenantId,
      appointmentId,
      conversationId: concern.conversationId,
      patientId: concern.patientId,
      kind: "note",
      body,
      actorUserId: actor.userId,
    })
    .returning({ id: concernEvents.id });
  // Reception sees it in "needs reply"; the doctor sees it on the Concern card.
  await tx
    .update(conversations)
    .set({ needsReply: true })
    .where(eq(conversations.id, concern.conversationId));
  await audit(tx, {
    actorUserId: actor.userId,
    action: "concern.note",
    entityType: "appointment",
    entityId: appointmentId,
    metadata: { eventId: row.id },
  });
  return [{ type: "concern_note", appointmentId, actorUserId: actor.userId }];
}

/** Resolved (optional note): the concern leaves My Day; the chat leaves "needs reply". */
export async function resolveConcern(
  tx: TenantTx,
  actor: Actor,
  appointmentId: string,
  note?: string | null,
) {
  assertCan(actor.roles, "concerns:handle");
  const { concern } = await load(tx, appointmentId);
  const [row] = await tx
    .insert(concernEvents)
    .values({
      tenantId: actor.tenantId,
      appointmentId,
      conversationId: concern.conversationId,
      patientId: concern.patientId,
      kind: "resolved",
      body: note?.trim().slice(0, 2000) || null,
      actorUserId: actor.userId,
    })
    .returning({ id: concernEvents.id });
  await tx
    .update(conversations)
    .set({ needsReply: false })
    .where(eq(conversations.id, concern.conversationId));
  await audit(tx, {
    actorUserId: actor.userId,
    action: "concern.resolved",
    entityType: "appointment",
    entityId: appointmentId,
    metadata: { eventId: row.id, note: !!note?.trim() },
  });
}

/** How this user's "Book follow-up" works: book it now, or send reception a ready request. */
export async function followUpMode(
  tx: TenantTx,
  actor: Actor,
  practitionerId: string,
): Promise<"book" | "request"> {
  if (can(actor.roles, "appointments:manage")) return "book";
  const own = can(actor.roles, "appointments:own") && actor.memberId === practitionerId;
  return own && (await getSettings(tx)).doctorsManageOwnSchedule ? "book" : "request";
}

/**
 * Follow-up visit with the SAME doctor as the treated visit. Booked through the booking engine
 * (same rules, no double-booking), or — when doctors don't manage their own schedule — sent to
 * reception as a ready request (patient, doctor, service, suggested time).
 */
export async function followUpConcern(
  tx: TenantTx,
  actor: Actor,
  appointmentId: string,
  input: { serviceId: string; startsAt: Date; note?: string | null },
): Promise<{ mode: "book"; appointmentId: string } | { mode: "request"; push: PushEvent[] }> {
  assertCan(actor.roles, "concerns:handle");
  const { concern, appt } = await load(tx, appointmentId);
  const base = {
    tenantId: actor.tenantId,
    appointmentId,
    conversationId: concern.conversationId,
    patientId: concern.patientId,
    actorUserId: actor.userId,
    serviceId: input.serviceId,
    body: input.note?.trim().slice(0, 1000) || null,
  };
  if ((await followUpMode(tx, actor, appt.practitionerId)) === "book") {
    const booked = await bookFollowUp(tx, actor, {
      branchId: appt.branchId,
      patientId: concern.patientId,
      serviceId: input.serviceId,
      practitionerId: appt.practitionerId,
      startsAt: input.startsAt,
      receptionNote: base.body,
    });
    await tx.insert(concernEvents).values({
      ...base,
      kind: "follow_up",
      proposedStartsAt: input.startsAt,
      followUpAppointmentId: booked.id,
    });
    await audit(tx, {
      actorUserId: actor.userId,
      action: "concern.follow_up_booked",
      entityType: "appointment",
      entityId: appointmentId,
      metadata: { followUpAppointmentId: booked.id },
    });
    return { mode: "book", appointmentId: booked.id };
  }
  await tx.insert(concernEvents).values({
    ...base,
    kind: "follow_up_request",
    proposedStartsAt: input.startsAt,
  });
  await audit(tx, {
    actorUserId: actor.userId,
    action: "concern.follow_up_requested",
    entityType: "appointment",
    entityId: appointmentId,
    metadata: { proposedStartsAt: input.startsAt.toISOString(), serviceId: input.serviceId },
  });
  return {
    mode: "request",
    push: [{ type: "follow_up_request", appointmentId, actorUserId: actor.userId }],
  };
}

/** Reception's list: doctors' follow-up requests not booked yet (newest last). */
export async function openFollowUpRequests(tx: TenantTx) {
  const requests = await tx
    .select()
    .from(concernEvents)
    .where(eq(concernEvents.kind, "follow_up_request"))
    .orderBy(asc(concernEvents.createdAt));
  if (!requests.length) return [];
  const booked = await tx
    .select({ appointmentId: concernEvents.appointmentId, createdAt: concernEvents.createdAt })
    .from(concernEvents)
    .where(
      and(
        eq(concernEvents.kind, "follow_up"),
        inArray(
          concernEvents.appointmentId,
          requests.map((r) => r.appointmentId),
        ),
      ),
    );
  // Only requests about visits this user may see (branch walls hide the others).
  const visible = await tx
    .select({
      id: appointments.id,
      practitionerId: appointments.practitionerId,
      branchId: appointments.branchId,
    })
    .from(appointments)
    .where(
      inArray(
        appointments.id,
        requests.map((r) => r.appointmentId),
      ),
    );
  return requests
    .filter(
      (r) => !booked.some((b) => b.appointmentId === r.appointmentId && b.createdAt > r.createdAt),
    )
    .flatMap((r) => {
      const v = visible.find((x) => x.id === r.appointmentId);
      return v ? [{ ...r, practitionerId: v.practitionerId, branchId: v.branchId }] : [];
    });
}

/** Reception books a doctor's follow-up request (at the suggested time, or another). */
export async function bookFollowUpRequest(
  tx: TenantTx,
  actor: Actor,
  requestId: string,
  startsAt?: Date | null,
) {
  assertCan(actor.roles, "appointments:manage");
  const [req] = await tx
    .select()
    .from(concernEvents)
    .where(and(eq(concernEvents.id, requestId), eq(concernEvents.kind, "follow_up_request")));
  if (!req?.serviceId) throw new ConcernError("not_found");
  const [done] = await tx
    .select({ id: concernEvents.id })
    .from(concernEvents)
    .where(
      and(
        eq(concernEvents.appointmentId, req.appointmentId),
        eq(concernEvents.kind, "follow_up"),
        gt(concernEvents.createdAt, req.createdAt),
      ),
    )
    .orderBy(desc(concernEvents.createdAt))
    .limit(1);
  if (done) throw new ConcernError("not_found"); // already booked
  return followUpConcern(tx, actor, req.appointmentId, {
    serviceId: req.serviceId,
    startsAt: startsAt ?? req.proposedStartsAt!,
    note: req.body,
  });
}

/** Everything staff did on concerns in this chat (notes, follow-ups, resolved), with names. */
export async function concernEventsFor(tx: TenantTx, where: { conversationId: string }) {
  const rows = await tx
    .select({ e: concernEvents, name: users.name, nameEn: users.nameEn })
    .from(concernEvents)
    .leftJoin(users, eq(users.id, concernEvents.actorUserId))
    .where(eq(concernEvents.conversationId, where.conversationId))
    .orderBy(asc(concernEvents.createdAt));
  return rows;
}
