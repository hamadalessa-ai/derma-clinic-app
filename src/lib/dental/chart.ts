/**
 * The dental chart (clinical): doctors and nurses read it and add to it; reception never sees
 * it (permission + database policy). Every change is a new row — the history stays.
 */
import { and, asc, eq } from "drizzle-orm";
import { dentalChartEntries, departments } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";
import { isTooth, normalizeSurfaces, type ToothCondition } from "./teeth";

export class DentalError extends Error {
  constructor(public code: "bad_tooth" | "empty" | "not_found" | "not_planned" | "bad_status") {
    super(code);
  }
}

/** Does this clinic have a dental department switched on? (Dental screens show only then.) */
export async function dentalEnabled(tx: TenantTx): Promise<boolean> {
  const [d] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.code, "dental"), eq(departments.isActive, true)))
    .limit(1);
  return !!d;
}

export async function chartHistory(tx: TenantTx, actor: Actor, patientId: string) {
  assertCan(actor.roles, "dental:chart");
  return tx
    .select()
    .from(dentalChartEntries)
    .where(eq(dentalChartEntries.patientId, patientId))
    .orderBy(asc(dentalChartEntries.createdAt), asc(dentalChartEntries.id));
}

export async function recordTooth(
  tx: TenantTx,
  actor: Actor,
  input: {
    patientId: string;
    tooth: number;
    condition: ToothCondition;
    surfaces?: string;
    note?: string | null;
    appointmentId?: string | null;
  },
) {
  assertCan(actor.roles, "dental:chart");
  if (!isTooth(input.tooth)) throw new DentalError("bad_tooth");
  const [row] = await tx
    .insert(dentalChartEntries)
    .values({
      tenantId: actor.tenantId,
      patientId: input.patientId,
      tooth: input.tooth,
      condition: input.condition,
      surfaces: normalizeSurfaces(input.surfaces ?? ""),
      note: input.note?.trim() || null,
      appointmentId: input.appointmentId ?? null,
      recordedByUserId: actor.userId,
      recordedByName: actor.name ?? actor.userId,
    })
    .returning();
  // No clinical detail in the audit log: which tooth, not what was found.
  await audit(tx, {
    actorUserId: actor.userId,
    action: "dental.chart",
    entityType: "patient",
    entityId: input.patientId,
    metadata: { tooth: input.tooth },
  });
  return row;
}

/**
 * Several teeth at once (voice charting: the dentist checked the list and tapped Save). One row
 * per tooth, in one transaction — all saved or none. At most a full mouth (32 teeth).
 */
export async function recordTeeth(
  tx: TenantTx,
  actor: Actor,
  input: {
    patientId: string;
    appointmentId?: string | null;
    items: { tooth: number; condition: ToothCondition; surfaces?: string }[];
  },
) {
  assertCan(actor.roles, "dental:chart");
  if (!input.items.length) throw new DentalError("empty");
  if (
    input.items.length > 32 ||
    new Set(input.items.map((i) => i.tooth)).size !== input.items.length
  )
    throw new DentalError("bad_tooth");
  const rows = [];
  for (const item of input.items) {
    rows.push(
      await recordTooth(tx, actor, {
        patientId: input.patientId,
        appointmentId: input.appointmentId ?? null,
        tooth: item.tooth,
        condition: item.condition,
        surfaces: item.surfaces,
      }),
    );
  }
  return rows;
}
