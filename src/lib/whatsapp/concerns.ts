/**
 * Post-care concerns ("I have a concern" on a post-care WhatsApp message), for the clinical side:
 *  - My Day: the doctor's OPEN concerns about their own patients' visits;
 *  - the patient's file: the concern and the post-care conversation, read-only.
 * Doctors and reception act on it (src/lib/whatsapp/concern-actions.ts). A concern is OPEN until
 * someone marks it resolved, for up to 14 days.
 * Reads only: nothing here changes a record.
 */
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import {
  appointments,
  concernEvents,
  conversations,
  messages,
  patients,
  services,
  tenantMembers,
  users,
} from "@/db/schema";
import type { TenantTx } from "@/db/tenant";

export const CONCERN_OPEN_DAYS = 14;

export interface Concern {
  messageId: string;
  conversationId: string;
  appointmentId: string;
  patientId: string;
  practitionerId: string;
  serviceId: string;
  patientNameAr: string;
  patientNameEn: string | null;
  fileNumber: string;
  serviceNameAr: string;
  serviceNameEn: string;
  doctorNameAr: string;
  doctorNameEn: string | null;
  visitAt: Date;
  raisedAt: Date;
  open: boolean;
}

/**
 * Concerns tied to a visit, newest first, one per visit (the latest tap).
 * Filter by the visit's doctor (My Day), the patient (file) and/or one visit.
 */
export async function findConcerns(
  tx: TenantTx,
  where: {
    practitionerId?: string;
    patientId?: string;
    appointmentId?: string;
    conversationId?: string;
    openOnly?: boolean;
  },
  now = new Date(),
): Promise<Concern[]> {
  const since = new Date(now.getTime() - (where.openOnly ? CONCERN_OPEN_DAYS : 365) * 86_400_000);
  const rows = await tx
    .select({
      m: messages,
      a: {
        id: appointments.id,
        patientId: appointments.patientId,
        practitionerId: appointments.practitionerId,
        serviceId: appointments.serviceId,
        startsAt: appointments.startsAt,
      },
      p: {
        nameAr: patients.fullNameAr,
        nameEn: patients.fullNameEn,
        fileNumber: patients.fileNumber,
      },
      s: { nameAr: services.nameAr, nameEn: services.nameEn },
      d: { nameAr: users.name, nameEn: users.nameEn },
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(appointments, eq(appointments.id, messages.appointmentId))
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(tenantMembers, eq(tenantMembers.id, appointments.practitionerId))
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(
      and(
        eq(messages.flag, "concern"),
        eq(messages.direction, "in"),
        gte(messages.createdAt, since),
        where.practitionerId ? eq(appointments.practitionerId, where.practitionerId) : undefined,
        where.patientId ? eq(appointments.patientId, where.patientId) : undefined,
        where.appointmentId ? eq(appointments.id, where.appointmentId) : undefined,
        where.conversationId ? eq(messages.conversationId, where.conversationId) : undefined,
      ),
    )
    .orderBy(desc(messages.createdAt));
  if (!rows.length) return [];

  // "Mark resolved" closes a concern (a resolution after the patient's latest concern tap).
  const resolved = await tx
    .select({ appointmentId: concernEvents.appointmentId, createdAt: concernEvents.createdAt })
    .from(concernEvents)
    .where(
      and(
        eq(concernEvents.kind, "resolved"),
        inArray(concernEvents.appointmentId, [...new Set(rows.map((r) => r.a.id))]),
      ),
    );
  const seen = new Set<string>();
  const out: Concern[] = [];
  for (const r of rows) {
    if (seen.has(r.a.id)) continue;
    seen.add(r.a.id);
    const resolution = resolved
      .filter((x) => x.appointmentId === r.a.id && x.createdAt >= r.m.createdAt)
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0];
    const open =
      !resolution && now.getTime() - r.m.createdAt.getTime() < CONCERN_OPEN_DAYS * 86_400_000;
    if (where.openOnly && !open) continue;
    out.push({
      messageId: r.m.id,
      conversationId: r.m.conversationId,
      appointmentId: r.a.id,
      patientId: r.a.patientId,
      practitionerId: r.a.practitionerId,
      serviceId: r.a.serviceId,
      patientNameAr: r.p.nameAr,
      patientNameEn: r.p.nameEn,
      fileNumber: r.p.fileNumber,
      serviceNameAr: r.s.nameAr,
      serviceNameEn: r.s.nameEn,
      doctorNameAr: r.d.nameAr,
      doctorNameEn: r.d.nameEn,
      visitAt: r.a.startsAt,
      raisedAt: r.m.createdAt,
      open,
    });
  }
  return out;
}

/**
 * The conversation around a concern: from the post-care message for that visit (or a day before
 * the concern) up to now — post-care question, the patient's answers, the clinic's replies.
 */
export async function concernThread(tx: TenantTx, concern: Concern) {
  const [postCare] = await tx
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(
      and(
        eq(messages.appointmentId, concern.appointmentId),
        eq(messages.kind, "post_care"),
        eq(messages.conversationId, concern.conversationId),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);
  const from = postCare?.createdAt ?? new Date(concern.raisedAt.getTime() - 86_400_000);
  return tx
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, concern.conversationId), gte(messages.createdAt, from)))
    .orderBy(asc(messages.createdAt))
    .limit(60);
}
