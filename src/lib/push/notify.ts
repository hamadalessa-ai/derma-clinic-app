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
import { eq, inArray, isNull, or } from "drizzle-orm";
import webpush from "web-push";
import {
  appointments,
  notificationPrefs,
  patients,
  pushLog,
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

/** Splits recipients by their own choices. No row = everything on. */
export async function applyPrefs(tx: TenantTx, userIds: string[], type: PushType) {
  const prefs = userIds.length
    ? await tx.select().from(notificationPrefs).where(inArray(notificationPrefs.userId, userIds))
    : [];
  const allowed: string[] = [];
  const blocked: { userId: string; outcome: "switched_off" | "type_muted" }[] = [];
  for (const u of userIds) {
    const p = prefs.find((x) => x.userId === u);
    if (p && !p.enabled) blocked.push({ userId: u, outcome: "switched_off" });
    else if (p && p.mutedTypes.includes(type)) blocked.push({ userId: u, outcome: "type_muted" });
    else allowed.push(u);
  }
  return { allowed, blocked };
}

export async function filterByPrefs(tx: TenantTx, userIds: string[], type: PushType) {
  return (await applyPrefs(tx, userIds, type)).allowed;
}

export interface PlannedPush {
  subscriptionId: string;
  userId: string;
  type: PushType;
  appointmentId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  payload: ReturnType<typeof buildPayload>;
}

export type PushLogEntry = Omit<typeof pushLog.$inferInsert, "id" | "tenantId" | "createdAt">;

/** Works out every notification to send for these events (no sending), and who gets none and why. */
export async function planPushes(tx: TenantTx, events: PushEvent[]) {
  const planned: PlannedPush[] = [];
  const skipped: PushLogEntry[] = [];
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
    const recipients = (await recipientsFor(tx, row, ev.type)).filter((u) => u !== ev.actorUserId);
    const base = { type: ev.type, appointmentId: ev.appointmentId };
    if (!recipients.length) {
      skipped.push({ ...base, userId: null, outcome: "no_recipient" });
      continue;
    }
    const { allowed, blocked } = await applyPrefs(tx, recipients, ev.type);
    for (const b of blocked) skipped.push({ ...base, userId: b.userId, outcome: b.outcome });
    if (!allowed.length) continue;
    const subs = await tx
      .select()
      .from(pushSubscriptions)
      .where(inArray(pushSubscriptions.userId, allowed));
    for (const u of allowed) {
      if (!subs.some((s) => s.userId === u)) {
        skipped.push({ ...base, userId: u, outcome: "no_device" });
      }
    }
    const payload = buildPayload({ type: ev.type, appointmentId: ev.appointmentId, ...row });
    for (const s of subs) {
      planned.push({
        subscriptionId: s.id,
        userId: s.userId,
        type: ev.type,
        appointmentId: ev.appointmentId,
        endpoint: s.endpoint,
        keys: { p256dh: s.p256dh, auth: s.auth },
        payload,
      });
    }
  }
  return { planned, skipped };
}

/** One device: send, and say what happened (for the log). */
async function sendOne(
  p: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: unknown,
  vapid: NonNullable<ReturnType<typeof vapidConfig>>,
): Promise<{
  outcome: "sent" | "failed" | "device_gone" | "demo_device";
  statusCode: number | null;
  reason: string | null;
}> {
  // The seeded demo device never receives anything.
  if (new URL(p.endpoint).hostname === DEMO_PUSH_HOST) {
    return { outcome: "demo_device", statusCode: null, reason: "demo device (never contacted)" };
  }
  try {
    const res = await webpush.sendNotification(
      { endpoint: p.endpoint, keys: p.keys },
      JSON.stringify(payload),
      { vapidDetails: vapid, TTL: 60 * 60, urgency: "high" },
    );
    return { outcome: "sent", statusCode: res.statusCode, reason: null };
  } catch (err) {
    const e = err as { statusCode?: number; body?: string; message?: string };
    const status = e.statusCode ?? null;
    return {
      outcome: status === 404 || status === 410 ? "device_gone" : "failed",
      statusCode: status,
      reason: (e.body || e.message || String(err)).slice(0, 300),
    };
  }
}

/** Where the push went is the push service's host (e.g. web.push.apple.com) — never the full URL. */
const serviceOf = (endpoint: string) => {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return "?";
  }
};

