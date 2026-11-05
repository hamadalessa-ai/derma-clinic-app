/**
 * Reception's ONE inbox: WhatsApp chats that need a reply, and requests waiting for a decision
 * (doctors' reschedule requests, online bookings awaiting approval, follow-up requests).
 */
import { and, count, eq, gt } from "drizzle-orm";
import { appointments, conversations } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { pendingRequests } from "@/lib/visits/reschedule";
import { openFollowUpRequests } from "@/lib/whatsapp/concern-actions";

export async function inboxCounts(tx: TenantTx, now = new Date()) {
  const [[chats], reqs, [pending], followUps] = await Promise.all([
    tx.select({ n: count() }).from(conversations).where(eq(conversations.needsReply, true)),
    pendingRequests(tx),
    tx
      .select({ n: count() })
      .from(appointments)
      .where(and(eq(appointments.status, "pending"), gt(appointments.startsAt, now))),
    openFollowUpRequests(tx),
  ]);
  return {
    messages: Number(chats?.n ?? 0),
    requests: reqs.length + Number(pending?.n ?? 0) + followUps.length,
  };
}
