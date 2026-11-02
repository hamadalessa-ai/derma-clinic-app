/**
 * Reception's side of WhatsApp: the inbox (chats needing a reply), replying (24-hour rule),
 * linking a new number to a patient or creating one, recording WhatsApp consent, and
 * "doctor running late". Every change checks permissions and is audited.
 */
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { appointments, conversations, messages, patients } from "@/db/schema";
import { withTenant, type TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";
import { dayRange } from "@/lib/booking/time";
import { nextFileNumber } from "@/lib/patients/queries";
import { sendRunningLate } from "./outbox";
import { sendMessage, type SendOutcome, type Tenant } from "./send";

export type InboxFilter = "needs_reply" | "new_contacts" | "all";

export class WhatsAppError extends Error {
  constructor(
    public code: "outside_window" | "not_found" | "empty" | "already_linked" | "not_configured",
  ) {
    super(code);
    this.name = "WhatsAppError";
  }
}

const WINDOW_MS = 24 * 3600_000;
export const insideWindow = (lastInboundAt: Date | null, now = new Date()) =>
  !!lastInboundAt && now.getTime() - lastInboundAt.getTime() < WINDOW_MS;

/** Chats for the inbox, newest first, with the last message and the patient's name. */
export async function listConversations(
  tx: TenantTx,
  filter: InboxFilter = "needs_reply",
  limit = 100,
) {
  const rows = await tx
    .select({ c: conversations, p: patients })
    .from(conversations)
    .leftJoin(patients, eq(patients.id, conversations.patientId))
    .where(
      filter === "needs_reply"
        ? eq(conversations.needsReply, true)
        : filter === "new_contacts"
          ? isNull(conversations.patientId)
          : undefined,
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(limit);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.c.id);
  const last = await tx
    .selectDistinctOn([messages.conversationId], {
      conversationId: messages.conversationId,
      body: messages.body,
      direction: messages.direction,
      status: messages.status,
      flag: messages.flag,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(inArray(messages.conversationId, ids))
    .orderBy(messages.conversationId, desc(messages.createdAt));
  const concerns = await tx
    .select({ conversationId: messages.conversationId })
    .from(messages)
    .where(and(inArray(messages.conversationId, ids), eq(messages.flag, "concern")));
  return rows.map(({ c, p }) => ({
    id: c.id,
    phone: c.phone,
    profileName: c.profileName,
    needsReply: c.needsReply,
    lastMessageAt: c.lastMessageAt.toISOString(),
    canReplyFreely: insideWindow(c.lastInboundAt),
    optedOut: !!c.optedOutAt || !!p?.whatsappOptedOutAt,
    concern: concerns.some((x) => x.conversationId === c.id),
    patient: p
      ? { id: p.id, fileNumber: p.fileNumber, nameAr: p.fullNameAr, nameEn: p.fullNameEn }
      : null,
    last: (() => {
      const m = last.find((x) => x.conversationId === c.id);
      return m ? { ...m, createdAt: m.createdAt.toISOString() } : null;
    })(),
  }));
}

export async function getThread(tx: TenantTx, conversationId: string) {
  const [row] = await tx
    .select({ c: conversations, p: patients })
    .from(conversations)
    .leftJoin(patients, eq(patients.id, conversations.patientId))
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!row) return null;
  const msgs = await tx
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));
  return {
    conversation: row.c,
    patient: row.p,
    canReplyFreely: insideWindow(row.c.lastInboundAt),
    messages: msgs,
  };
}

/** Reception answers in the chat. Only inside the 24-hour window (WhatsApp's rule). */
export async function staffReply(
  tenant: Tenant,
  actor: Actor,
  conversationId: string,
  text: string,
): Promise<SendOutcome> {
  assertCan(actor.roles, "whatsapp:inbox");
  const body = text.trim();
  if (!body) throw new WhatsAppError("empty");
  const convo = await withTenant(tenant.id, async (tx) => {
    const [c] = await tx.select().from(conversations).where(eq(conversations.id, conversationId));
    return c ?? null;
  });
  if (!convo) throw new WhatsAppError("not_found");
  if (!insideWindow(convo.lastInboundAt)) throw new WhatsAppError("outside_window");
  const result = await sendMessage(tenant, {
    kind: "staff_reply",
    phone: convo.phone,
    patientId: convo.patientId,
    text: body.slice(0, 4000),
    sentBy: actor.userId,
  });
  if (result.outcome === "skipped" && result.reason === "not_configured") {
    throw new WhatsAppError("not_configured");
  }
  await withTenant(tenant.id, async (tx) => {
    await tx
      .update(conversations)
      .set({ needsReply: false })
      .where(eq(conversations.id, conversationId));
    await audit(tx, {
      actorUserId: actor.userId,
      action: "whatsapp.reply",
      entityType: "conversation",
      entityId: conversationId,
    });
  });
  return result;
}

export async function markHandled(tx: TenantTx, actor: Actor, conversationId: string) {
  assertCan(actor.roles, "whatsapp:inbox");
  await tx
    .update(conversations)
    .set({ needsReply: false })
    .where(eq(conversations.id, conversationId));
  await audit(tx, {
    actorUserId: actor.userId,
    action: "whatsapp.handled",
    entityType: "conversation",
    entityId: conversationId,
  });
}

