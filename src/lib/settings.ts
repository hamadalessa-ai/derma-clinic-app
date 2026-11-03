import { eq } from "drizzle-orm";
import { services, tenantMembers, tenantSettings } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";

export interface SettingsInput {
  doctorsManageOwnSchedule?: boolean;
  onlineBookingEnabled?: boolean;
  onlineHorizonDays?: number;
  onlineMinNoticeMinutes?: number;
  cancellationWindowHours?: number;
  onlineRequiresApproval?: boolean;
  showPricesOnline?: boolean;
  showServiceInMessages?: boolean;
  aiReceptionistEnabled?: boolean;
  aiDailyLimit?: number;
}

/** Changes clinic settings (only the fields given). Admins only; audited. */
export async function updateSettings(tx: TenantTx, actor: Actor, input: SettingsInput) {
  assertCan(actor.roles, "settings:manage");
  const changes = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  if (Object.keys(changes).length === 0) return null;
  const [row] = await tx.update(tenantSettings).set(changes).returning();
  await audit(tx, {
    actorUserId: actor.userId,
    action: "settings.update",
    entityType: "tenant_settings",
    entityId: actor.tenantId,
    metadata: changes,
  });
  return row;
}

/** Switches online booking on/off for one service. */
export async function setServiceOnline(
  tx: TenantTx,
  actor: Actor,
  serviceId: string,
  online: boolean,
) {
  assertCan(actor.roles, "settings:manage");
  const [row] = await tx
    .update(services)
    .set({ onlineBookable: online })
    .where(eq(services.id, serviceId))
    .returning({ id: services.id });
  if (!row) return null;
  await audit(tx, {
    actorUserId: actor.userId,
    action: "service.online",
    entityType: "service",
    entityId: serviceId,
    metadata: { online },
  });
  return row;
}

/** A staff member's gender (used for the "female / male doctor" choice online). */
export async function setMemberGender(
  tx: TenantTx,
  actor: Actor,
  memberId: string,
  gender: "male" | "female" | null,
) {
  assertCan(actor.roles, "settings:manage");
  const [row] = await tx
    .update(tenantMembers)
    .set({ gender })
    .where(eq(tenantMembers.id, memberId))
    .returning({ id: tenantMembers.id });
  if (!row) return null;
  await audit(tx, {
    actorUserId: actor.userId,
    action: "member.gender",
    entityType: "tenant_member",
    entityId: memberId,
    metadata: { gender },
  });
  return row;
}
