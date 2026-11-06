import "server-only";
/**
 * Platform owner → change a clinic's status (active / read-only / suspended / closed) with a reason.
 * Done by the database function app_set_clinic_status(), which checks again that the caller is a
 * platform owner. Recorded in the clinic's own audit log, so the clinic sees who and why.
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { audit } from "@/lib/audit";
import { assertCan, type Role } from "@/lib/auth/permissions";
import type { ClinicStatus } from "@/lib/tenant/status";

export async function setClinicStatus(
  owner: { userId: string; roles: readonly Role[] },
  tenantId: string,
  status: ClinicStatus,
  reason: string | null,
) {
  assertCan(owner.roles, "platform:clinics");
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('app.user_id', ${owner.userId}, true),
      set_config('app.tenant_id', ${tenantId}, true)`);
    const rows = await tx.execute<{ old: ClinicStatus }>(
      sql`select public.app_set_clinic_status(${tenantId}::uuid, ${status}::public.clinic_status, ${reason ?? ""}) as old`,
    );
    const from = rows[0]?.old ?? null;
    await audit(tx, {
      actorUserId: owner.userId,
      action: "clinic.status",
      entityType: "tenant",
      entityId: tenantId,
      metadata: { from, to: status, reason: reason?.trim() || null },
    });
    return { from, to: status };
  });
}

/** Platform owner → the clinic's monthly AI and WhatsApp limits (null = no limit). Audited. */
export async function setClinicLimits(
  owner: { userId: string; roles: readonly Role[] },
  tenantId: string,
  limits: { aiMonthly: number | null; whatsappMonthly: number | null },
) {
  assertCan(owner.roles, "platform:clinics");
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('app.user_id', ${owner.userId}, true),
      set_config('app.tenant_id', ${tenantId}, true)`);
    await tx.execute(
      sql`select public.app_set_clinic_limits(${tenantId}::uuid, ${limits.aiMonthly}::integer, ${limits.whatsappMonthly}::integer)`,
    );
    await audit(tx, {
      actorUserId: owner.userId,
      action: "clinic.limits",
      entityType: "tenant",
      entityId: tenantId,
      metadata: limits,
    });
  });
}