async function writeLog(tenantId: string, entries: PushLogEntry[]) {
  if (!entries.length) return;
  await withTenant(tenantId, (tx) =>
    tx.insert(pushLog).values(entries.map((e) => ({ ...e, tenantId }))),
  ).catch((err) => console.warn("push log failed", err));
}

/**
 * Plans and sends. Gone subscriptions (404/410) are removed. Every outcome — sent, failed (with
 * the push service's answer), no device, switched off, no keys — goes to the push log.
 */
export async function sendPushEvents(
  tenantId: string,
  events: PushEvent[],
  env: Env = process.env,
) {
  const vapid = vapidConfig(env);
  const { planned, skipped } = await withTenant(tenantId, (tx) => planPushes(tx, events));
  const result = { planned: planned.length, sent: 0, removed: 0, skipped: 0 };
  const log: PushLogEntry[] = [...skipped];
  if (!vapid) {
    result.skipped = planned.length;
    for (const p of planned) {
      log.push({
        type: p.type,
        appointmentId: p.appointmentId,
        userId: p.userId,
        outcome: "no_keys",
        reason: "VAPID keys are not set in Vercel",
      });
    }
    await writeLog(tenantId, log);
    return result;
  }
  const outcomes = await Promise.all(planned.map((p) => sendOne(p, p.payload, vapid)));
  const gone: string[] = [];
  planned.forEach((p, i) => {
    const o = outcomes[i];
    if (o.outcome === "sent") result.sent++;
    if (o.outcome === "demo_device") result.skipped++;
    if (o.outcome === "device_gone") gone.push(p.subscriptionId);
    if (o.outcome === "failed") console.warn("push failed", o.statusCode, o.reason);
    log.push({
      type: p.type,
      appointmentId: p.appointmentId,
      userId: p.userId,
      outcome: o.outcome,
      statusCode: o.statusCode,
      reason: o.outcome === "sent" ? serviceOf(p.endpoint) : o.reason,
    });
  });
  if (gone.length) {
    await withTenant(tenantId, (tx) =>
      tx.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone)),
    );
    result.removed = gone.length;
  }
  const sentIds = planned
    .filter((p, i) => outcomes[i].outcome === "sent")
    .map((p) => p.subscriptionId);
  if (sentIds.length) {
    await withTenant(tenantId, (tx) =>
      tx
        .update(pushSubscriptions)
        .set({ lastUsedAt: new Date() })
        .where(inArray(pushSubscriptions.id, sentIds)),
    );
  }
  await writeLog(tenantId, log);
  return result;
}

/** Call AFTER a change has been saved: notifications go out once the response is sent. */
export function notifyLater(tenantId: string, events: PushEvent[]) {
  if (!events.length) return;
  after(() =>
    sendPushEvents(tenantId, events).catch((err) => console.warn("push notify failed", err)),
  );
}

/** A test notification to the user's own devices (from "My account"). Logged like the others. */
export async function sendTestPush(tenantId: string, userId: string, env: Env = process.env) {
  const vapid = vapidConfig(env);
  const subs = await withTenant(tenantId, (tx) =>
    tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)),
  );
  const base = { type: "test", appointmentId: null, userId };
  if (!subs.length) {
    await writeLog(tenantId, [{ ...base, outcome: "no_device" }]);
    return { sent: 0, devices: 0 };
  }
  if (!vapid) {
    await writeLog(tenantId, [
      { ...base, outcome: "no_keys", reason: "VAPID keys are not set in Vercel" },
    ]);
    return { sent: 0, devices: subs.length };
  }
  const payload = {
    title: "إشعار تجريبي · Test notification",
    body: "الإشعارات تعمل على هذا الجهاز ✓",
    url: "/account",
    tag: `test-${Date.now()}`,
  };
  const outcomes = await Promise.all(
    subs.map((s) =>
      sendOne({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, vapid),
    ),
  );
  const gone = subs.filter((_, i) => outcomes[i].outcome === "device_gone").map((s) => s.id);
  if (gone.length) {
    await withTenant(tenantId, (tx) =>
      tx.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone)),
    );
  }
  await writeLog(
    tenantId,
    outcomes.map((o, i) => ({
      ...base,
      outcome: o.outcome,
      statusCode: o.statusCode,
      reason: o.outcome === "sent" ? serviceOf(subs[i].endpoint) : o.reason,
    })),
  );
  return {
    sent: outcomes.filter((o) => o.outcome === "sent").length,
    devices: subs.length - gone.length,
  };
}
