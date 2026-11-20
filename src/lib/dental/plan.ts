/**
 * Dental treatment plan across visits: procedures (services) per tooth, priced when planned.
 * Doctors and nurses add, finish and cancel items; everyone in the clinic reads the plan
 * (reception books the next step and quotes the estimate). "Done in this visit" also adds the
 * procedure to that visit's invoice lines (lib/visits/visit.ts addCharge — open visits only).
 */
import { and, asc, eq } from "drizzle-orm";
import { dentalPlanItems, services } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";
import { addCharge } from "@/lib/visits/visit";
import { DentalError } from "./chart";
import { isTooth, normalizeSurfaces } from "./teeth";

/** The plan: still to do first (by tooth), then done (latest first), then cancelled. */
export async function planFor(tx: TenantTx, patientId: string) {
  const rows = await tx
    .select()
    .from(dentalPlanItems)
    .where(eq(dentalPlanItems.patientId, patientId))
    .orderBy(asc(dentalPlanItems.createdAt), asc(dentalPlanItems.id));
  const rank = { planned: 0, done: 1, cancelled: 2 } as const;
  return rows.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      (a.status === "done"
        ? (b.doneAt?.getTime() ?? 0) - (a.doneAt?.getTime() ?? 0)
        : (a.tooth ?? 99) - (b.tooth ?? 99)),
  );
}

/** Estimate: planned (still to do) and done, at the copied prices. Cancelled items don't count. */
export function planTotals(items: { status: string; priceHalalas: number }[]) {
  const sum = (st: string) =>
    items.filter((i) => i.status === st).reduce((s, i) => s + i.priceHalalas, 0);
  return { planned: sum("planned"), done: sum("done") };
}

export async function addPlanItem(
  tx: TenantTx,
  actor: Actor,
  input: {
    patientId: string;
    serviceId: string;
    tooth?: number | null;
    surfaces?: string;
    note?: string | null;
  },
) {
  assertCan(actor.roles, "dental:plan");
  if (input.tooth != null && !isTooth(input.tooth)) throw new DentalError("bad_tooth");
  const [svc] = await tx
    .select()
    .from(services)
    .where(and(eq(services.id, input.serviceId), eq(services.isActive, true)));
  if (!svc) throw new DentalError("not_found");
  const [row] = await tx
    .insert(dentalPlanItems)
    .values({
      tenantId: actor.tenantId,
      patientId: input.patientId,
      tooth: input.tooth ?? null,
      surfaces: normalizeSurfaces(input.surfaces ?? ""),
      serviceId: svc.id,
      code: svc.code,
      nameAr: svc.nameAr,
      nameEn: svc.nameEn,
      priceHalalas: svc.priceHalalas,
      note: input.note?.trim() || null,
      createdByUserId: actor.userId,
    })
    .returning();
  await audit(tx, {
    actorUserId: actor.userId,
    action: "dental.plan_add",
    entityType: "dental_plan_item",
    entityId: row.id,
    metadata: { code: svc.code, tooth: row.tooth },
  });
  return row;
}

async function plannedItem(tx: TenantTx, itemId: string) {
  const [item] = await tx
    .select()
    .from(dentalPlanItems)
    .where(eq(dentalPlanItems.id, itemId))
    .for("update");
  if (!item) throw new DentalError("not_found");
  if (item.status !== "planned") throw new DentalError("not_planned");
  return item;
}

/** Done in this (open) visit: marks the item done and adds it to the visit's invoice lines. */
export async function markPlanDone(
  tx: TenantTx,
  actor: Actor,
  input: { itemId: string; appointmentId: string },
) {
  assertCan(actor.roles, "dental:plan");
  const item = await plannedItem(tx, input.itemId);
  await addCharge(tx, actor, {
    appointmentId: input.appointmentId,
    serviceId: item.serviceId,
    quantity: 1,
  });
  const [row] = await tx
    .update(dentalPlanItems)
    .set({ status: "done", doneAt: new Date(), appointmentId: input.appointmentId })
    .where(eq(dentalPlanItems.id, item.id))
    .returning();
  await audit(tx, {
    actorUserId: actor.userId,
    action: "dental.plan_done",
    entityType: "dental_plan_item",
    entityId: item.id,
    metadata: { appointmentId: input.appointmentId },
  });
  return row;
}

export async function cancelPlanItem(tx: TenantTx, actor: Actor, itemId: string) {
  assertCan(actor.roles, "dental:plan");
  const item = await plannedItem(tx, itemId);
  await tx
    .update(dentalPlanItems)
    .set({ status: "cancelled" })
    .where(eq(dentalPlanItems.id, item.id));
  await audit(tx, {
    actorUserId: actor.userId,
    action: "dental.plan_cancel",
    entityType: "dental_plan_item",
    entityId: item.id,
  });
}
