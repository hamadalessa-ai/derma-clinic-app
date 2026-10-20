import { tenantSettings } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";

export async function updateSettings(
  tx: TenantTx,
  actor: Actor,
  input: { doctorsManageOwnSchedule: boolean },
) {
  assertCan(actor.roles, "settings:manage");
  const [row] = await tx
    .update(tenantSettings)
    .set({ doctorsManageOwnSchedule: input.doctorsManageOwnSchedule })
    .returning();
  await audit(tx, {
    actorUserId: actor.userId,
    action: "settings.update",
    entityType: "tenant_settings",
    entityId: actor.tenantId,
    metadata: input,
  });
  return row;
}
