/**
 * Staff devices and notification choices. A device belongs to whoever subscribed it last
 * (a shared reception tablet moves to the person signed in now).
 */
import { and, eq, sql } from "drizzle-orm";
import { notificationPrefs, pushSubscriptions } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import { ALL_PUSH_TYPES, type PushType } from "./payload";

export interface DeviceSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}

/** Runs in a clinic transaction WITHOUT a user (the device may still belong to someone else). */
export async function saveSubscription(
  tx: TenantTx,
  input: { tenantId: string; userId: string; sub: DeviceSubscription },
) {
  await tx
    .insert(pushSubscriptions)
    .values({
      tenantId: input.tenantId,
      userId: input.userId,
      endpoint: input.sub.endpoint,
      p256dh: input.sub.p256dh,
      auth: input.sub.auth,
      userAgent: input.sub.userAgent?.slice(0, 200) ?? null,
    })
    .onConflictDoUpdate({
      target: [pushSubscriptions.tenantId, pushSubscriptions.endpoint],
      set: {
        userId: input.userId,
        p256dh: input.sub.p256dh,
        auth: input.sub.auth,
        userAgent: input.sub.userAgent?.slice(0, 200) ?? null,
      },
    });
  await audit(tx, {
    actorUserId: input.userId,
    action: "push.subscribe",
    entityType: "push_subscription",
    metadata: { userAgent: input.sub.userAgent?.slice(0, 80) ?? null },
  });
}

/** Runs as the signed-in user: they can only remove their own devices. */
export async function removeSubscription(tx: TenantTx, userId: string, endpoint: string) {
  const rows = await tx
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)))
    .returning({ id: pushSubscriptions.id });
  if (rows.length) {
    await audit(tx, {
      actorUserId: userId,
      action: "push.unsubscribe",
      entityType: "push_subscription",
      entityId: rows[0].id,
    });
  }
  return rows.length;
}

export async function getPrefs(tx: TenantTx, userId: string) {
  const [p] = await tx.select().from(notificationPrefs).where(eq(notificationPrefs.userId, userId));
  return { enabled: p?.enabled ?? true, mutedTypes: (p?.mutedTypes ?? []) as PushType[] };
}

export async function savePrefs(
  tx: TenantTx,
  input: { tenantId: string; userId: string; enabled: boolean; mutedTypes: string[] },
) {
  const muted = input.mutedTypes.filter((t): t is PushType =>
    (ALL_PUSH_TYPES as readonly string[]).includes(t),
  );
  await tx
    .insert(notificationPrefs)
    .values({
      tenantId: input.tenantId,
      userId: input.userId,
      enabled: input.enabled,
      mutedTypes: muted,
    })
    .onConflictDoUpdate({
      target: [notificationPrefs.tenantId, notificationPrefs.userId],
      set: { enabled: input.enabled, mutedTypes: muted, updatedAt: sql`now()` },
    });
  await audit(tx, {
    actorUserId: input.userId,
    action: "notification_prefs.update",
    entityType: "notification_prefs",
    metadata: { enabled: input.enabled, mutedTypes: muted },
  });
}

export async function countDevices(tx: TenantTx, userId: string) {
  const rows = await tx
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  return rows.length;
}
