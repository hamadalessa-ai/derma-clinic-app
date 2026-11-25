/**
 * Self check-in: "I've arrived" from WhatsApp or the patient page checks the patient in (inside
 * the clinic's window, own/family visits only, consent first → signing checks them in), and
 * "Call in" sends the room on WhatsApp.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { and, desc, eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { appointments, messages, patients, tenantSettings } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { withActor } from "@/lib/auth/db";
import { bookAppointment, type Appointment } from "@/lib/booking/engine";
import { signConsentByLink } from "@/lib/consents/consents";
import type { PushEvent } from "@/lib/push/notify";
import { callIn } from "@/lib/visits/call-in";
import { checkInAfterConsent, selfCheckIn, windowState } from "@/lib/visits/self-check-in";
import { handleInbound } from "@/lib/whatsapp/inbound";
import { sendArrivalInvite, sendRoomCall } from "@/lib/whatsapp/outbox";
import { DERMA, drReem, member, patient, reception, RIYADH, riyadhAt, service } from "./fixtures";

afterAll(closeDb);

const DAY = "2036-06-01"; // a Sunday no other test uses
const ENV = { ...process.env, MESSAGE_DEMO_MODE: "on" };
const derma = { id: DERMA, slug: "derma", isDemo: true };
const MIN = 60_000;
const system = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(DERMA, fn);

const book = (file: string, time: string, code = "consultation"): Promise<Appointment> =>
  withActor(reception, (tx) =>
    bookAppointment(tx, reception, {
      branchId: RIYADH,
      patientId: patient(file),
      serviceId: service(code),
      practitionerId: member("derma-dr-faisal"),
      startsAt: riyadhAt(time, DAY),
    }),
  );
const row = async (id: string) =>
  (await system((tx) => tx.select().from(appointments).where(eq(appointments.id, id))))[0];
const lastMessage = async (appointmentId: string, kind: string) =>
  (
    await system((tx) =>
      tx
        .select()
        .from(messages)
        .where(and(eq(messages.appointmentId, appointmentId), eq(messages.kind, kind)))
        .orderBy(desc(messages.createdAt))
        .limit(1),
    )
  )[0];
const self = (a: Appointment, now: Date, file?: string) =>
  system((tx) =>
    selfCheckIn(tx, {
      tenantId: DERMA,
      appointmentId: a.id,
      patientIds: file ? [patient(file)] : [a.patientId],
      via: "online",
      now,
    }),
  );

let png: Buffer;
beforeAll(async () => {
  png = await sharp({ create: { width: 400, height: 150, channels: 4, background: "#ffffff" } })
    .composite([
      {
        input: Buffer.from(
          '<svg width="400" height="150"><path d="M20 100 C 120 10, 200 140, 380 40" stroke="black" stroke-width="4" fill="none"/></svg>',
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
  await system((tx) =>
    tx
      .update(tenantSettings)
      .set({ selfCheckInEnabled: true, selfCheckInBeforeMinutes: 45, selfCheckInAfterMinutes: 30 }),
  );
});

describe("the self check-in window", () => {
  it("opens 45 minutes before and closes 30 minutes after the start", () => {
    const s = { enabled: true, beforeMinutes: 45, afterMinutes: 30 };
    const start = new Date("2036-06-01T07:00:00Z");
    expect(windowState(start, s, new Date(start.getTime() - 46 * MIN))).toBe("too_early");
    expect(windowState(start, s, new Date(start.getTime() - 45 * MIN))).toBe("open");
    expect(windowState(start, s, new Date(start.getTime() + 30 * MIN))).toBe("open");
    expect(windowState(start, s, new Date(start.getTime() + 31 * MIN))).toBe("too_late");
  });
});

describe("I've arrived", () => {
  it("checks the patient in once, inside the window only", async () => {
    const a = await book("D-0022", "09:00");
    const early = await self(a, new Date(a.startsAt.getTime() - 2 * 60 * MIN));
    expect(early.status).toBe("too_early");
    expect((await row(a.id)).status).toBe("booked");

    const now = new Date(a.startsAt.getTime() - 10 * MIN);
    expect((await self(a, now)).status).toBe("checked_in");
    const r = await row(a.id);
    expect(r.status).toBe("arrived");
    expect(r.selfCheckedInAt).not.toBeNull();
    expect(r.arrivedAt).not.toBeNull();
    expect((await self(a, now)).status).toBe("already_checked_in");
  });

  it("refuses a late tap and someone else's visit", async () => {
    const a = await book("D-0023", "09:30");
    expect((await self(a, new Date(a.startsAt.getTime() + 40 * MIN))).status).toBe("too_late");
    expect((await self(a, a.startsAt, "D-0024")).status).toBe("not_found");
    expect((await row(a.id)).status).toBe("booked");
  });

  it("is off when the clinic switched it off", async () => {
    const a = await book("D-0024", "10:00");
    await system((tx) => tx.update(tenantSettings).set({ selfCheckInEnabled: false }));
    try {
      expect((await self(a, a.startsAt)).status).toBe("off");
    } finally {
      await system((tx) => tx.update(tenantSettings).set({ selfCheckInEnabled: true }));
    }
  });

  it("asks for the consent first; signing it checks the patient in", async () => {
    const a = await book("D-0025", "10:30", "chemical_peeling"); // consent every visit
    const now = new Date(a.startsAt.getTime() - 5 * MIN);
    const r = await self(a, now);
    expect(r.status).toBe("consent_required");
    expect((await row(a.id)).arrivalRequestedAt).not.toBeNull();
    expect((await row(a.id)).status).toBe("booked");

    const after = await system(async (tx) => {
      await signConsentByLink(tx, {
        tenantId: DERMA,
        appointmentId: a.id,
        signerName: "توقيع تجريبي",
        signaturePng: png,
      });
      return checkInAfterConsent(tx, { tenantId: DERMA, appointmentId: a.id, now });
    });
    expect(after?.status).toBe("checked_in");
    expect((await row(a.id)).status).toBe("arrived");
    expect((await row(a.id)).arrivalRequestedAt).toBeNull();
  });

  it("works from the WhatsApp button in the visit-day message", async () => {
    const a = await book("D-0026", "11:00");
    const sent = await sendArrivalInvite(derma, a.id, ENV);
    expect(sent.outcome).toBe("sent");
    const invite = await lastMessage(a.id, "arrival_invite");
    const button = invite.buttons![0]!;
    const pushed: PushEvent[] = [];
    const [p] = await system((tx) =>
      tx.select().from(patients).where(eq(patients.id, a.patientId)),
    );
    const phone = p!.phone;
    await handleInbound(
      derma,
      [
        {
          type: "message",
          eventId: `sim-self-${Date.now()}`,
          from: phone,
          kind: "button",
          buttonPayload: button.id,
          buttonTitle: button.title,
        },
      ],
      {
        env: ENV,
        now: new Date(a.startsAt.getTime() - 15 * MIN),
        notify: async (e) => {
          pushed.push(...e);
        },
      },
    );
    expect((await row(a.id)).status).toBe("arrived");
    expect(await lastMessage(a.id, "checked_in_ack")).toBeTruthy();
    expect(pushed.map((p) => p.type)).toContain("checked_in");
  });
});

describe("Call in", () => {
  it("records the call and sends the room on WhatsApp; another doctor can't", async () => {
    const a = await book("D-0027", "11:30");
    await self(a, a.startsAt);
    await expect(withActor(drReem, (tx) => callIn(tx, drReem, a.id))).rejects.toThrow();
    await withActor(reception, (tx) => callIn(tx, reception, a.id));
    expect((await row(a.id)).calledAt).not.toBeNull();
    expect((await sendRoomCall(derma, a.id, ENV)).outcome).toBe("sent");
    expect((await lastMessage(a.id, "room_call")).body).toBeTruthy();
  });

  it("only calls patients who have arrived", async () => {
    const a = await book("D-0028", "12:00");
    await expect(withActor(reception, (tx) => callIn(tx, reception, a.id))).rejects.toThrow(
      /bad_status/,
    );
  });
});
