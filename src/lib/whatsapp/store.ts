/**
 * Storing WhatsApp chats: one conversation per phone number in a clinic, and every message in it.
 * Runs inside a clinic transaction (withTenant); the clinic comes from the transaction itself.
 */
import { asc, eq, sql } from "drizzle-orm";
import { conversations, messages, patients } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";

const CURRENT_TENANT = sql`public.app_current_tenant()`;

/** The patient a phone number belongs to: the adult when a family shares one number. */
export async function patientForPhone(tx: TenantTx, phone: string) {
  const [p] = await tx
    .select()
    .from(patients)
    .where(eq(patients.phone, phone))
    .orderBy(sql`${patients.guardianId} is not null`, asc(patients.createdAt))
    .limit(1);
  return p ?? null;
}

/** The chat for this number (created if new; linked to the patient with that number if known). */
export async function ensureConversation(
  tx: TenantTx,
  input: { phone: string; profileName?: string | null },
) {
  const [existing] = await tx
    .select()
    .from(conversations)
    .where(eq(conversations.phone, input.phone))
    .limit(1);
  if (existing) {
    if (!existing.patientId) {
      const p = await patientForPhone(tx, input.phone);
      if (p) {
        const [linked] = await tx
          .update(conversations)
          .set({ patientId: p.id })
          .where(eq(conversations.id, existing.id))
          .returning();
        return linked;
      }
    }
    if (input.profileName && input.profileName !== existing.profileName) {
      await tx
        .update(conversations)
        .set({ profileName: input.profileName.slice(0, 80) })
        .where(eq(conversations.id, existing.id));
    }
    return existing;
  }
  const p = await patientForPhone(tx, input.phone);
  const [row] = await tx
    .insert(conversations)
    .values({
      tenantId: CURRENT_TENANT,
      phone: input.phone,
      patientId: p?.id ?? null,
      profileName: input.profileName?.slice(0, 80) ?? null,
    })
    .onConflictDoUpdate({
      target: [conversations.tenantId, conversations.phone],
      set: { lastMessageAt: sql`now()` },
    })
    .returning();
  return row;
}

export type NewMessage = Omit<typeof messages.$inferInsert, "tenantId">;

/** Saves a message and updates the chat (last activity, 24-hour window, "needs reply"). */
export async function recordMessage(tx: TenantTx, msg: NewMessage & { needsReply?: boolean }) {
  const { needsReply, ...values } = msg;
  const [row] = await tx
    .insert(messages)
    .values({ ...values, tenantId: CURRENT_TENANT })
    .returning();
  await tx
    .update(conversations)
    .set({
      lastMessageAt: sql`now()`,
      ...(msg.direction === "in" ? { lastInboundAt: sql`now()` } : {}),
      ...(needsReply !== undefined ? { needsReply } : {}),
    })
    .where(eq(conversations.id, msg.conversationId));
  return row;
}