/** A new number ("not a patient yet") belongs to an existing patient. */
export async function linkConversation(
  tx: TenantTx,
  actor: Actor,
  conversationId: string,
  patientId: string,
) {
  assertCan(actor.roles, "whatsapp:inbox");
  assertCan(actor.roles, "patients:edit");
  const [c] = await tx.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!c) throw new WhatsAppError("not_found");
  if (c.patientId) throw new WhatsAppError("already_linked");
  const [p] = await tx.select().from(patients).where(eq(patients.id, patientId));
  if (!p) throw new WhatsAppError("not_found");
  await tx.update(conversations).set({ patientId }).where(eq(conversations.id, conversationId));
  await audit(tx, {
    actorUserId: actor.userId,
    action: "whatsapp.link_patient",
    entityType: "conversation",
    entityId: conversationId,
    metadata: { patientId, phoneDiffers: p.phone !== c.phone },
  });
  return p;
}

/** Creates a new patient from a WhatsApp contact (marked "needs completion"). */
export async function createPatientFromConversation(
  tx: TenantTx,
  actor: Actor,
  input: {
    conversationId: string;
    fullNameAr: string;
    gender: "male" | "female";
    filePrefix: string;
  },
) {
  assertCan(actor.roles, "whatsapp:inbox");
  assertCan(actor.roles, "patients:edit");
  const [c] = await tx
    .select()
    .from(conversations)
    .where(eq(conversations.id, input.conversationId));
  if (!c) throw new WhatsAppError("not_found");
  if (c.patientId) throw new WhatsAppError("already_linked");
  const [p] = await tx
    .insert(patients)
    .values({
      tenantId: actor.tenantId,
      fileNumber: await nextFileNumber(tx, input.filePrefix),
      fullNameAr: input.fullNameAr.trim(),
      phone: c.phone,
      gender: input.gender,
      isFake: true,
      createdVia: "whatsapp",
      needsCompletion: true,
    })
    .returning();
  await tx.update(conversations).set({ patientId: p.id }).where(eq(conversations.id, c.id));
  await audit(tx, {
    actorUserId: actor.userId,
    action: "patient.create",
    entityType: "patient",
    entityId: p.id,
    metadata: { via: "whatsapp_contact", conversationId: c.id },
  });
  return p;
}

/** Reception records (or withdraws) the patient's WhatsApp consent, e.g. said at the desk. */
export async function setWhatsappConsent(
  tx: TenantTx,
  actor: Actor,
  patientId: string,
  input: { optIn: boolean; language?: "ar" | "en" },
) {
  assertCan(actor.roles, "whatsapp:inbox");
  const [p] = await tx
    .update(patients)
    .set(
      input.optIn
        ? {
            whatsappOptInAt: sql`now()`,
            whatsappOptInSource: "reception",
            whatsappOptedOutAt: null,
            ...(input.language ? { preferredLanguage: input.language } : {}),
          }
        : {
            whatsappOptedOutAt: sql`now()`,
            ...(input.language ? { preferredLanguage: input.language } : {}),
          },
    )
    .where(eq(patients.id, patientId))
    .returning();
  if (!p) throw new WhatsAppError("not_found");
  if (input.optIn) {
    await tx
      .update(conversations)
      .set({ optedOutAt: null })
      .where(eq(conversations.phone, p.phone));
  }
  await audit(tx, {
    actorUserId: actor.userId,
    action: input.optIn ? "whatsapp.opt_in" : "whatsapp.opt_out",
    entityType: "patient",
    entityId: patientId,
    metadata: { source: "reception", language: input.language ?? null },
  });
  return p;
}

/**
 * "Doctor running late (X min)": every patient of that doctor still to come today gets a message.
 * One tap = one batch (a second tap with a new delay sends again; the same tap never twice).
 */
export async function doctorRunningLate(
  tenant: Tenant,
  actor: Actor,
  input: { memberId: string; day: string; minutes: number; batchId?: string },
) {
  assertCan(actor.roles, "appointments:manage");
  const batchId = input.batchId ?? randomUUID();
  const [from, to] = dayRange(input.day);
  const now = new Date();
  const affected = await withTenant(tenant.id, async (tx) => {
    const rows = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.practitionerId, input.memberId),
          inArray(appointments.status, ["booked", "confirmed"]),
          gte(appointments.startsAt, from > now ? from : now),
          sql`${appointments.startsAt} < ${to.toISOString()}::timestamptz`,
        ),
      )
      .orderBy(asc(appointments.startsAt));
    await audit(tx, {
      actorUserId: actor.userId,
      action: "whatsapp.running_late",
      entityType: "tenant_member",
      entityId: input.memberId,
      metadata: { day: input.day, minutes: input.minutes, appointments: rows.length, batchId },
    });
    return rows;
  });
  let sent = 0;
  for (const a of affected) {
    const r = await sendRunningLate(tenant, a.id, input.minutes, batchId);
    if (r.outcome === "sent") sent++;
  }
  return { affected: affected.length, sent };
}

/** Demo simulator: the patient opened the chat → outgoing messages show as read. */
export async function markDemoThreadRead(tx: TenantTx, conversationId: string) {
  await tx
    .update(messages)
    .set({ status: "read", statusAt: sql`now()` })
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, "out"),
        eq(messages.channel, "demo"),
        inArray(messages.status, ["sent", "delivered"]),
      ),
    );
}
