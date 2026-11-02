import "server-only";
/**
 * Staff Web Push. Sent AFTER the response (next/server `after`), so a slow push service never
 * slows down booking. Works on the Vercel free plan (no queue needed).
 *
 * Who gets what:
 *  - the doctor of the appointment: new booking, cancellation, reschedule, check-in, request answer;
 *  - receptionists of that branch: new online booking, patient-page cancel/reschedule, doctor requests.
 * Each staff member can switch notifications off, or switch off single types (notification_prefs).
 * Nobody is notified about their own action. Keys come from VAPID_* environment variables;
 * without them nothing is sent.
 */
import { after } from "next/server";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import webpush from "web-push";
import {
  appointments,
  notificationPrefs,
  patients,
  pushSubscriptions,
  services,
  tenantMembers,
} from "@/db/schema";
import { withTenant, type TenantTx } from "@/db/tenant";
import { buildPayload, DEMO_PUSH_HOST, DOCTOR_TYPES, SHARED_TYPES, type PushType } from "./payload";

export interface PushEvent {
  type: PushType;
  appointmentId: string;
  /** Who caused it (not notified about their own action). */
  actorUserId?: string | null;
}

type Env = Record<string, string | undefined>;

export function vapidConfig(env: Env = process.env) {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  const subject = env.VAPID_SUBJECT?.trim() || "mailto:demo@example.com";
  return { publicKey, privateKey, subject };
}

/** Staff user ids who should get this event (before personal preferences). */
export async function recipientsFor(
  tx: TenantTx,
  appt: { practitionerId: string; branchId: string },
  type: PushType,
): Promise<string[]> {
  const doctor = async () => {
    const [doc] = await tx
      .select({ userId: tenantMembers.userId })
      .from(tenantMembers)
      .where(eq(tenantMembers.id, appt.practitionerId));
    return doc ? [doc.userId] : [];
  };
  const reception = async () => {
    const members = await tx
      .select({ userId: tenantMembers.userId, roles: tenantMembers.roles })
      .from(tenantMembers)
      .where(or(isNull(tenantMembers.branchId), eq(tenantMembers.branchId, appt.branchId)));
    return members.filter((m) => m.roles.includes("receptionist")).map((m) => m.userId);
  };
  if ((DOCTOR_TYPES as readonly string[]).includes(type)) return doctor();
  if ((SHARED_TYPES as readonly string[]).includes(type)) {
    return [...new Set([...(await doctor()), ...(await reception())])];
  }
  return reception();
}

/** Applies each person's on/off switch and muted types. No row = everything on. */
export async function filterByPrefs(tx: TenantTx, userIds: string[], type: PushType) {
  if (!userIds.length) return [];
  const prefs = await tx
    .select()
    .from(notificationPrefs)
    .where(inArray(notificationPrefs.userId, userIds));
  return userIds.filter((u) => {
    const p = prefs.find((x) => x.userId === u);
    return !p || (p.enabled && !p.mutedTypes.includes(type));
  });
}

export interface PlannedPush {
  subscriptionId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  payload: ReturnType<typeof buildPayload>;
}

/** Works out every notification to send for these events (no sending). */
export async function planPushes(tx: TenantTx, events: PushEvent[]): Promise<PlannedPush[]> {
  const out: PlannedPush[] = [];
  for (const ev of events) {
    const [row] = await tx
      .select({
        practitionerId: appointments.practitionerId,
        branchId: appointments.branchId,
        startsAt: appointments.startsAt,
        patientName: patients.fullNameAr,
        serviceName: services.nameAr,
      })
      .from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .where(eq(appointments.id, ev.appointmentId));
    if (!row) continue;
    const users = (await filterByPrefs(tx, await recipientsFor(tx, row, ev.type), ev.type)).filter(
      (u) => u !== ev.actorUserId,
    );
    if (!users.length) continue;
    const subs = await tx
      .select()
      .from(pushSubscriptions)
      .where(inArray(pushSubscriptions.userId, users));
    const payload = buildPayload({ type: ev.type, appointmentId: ev.appointmentId, ...row });
    for (const s of subs) {
      out.push({
        subscriptionId: s.id,
        endpoint: s.endpoint,
        keys: { p256dh: s.p256dh, auth: s.auth },
        payload,
      });
    }
  }
  return out;
}

/** Plans and sends. Gone subscriptions (404/410) are removed. Returns counts (for tests/logs). */
export async function sendPushEvents(
  tenantId: string,
  events: PushEvent[],
  env: Env = process.env,
) {
  const vapid = vapidConfig(env);
  const planned = await withTenant(tenantId, (tx) => planPushes(tx, events));
  const result = { planned: planned.length, sent: 0, removed: 0, skipped: 0 };
  if (!vapid) {
    result.skipped = planned.length;
    return result;
  }
  const gone: string[] = [];
  await Promise.all(
    planned.map(async (p) => {
      // The seeded demo device never receives anything.
      if (new URL(p.endpoint).hostname === DEMO_PUSH_HOST) {
        result.skipped++;
        return;
      }
      try {
        await webpush.sendNotification(
          { endpoint: p.endpoint, keys: p.keys },
          JSON.stringify(p.payload),
          { vapidDetails: vapid, TTL: 60 * 60, urgency: "high" },
        );
        result.sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(p.subscriptionId);
        else console.warn("push failed", status ?? err);
      }
    }),
  );
  if (gone.length) {
    await withTenant(tenantId, (tx) =>
      tx.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone)),
    );
    result.removed = gone.length;
  }
  const sentIds = planned
    .filter((p) => !gone.includes(p.subscriptionId))
    .map((p) => p.subscriptionId);
  if (result.sent && sentIds.length) {
    await withTenant(tenantId, (tx) =>
      tx
        .update(pushSubscriptions)
        .set({ lastUsedAt: new Date() })
        .where(and(inArray(pushSubscriptions.id, sentIds))),
    );
  }
  return result;
}

/** Call AFTER a change has been saved: notifications go out once the response is sent. */
export function notifyLater(tenantId: string, events: PushEvent[]) {
  if (!events.length) return;
  after(() =>
    sendPushEvents(tenantId, events).catch((err) => console.warn("push notify failed", err)),
  );
}

/** A test notification to the user's own devices (from "My account"). */
export async function sendTestPush(tenantId: string, userId: string, env: Env = process.env) {
  const vapid = vapidConfig(env);
  const subs = await withTenant(tenantId, (tx) =>
    tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)),
  );
  if (!vapid) return { sent: 0, devices: subs.length };
  let sent = 0;
  const gone: string[] = [];
  for (const s of subs) {
    if (new URL(s.endpoint).hostname === DEMO_PUSH_HOST) continue;
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({
          title: "إشعار تجريبي · Test notification",
          body: "الإشعارات تعمل على هذا الجهاز ✓",
          url: "/account",
          tag: "test",
        }),
        { vapidDetails: vapid, TTL: 600 },
      );
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) gone.push(s.id);
    }
  }
  if (gone.length) {
    await withTenant(tenantId, (tx) =>
      tx.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone)),
    );
  }
  return { sent, devices: subs.length - gone.length };
}
