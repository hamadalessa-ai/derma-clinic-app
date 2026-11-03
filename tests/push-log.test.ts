/**
 * The WhatsApp "I have a concern" push, sent from the SAME path the simulator uses, and the push log
 * the admin sees: sent / failed / device gone / no device / switched off / type muted / no keys.
 * The push service is replaced by a spy (no real network).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import webpush from "web-push";
import { closeDb } from "@/db/client";
import { messages, notificationPrefs, patients, pushLog, pushSubscriptions } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { withActor } from "@/lib/auth/db";
import { bookAppointment, type Appointment } from "@/lib/booking/engine";
import { buildPayload } from "@/lib/push/payload";
import { sendPushEvents, sendTestPush } from "@/lib/push/notify";
import { savePrefs, saveSubscription } from "@/lib/push/subscriptions";
import { generateVapidKeys } from "@/lib/push/vapid";
import { handleInbound } from "@/lib/whatsapp/inbound";
import { sendPostCare } from "@/lib/whatsapp/outbox";
import { DERMA, member, patient, reception, riyadhAt, RIYADH, service } from "./fixtures";

const system = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(DERMA, fn);
const derma = { id: DERMA, slug: "derma", isDemo: true };
const SARA = "usr_derma-dr-sara";
const KEY =
  "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
let ENV: Record<string, string | undefined>;

beforeAll(async () => {
  const keys = await generateVapidKeys();
  ENV = {
    ...process.env,
    MESSAGE_DEMO_MODE: "on",
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
  };
});
afterEach(() => vi.restoreAllMocks());
afterAll(closeDb);

async function clearDevices(userId: string) {
  await system((tx) => tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)));
}
const device = (userId: string, endpoint: string) =>
  system((tx) =>
    saveSubscription(tx, {
      tenantId: DERMA,
      userId,
      sub: { endpoint, p256dh: KEY, auth: "tBHItJI5svbpez7KI4CCXg" },
    }),
  );
const logFor = (appointmentId: string) =>
  system((tx) =>
    tx
      .select()
      .from(pushLog)
      .where(eq(pushLog.appointmentId, appointmentId))
      .orderBy(desc(pushLog.createdAt)),
  );

let slot = 0;
const book = (file: string): Promise<Appointment> =>
  withActor(reception, (tx) =>
    bookAppointment(tx, reception, {
      branchId: RIYADH,
      patientId: patient(file),
      serviceId: service("facial_treatment"),
      practitionerId: member("derma-dr-sara"),
      // A different whole day for each booking (2031-12-07 is a Sunday; no Fridays used).
      startsAt: riyadhAt(
        "10:00",
        ["2031-12-07", "2031-12-08", "2031-12-09", "2031-12-10"][slot++ % 4],
      ),
    }),
  );

describe("the concern push from the simulator path", () => {
  it("reaches Dr. Sara's phone and is logged as sent (with its own tag)", async () => {
    await clearDevices(SARA);
    await device(SARA, "https://web.push.apple.com/sara-iphone");
    const spy = vi
      .spyOn(webpush, "sendNotification")
      .mockResolvedValue({ statusCode: 201, body: "", headers: {} });
    const a = await book("D-0010");
    await sendPostCare(derma, a.id, ENV);
    const [postCare] = await system((tx) =>
      tx
        .select()
        .from(messages)
        .where(and(eq(messages.appointmentId, a.id), eq(messages.kind, "post_care"))),
    );
    const [p] = await system((tx) =>
      tx
        .select()
        .from(patients)
        .where(eq(patients.id, patient("D-0010"))),
    );
    // Exactly what the simulator's tap does: handleInbound with the default notifier.
    await handleInbound(
      derma,
      [
        {
          type: "message",
          eventId: `sim-concern-${Date.now()}`,
          from: p.phone,
          kind: "button",
          buttonPayload: postCare.buttons![1].id,
          buttonTitle: "x",
        },
      ],
      { env: ENV },
    );
    const toSara = spy.mock.calls.filter((c) =>
      (c[0] as { endpoint: string }).endpoint.includes("sara-iphone"),
    );
    expect(toSara).toHaveLength(1);
    const payload = JSON.parse(String(toSara[0][1]));
    expect(payload.tag).toBe(`patient_concern-${a.id}`);
    const log = await logFor(a.id);
    expect(log.find((l) => l.userId === SARA)).toMatchObject({
      type: "patient_concern",
      outcome: "sent",
      statusCode: 201,
      reason: "web.push.apple.com",
    });
    // Every recipient (the doctor AND the branch's receptionists) has a log line, device or not.
    const logged = new Set(log.map((l) => l.userId));
    for (const u of [SARA, "usr_derma-rec-ruh1", "usr_derma-rec-ruh2"]) {
      expect(logged.has(u), u).toBe(true);
    }
  });

  it("a concern never shares the tag of an earlier notification for the same visit", () => {
    const base = {
      appointmentId: "x",
      patientName: "سارة أحمد",
      serviceName: "بوتوكس",
      startsAt: new Date(),
      url: "/",
    };
    const tags = new Set(
      (["new_booking", "checked_in", "patient_concern"] as const).map(
        (type) => buildPayload({ ...base, type }).tag,
      ),
    );
    expect(tags.size).toBe(3);
  });
});

describe("the push log says why nothing arrived", () => {
  it("failed (with the service's answer), device gone (removed), switched off, type muted", async () => {
    await clearDevices(SARA);
    await device(SARA, "https://fcm.googleapis.com/fcm/send/broken");
    await device(SARA, "https://fcm.googleapis.com/fcm/send/old-phone");
    vi.spyOn(webpush, "sendNotification").mockImplementation(async (sub) => {
      const err = Object.assign(new Error("push failed"), {
        statusCode: sub.endpoint.includes("old-phone") ? 410 : 403,
        body: sub.endpoint.includes("old-phone") ? "expired" : "invalid JWT",
      });
      throw err;
    });
    const a = await book("D-0012");
    await sendPushEvents(DERMA, [{ type: "checked_in", appointmentId: a.id }], ENV);
    const log = await logFor(a.id);
    expect(log.find((l) => l.statusCode === 403)).toMatchObject({
      outcome: "failed",
      reason: "invalid JWT",
    });
    expect(log.find((l) => l.statusCode === 410)).toMatchObject({ outcome: "device_gone" });
    const left = await system((tx) =>
      tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, SARA)),
    );
    expect(left.map((s) => s.endpoint)).toEqual(["https://fcm.googleapis.com/fcm/send/broken"]);

    await withActor({ ...reception, userId: SARA, roles: ["practitioner"] }, (tx) =>
      savePrefs(tx, { tenantId: DERMA, userId: SARA, enabled: true, mutedTypes: ["cancelled"] }),
    );
    await sendPushEvents(DERMA, [{ type: "cancelled", appointmentId: a.id }], ENV);
    expect((await logFor(a.id)).find((l) => l.type === "cancelled")).toMatchObject({
      userId: SARA,
      outcome: "type_muted",
    });

    await withActor({ ...reception, userId: SARA, roles: ["practitioner"] }, (tx) =>
      savePrefs(tx, { tenantId: DERMA, userId: SARA, enabled: false, mutedTypes: [] }),
    );
    await sendPushEvents(DERMA, [{ type: "rescheduled", appointmentId: a.id }], ENV);
    expect((await logFor(a.id)).find((l) => l.type === "rescheduled")).toMatchObject({
      userId: SARA,
      outcome: "switched_off",
    });
    await system((tx) => tx.delete(notificationPrefs).where(eq(notificationPrefs.userId, SARA)));
  });

  it("no push keys in Vercel → logged as 'no_keys'", async () => {
    await clearDevices(SARA);
    await device(SARA, "https://fcm.googleapis.com/fcm/send/sara-android");
    const a = await book("D-0013");
    await sendPushEvents(DERMA, [{ type: "new_booking", appointmentId: a.id }], {
      ...ENV,
      VAPID_PRIVATE_KEY: "",
    });
    expect((await logFor(a.id)).find((l) => l.userId === SARA)).toMatchObject({
      outcome: "no_keys",
    });
  });

  it("the test notification is logged too", async () => {
    vi.spyOn(webpush, "sendNotification").mockResolvedValue({
      statusCode: 201,
      body: "",
      headers: {},
    });
    await sendTestPush(DERMA, SARA, ENV);
    const [row] = await system((tx) =>
      tx
        .select()
        .from(pushLog)
        .where(and(eq(pushLog.type, "test"), eq(pushLog.userId, SARA)))
        .orderBy(desc(pushLog.createdAt))
        .limit(1),
    );
    expect(row).toMatchObject({ outcome: "sent", statusCode: 201 });
  });
});
