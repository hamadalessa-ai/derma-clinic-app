/**
 * Staff push notifications: who gets what, personal choices, and PRIVACY — a lock-screen
 * notification carries only initials + service + time (no full name, phone, file number or
 * medical details).
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import webpush from "web-push";
import { closeDb } from "@/db/client";
import { patientMedicalFlags, patients, pushSubscriptions } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { withActor } from "@/lib/auth/db";
import { bookAppointment } from "@/lib/booking/engine";
import { planPushes, sendPushEvents, vapidConfig } from "@/lib/push/notify";
import {
  ALL_PUSH_TYPES,
  buildPayload,
  DEMO_PUSH_HOST,
  initials,
  type PushType,
} from "@/lib/push/payload";
import { removeSubscription, savePrefs, saveSubscription } from "@/lib/push/subscriptions";
import { generateVapidKeys } from "@/lib/push/vapid";
import { DERMA, drSara, member, patient, reception, riyadhAt, RIYADH, service } from "./fixtures";

afterAll(closeDb);

const system = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(DERMA, fn);
const SARA = "usr_derma-dr-sara";
const fakeSub = (name: string) => ({
  endpoint: `https://push.example.test/${name}-${Math.random().toString(36).slice(2)}`,
  p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
  auth: "tBHItJI5svbpez7KI4CCXg",
});

describe("privacy of the notification text", () => {
  it.each([
    ["العنود سليمان الرشيد", "ع. ر."],
    ["سارة أحمد الحربي", "س. ح."],
    ["Sara Ahmed", "S. A."],
    ["مريم", "م."],
    ["  ", "—"],
  ])("initials(%s) = %s", (name, out) => expect(initials(name)).toBe(out));

  it.each(ALL_PUSH_TYPES)("%s: only initials + service + time", (type) => {
    const p = buildPayload({
      type: type as PushType,
      appointmentId: "00000000-0000-0000-0000-000000000001",
      patientName: "العنود سليمان الرشيد",
      serviceName: "بوتوكس",
      startsAt: riyadhAt("11:30", "2031-03-02"),
      url: "/my-day",
    });
    const text = JSON.stringify(p);
    expect(p.body).toBe("ع. ر. · بوتوكس · 02/03 11:30");
    for (const word of ["العنود", "سليمان", "الرشيد"]) expect(text).not.toContain(word);
  });

  it("a real planned notification has no name, phone, file number or medical alert", async () => {
    // D-0001 has a lidocaine allergy (seeded).
    const [p] = await system((tx) =>
      tx
        .select()
        .from(patients)
        .where(eq(patients.id, patient("D-0001"))),
    );
    const flags = await system((tx) =>
      tx.select().from(patientMedicalFlags).where(eq(patientMedicalFlags.patientId, p.id)),
    );
    expect(flags.length).toBeGreaterThan(0);
    const sub = fakeSub("privacy");
    await system((tx) => saveSubscription(tx, { tenantId: DERMA, userId: SARA, sub }));
    const appt = await withActor(reception, (tx) =>
      bookAppointment(tx, reception, {
        branchId: RIYADH,
        patientId: p.id,
        serviceId: service("botox"),
        practitionerId: member("derma-dr-sara"),
        startsAt: riyadhAt("10:00", "2031-08-03"),
      }),
    );
    const { planned } = await system((tx) =>
      planPushes(tx, [{ type: "new_booking", appointmentId: appt.id }]),
    );
    const mine = planned.filter((x) => x.endpoint === sub.endpoint);
    expect(mine).toHaveLength(1);
    const text = JSON.stringify(mine[0].payload);
    for (const part of p.fullNameAr.split(" ")) expect(text).not.toContain(part);
    expect(text).not.toContain(p.phone);
    expect(text).not.toContain(p.fileNumber);
    for (const f of flags) expect(text).not.toContain(f.label.split(" ")[0]);
  });
});

describe("who gets what", () => {
  const book = (time: string) =>
    withActor(reception, (tx) =>
      bookAppointment(tx, reception, {
        branchId: RIYADH,
        patientId: patient("D-0005"),
        serviceId: service("consultation"),
        practitionerId: member("derma-dr-sara"),
        startsAt: riyadhAt(time, "2031-08-04"),
      }),
    );
  const usersFor = async (type: PushType, appointmentId: string, actorUserId?: string) => {
    const { planned } = await system((tx) =>
      planPushes(tx, [{ type, appointmentId, actorUserId }]),
    );
    const subs = await system((tx) => tx.select().from(pushSubscriptions));
    return new Set(planned.map((p) => subs.find((s) => s.id === p.subscriptionId)!.userId));
  };

  it("doctor events go to the appointment's doctor only", async () => {
    await system((tx) =>
      saveSubscription(tx, { tenantId: DERMA, userId: SARA, sub: fakeSub("sara") }),
    );
    await system((tx) =>
      saveSubscription(tx, {
        tenantId: DERMA,
        userId: "usr_derma-dr-faisal",
        sub: fakeSub("faisal"),
      }),
    );
    const a = await book("10:00");
    for (const type of ["new_booking", "cancelled", "rescheduled", "checked_in"] as const) {
      expect(await usersFor(type, a.id)).toEqual(new Set([SARA]));
    }
  });

  it("reception events go to that branch's receptionists (not Jeddah, not doctors)", async () => {
    for (const u of ["usr_derma-rec-ruh1", "usr_derma-rec-ruh2", "usr_derma-rec-jed"]) {
      await system((tx) => saveSubscription(tx, { tenantId: DERMA, userId: u, sub: fakeSub(u) }));
    }
    const a = await book("11:00");
    const users = await usersFor("online_booking", a.id);
    expect(users).toEqual(new Set(["usr_derma-rec-ruh1", "usr_derma-rec-ruh2"]));
  });

  it("a WhatsApp 'concern' goes to the appointment's doctor AND the branch's reception", async () => {
    const a = await book("11:30");
    const users = await usersFor("patient_concern", a.id);
    expect(users).toEqual(new Set([SARA, "usr_derma-rec-ruh1", "usr_derma-rec-ruh2"]));
  });

  it("nobody is notified about their own action", async () => {
    const a = await book("12:00");
    const users = await usersFor("reschedule_request", a.id, "usr_derma-rec-ruh1");
    expect(users.has("usr_derma-rec-ruh1")).toBe(false);
    expect(users.has("usr_derma-rec-ruh2")).toBe(true);
  });

  it("personal choices: a muted type, or everything off", async () => {
    const a = await book("13:00");
    await withActor(drSara, (tx) =>
      savePrefs(tx, { tenantId: DERMA, userId: SARA, enabled: true, mutedTypes: ["cancelled"] }),
    );
    expect((await usersFor("cancelled", a.id)).has(SARA)).toBe(false);
    expect((await usersFor("checked_in", a.id)).has(SARA)).toBe(true);
    await withActor(drSara, (tx) =>
      savePrefs(tx, { tenantId: DERMA, userId: SARA, enabled: false, mutedTypes: [] }),
    );
    expect((await usersFor("checked_in", a.id)).has(SARA)).toBe(false);
    await withActor(drSara, (tx) =>
      savePrefs(tx, { tenantId: DERMA, userId: SARA, enabled: true, mutedTypes: [] }),
    );
  });

  it("staff see and remove only their own devices", async () => {
    const sub = fakeSub("own");
    await system((tx) => saveSubscription(tx, { tenantId: DERMA, userId: SARA, sub }));
    const seenByReception = await withActor(reception, (tx) =>
      tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint)),
    );
    expect(seenByReception).toHaveLength(0);
    expect(
      await withActor(reception, (tx) => removeSubscription(tx, reception.userId, sub.endpoint)),
    ).toBe(0);
    expect(await withActor(drSara, (tx) => removeSubscription(tx, SARA, sub.endpoint))).toBe(1);
  });
});

describe("sending", () => {
  it("without VAPID keys nothing is sent (and nothing breaks)", async () => {
    const a = await withActor(reception, (tx) =>
      bookAppointment(tx, reception, {
        branchId: RIYADH,
        patientId: patient("D-0006"),
        serviceId: service("consultation"),
        practitionerId: member("derma-dr-sara"),
        startsAt: riyadhAt("12:30", "2031-08-05"),
      }),
    );
    expect(vapidConfig({})).toBeNull();
    const r = await sendPushEvents(DERMA, [{ type: "new_booking", appointmentId: a.id }], {});
    expect(r.sent).toBe(0);
    expect(r.skipped).toBe(r.planned);
  });

  it("demo devices (seeded host) are never contacted", async () => {
    const keys = await generateVapidKeys();
    const seeded = await system((tx) => tx.select().from(pushSubscriptions));
    expect(seeded.some((x) => new URL(x.endpoint).hostname === DEMO_PUSH_HOST)).toBe(true);
    // Only a demo device for Dr. Sara this time.
    await system((tx) => tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, SARA)));
    await system((tx) =>
      saveSubscription(tx, {
        tenantId: DERMA,
        userId: SARA,
        sub: { ...fakeSub("x"), endpoint: `https://${DEMO_PUSH_HOST}/demo-device/sara` },
      }),
    );
    const a = await withActor(reception, (tx) =>
      bookAppointment(tx, reception, {
        branchId: RIYADH,
        patientId: patient("D-0006"),
        serviceId: service("consultation"),
        practitionerId: member("derma-dr-sara"),
        startsAt: riyadhAt("16:00", "2031-08-05"),
      }),
    );
    const r = await sendPushEvents(DERMA, [{ type: "new_booking", appointmentId: a.id }], {
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
    });
    expect(r).toMatchObject({ planned: 1, sent: 0, skipped: 1, removed: 0 });
  });

  it("keys made in the browser (WebCrypto) are accepted by web-push", async () => {
    const keys = await generateVapidKeys();
    expect(keys.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/); // 65 bytes
    expect(keys.privateKey).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes
    expect(() =>
      webpush.setVapidDetails("mailto:demo@example.com", keys.publicKey, keys.privateKey),
    ).not.toThrow();
    const headers = webpush.getVapidHeaders(
      "https://fcm.googleapis.com",
      "mailto:demo@example.com",
      keys.publicKey,
      keys.privateKey,
      "aes128gcm",
    );
    expect(headers.Authorization).toMatch(/^vapid t=/);
  });
});
