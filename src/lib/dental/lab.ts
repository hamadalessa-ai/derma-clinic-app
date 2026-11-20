/**
 * Lab cases: work sent to a dental lab (crown, bridge, denture…), its due date and where it is
 * (sent → received → fitted; or remake / cancelled). Everyone in the clinic can follow and
 * update them (reception receives the box and calls the patient).
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { labCases, patients, tenantMembers, users } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";
import { isDay, riyadhDay } from "@/lib/booking/time";
import { DentalError } from "./chart";

export const LAB_WORK = [
  "crown",
  "bridge",
  "veneer",
  "denture",
  "aligner",
  "night_guard",
  "implant_part",
  "other",
] as const;
export type LabWork = (typeof LAB_WORK)[number];
export const LAB_STATUSES = ["sent", "received", "fitted", "remake", "cancelled"] as const;
export type LabStatus = (typeof LAB_STATUSES)[number];
/** Still expected from the lab (counts for "overdue"). */
export const OPEN_LAB = ["sent", "remake"] as const;

/** Where a case may go next. */
const NEXT: Record<LabStatus, readonly LabStatus[]> = {
  sent: ["received", "cancelled"],
  remake: ["received", "cancelled"],
  received: ["fitted", "remake"],
  fitted: [],
  cancelled: [],
};
export const nextLabStatuses = (s: LabStatus) => NEXT[s];

/** Overdue = still at the lab after its due day (Riyadh). */
export function isOverdue(c: { status: string; dueOn: string }, today = riyadhDay(new Date())) {
  return (OPEN_LAB as readonly string[]).includes(c.status) && c.dueOn < today;
}

export async function listLabCases(
  tx: TenantTx,
  actor: Actor,
  filter: { patientId?: string; open?: boolean } = {},
) {
  assertCan(actor.roles, "lab:view");
  return tx
    .select({
      c: labCases,
      patientAr: patients.fullNameAr,
      patientEn: patients.fullNameEn,
      fileNumber: patients.fileNumber,
      phone: patients.phone,
      doctorAr: users.name,
      doctorEn: users.nameEn,
    })
    .from(labCases)
    .innerJoin(patients, eq(patients.id, labCases.patientId))
    .innerJoin(tenantMembers, eq(tenantMembers.id, labCases.practitionerId))
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(
      and(
        filter.patientId ? eq(labCases.patientId, filter.patientId) : undefined,
        filter.open ? inArray(labCases.status, ["sent", "remake", "received"]) : undefined,
      ),
    )
    .orderBy(filter.open ? asc(labCases.dueOn) : desc(labCases.createdAt));
}

export async function createLabCase(
  tx: TenantTx,
  actor: Actor,
  input: {
    patientId: string;
    practitionerId: string;
    appointmentId?: string | null;
    labName: string;
    work: LabWork;
    teeth?: string;
    shade?: string | null;
    sentOn: string;
    dueOn: string;
    notes?: string | null;
  },
) {
  assertCan(actor.roles, "lab:manage");
  if (!isDay(input.sentOn) || !isDay(input.dueOn) || input.dueOn < input.sentOn)
    throw new DentalError("bad_status");
  const [row] = await tx
    .insert(labCases)
    .values({
      tenantId: actor.tenantId,
      patientId: input.patientId,
      practitionerId: input.practitionerId,
      appointmentId: input.appointmentId ?? null,
      labName: input.labName.trim(),
      work: input.work,
      teeth: (input.teeth ?? "").trim(),
      shade: input.shade?.trim() || null,
      sentOn: input.sentOn,
      dueOn: input.dueOn,
      notes: input.notes?.trim() || null,
      createdByUserId: actor.userId,
    })
    .returning();
  await audit(tx, {
    actorUserId: actor.userId,
    action: "lab.create",
    entityType: "lab_case",
    entityId: row.id,
    metadata: { work: row.work, dueOn: row.dueOn },
  });
  return row;
}

export async function setLabStatus(
  tx: TenantTx,
  actor: Actor,
  input: { id: string; status: LabStatus },
) {
  assertCan(actor.roles, "lab:manage");
  const [c] = await tx.select().from(labCases).where(eq(labCases.id, input.id)).for("update");
  if (!c) throw new DentalError("not_found");
  if (!NEXT[c.status].includes(input.status)) throw new DentalError("bad_status");
  const now = new Date();
  const [row] = await tx
    .update(labCases)
    .set({
      status: input.status,
      ...(input.status === "received" ? { receivedAt: now } : {}),
      ...(input.status === "fitted" ? { fittedAt: now } : {}),
    })
    .where(eq(labCases.id, c.id))
    .returning();
  await audit(tx, {
    actorUserId: actor.userId,
    action: "lab.status",
    entityType: "lab_case",
    entityId: c.id,
    metadata: { from: c.status, to: input.status },
  });
  return row;
}
