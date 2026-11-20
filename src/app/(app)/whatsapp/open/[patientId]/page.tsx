import { notFound, redirect } from "next/navigation";
import { desc, eq, or } from "drizzle-orm";
import { conversations, patients } from "@/db/schema";
import { withActor } from "@/lib/auth/db";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { waLink } from "@/lib/front-desk/contact";

const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * One-tap WhatsApp for a patient: their chat in the clinic's inbox (the clinic's own number,
 * kept on record). No chat yet → WhatsApp on this device, to the patient's mobile.
 */
export default async function OpenWhatsApp({
  params,
}: {
  params: Promise<{ patientId: string }>;
}) {
  const ctx = await requirePermission("whatsapp:inbox");
  const { patientId } = await params;
  if (!UUID_RE.test(patientId)) notFound();
  const found = await withActor(actorOf(ctx), async (tx) => {
    const [p] = await tx
      .select({ id: patients.id, phone: patients.phone })
      .from(patients)
      .where(eq(patients.id, patientId));
    if (!p) return null;
    const [c] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(or(eq(conversations.patientId, p.id), eq(conversations.phone, p.phone)))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(1);
    return { phone: p.phone, conversationId: c?.id ?? null };
  });
  if (!found) notFound();
  redirect(found.conversationId ? `/whatsapp?f=all&c=${found.conversationId}` : waLink(found.phone));
}
