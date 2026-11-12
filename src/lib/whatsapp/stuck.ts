/**
 * Messages stuck as "queued": the send was prepared and stored, but the server stopped before the
 * result was saved (timeout, crash). It may or may not have reached the patient, and it is NEVER
 * resent (at most once). So after STUCK_MINUTES it is marked failed with a clear reason, the chat
 * is flagged for staff to check, and the platform gets an alert.
 */
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { conversations, messages } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { audit } from "@/lib/audit";

export const STUCK_MINUTES = 15;
export const STUCK_ERROR = "stuck_unknown";

export async function sweepStuckMessages(tenantId: string, now: Date = new Date()) {
  return withTenant(tenantId, async (tx) => {
    const stuck = await tx
      .update(messages)
      .set({
        status: "failed",
        errorCode: STUCK_ERROR,
        errorText:
          "Sending was interrupted. It may or may not have reached the patient; it was not sent again.",
        statusAt: sql`now()`,
      })
      .where(
        and(
          eq(messages.direction, "out"),
          eq(messages.status, "queued"),
          lt(messages.createdAt, new Date(now.getTime() - STUCK_MINUTES * 60_000)),
        ),
      )
      .returning({ id: messages.id, conversationId: messages.conversationId, kind: messages.kind });
    if (!stuck.length) return 0;
    const chats = [...new Set(stuck.map((m) => m.conversationId))];
    await tx
      .update(conversations)
      .set({ needsReply: true })
      .where(inArray(conversations.id, chats));
    await audit(tx, {
      actorUserId: null,
      action: "whatsapp.stuck",
      entityType: "message",
      metadata: { count: stuck.length, kinds: [...new Set(stuck.map((m) => m.kind))] },
    });
    return stuck.length;
  });
}
