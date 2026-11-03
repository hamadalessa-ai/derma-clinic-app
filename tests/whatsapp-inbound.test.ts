/**
 * Incoming WhatsApp: the SAME handler for the simulator and Meta's webhook. Signatures, repeated
 * deliveries, unknown types, buttons through the booking engine (cancellation window, no
 * double-booking), STOP / START, post-care "concern", new numbers, delivery statuses.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/whatsapp/webhook/route";
import { closeDb } from "@/db/client";
import { appointments, conversations, messages, patients, tenantSettings } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { withActor } from "@/lib/auth/db";
import { bookAppointment, type Appointment } from "@/lib/booking/engine";
import type { PushEvent } from "@/lib/push/notify";
import { buttonPayload } from "@/lib/whatsapp/buttons";
import { handleInbound, type InboundEvent } from "@/lib/whatsapp/inbound";
import { sendPostCare, sendReminder } from "@/lib/whatsapp/outbox";
import { parseMetaWebhook, validSignature } from "@/lib/whatsapp/webhook";
import { DERMA, LAMSA, member, patient, reception, riyadhAt, RIYADH, service } from "./fixtures";

afterAll(closeDb);

const ENV = { ...process.env, MESSAGE_DEMO_MODE: "on" };
const derma = { id: DERMA, slug: "derma", isDemo: true };
const system = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(DERMA, fn);

let n = 0;
const sim = () => `sim-test-${Date.now()}-${n++}`;
let slotN = 0;
async function book(
  file: string,
  code = "consultation",
  doctor = "derma-dr-faisal",
  month = "2032-04",
): Promise<Appointment> {
  const i = slotN++;
  const day = `${month}-${String(4 + Math.floor(i / 14)).padStart(2, "0")}`;
  const m = 10 * 60 + (i % 7) * 30 + (i % 14 >= 7 ? 5 * 60 : 0);
  const time = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return withActor(reception, (tx) =>
    bookAppointment(tx, reception, {
      branchId: RIYADH,
      patientId: patient(file),
      serviceId: service(code),
      practitionerId: member(doctor),
      startsAt: riyadhAt(time, day),
    }),
  ).catch(() => book(file, code, doctor, month));
}
const phoneOf = async (file: string) =>
  (
    await system((tx) =>
      tx
        .select()
        .from(patients)
        .where(eq(patients.id, patient(file))),
    )
  )[0].phone;
const statusOf = async (id: string) =>
  (await system((tx) => tx.select().from(appointments).where(eq(appointments.id, id))))[0].status;

/** The id of a button in the last message of a kind to this appointment. */
async function buttonOf(appointmentId: string, kind: string, index: number) {
  const [m] = await system((tx) =>
    tx
      .select()
      .from(messages)
      .where(and(eq(messages.appointmentId, appointmentId), eq(messages.kind, kind)))
      .orderBy(desc(messages.createdAt))
      .limit(1),
  );
  return m.buttons![index];
}
async function lastOut(appointmentIdOrPhone: string) {
  const [m] = await system((tx) =>
    tx
      .select({ m: messages })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(and(eq(conversations.phone, appointmentIdOrPhone), eq(messages.direction, "out")))
      .orderBy(desc(messages.createdAt))
      .limit(1),
  );
  return m?.m;
}
const tap = (
  from: string,
  b: { id: string; title: string },
  notify?: (e: PushEvent[]) => Promise<unknown>,
) =>
  handleInbound(
    derma,
    [
      {
        type: "message",
        eventId: sim(),
        from,
        kind: "button",
        buttonPayload: b.id,
        buttonTitle: b.title,
      },
    ],
    { env: ENV, notify: notify ?? (async () => {}) },
  );

/** What Meta would POST for a tapped reply button. */
function metaButtonWebhook(fromLocal: string, id: string, title: string, wamid: string) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "1111" },
              contacts: [{ wa_id: `966${fromLocal.slice(1)}`, profile: { name: "Test" } }],
              messages: [
                {
                  id: wamid,
                  from: `966${fromLocal.slice(1)}`,
                  type: "interactive",
                  interactive: { type: "button_reply", button_reply: { id, title } },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe("one handler for the simulator and real WhatsApp", () => {
  it("a Confirm tap works the same from the simulator and from Meta's webhook", async () => {
    for (const via of ["simulator", "meta"] as const) {
      const a = await book(via === "simulator" ? "D-0028" : "D-0029");
      await sendReminder(derma, a.id, ENV);
      const confirm = await buttonOf(a.id, "reminder", 0);
      const phone = await phoneOf(via === "simulator" ? "D-0028" : "D-0029");
      if (via === "simulator") {
        await tap(phone, confirm);
      } else {
        const events = parseMetaWebhook(
          metaButtonWebhook(phone, confirm.id, confirm.title, `wamid.${sim()}`),
        );
        expect(events).toHaveLength(1);
        await handleInbound(derma, events, { env: ENV, notify: async () => {} });
      }
      expect(await statusOf(a.id)).toBe("confirmed");
      expect((await lastOut(phone))?.kind).toBe("confirm_ack");
    }
  });

  it("the same delivery twice is handled once", async () => {
    const a = await book("D-0030");
    await sendReminder(derma, a.id, ENV);
    const confirm = await buttonOf(a.id, "reminder", 0);
    const phone = await phoneOf("D-0030");
    const ev: InboundEvent = {
      type: "message",
      eventId: `wamid.dup-${Date.now()}`,
      from: phone,
      kind: "button",
      buttonPayload: confirm.id,
      buttonTitle: confirm.title,
    };
    const first = await handleInbound(derma, [ev], { env: ENV, notify: async () => {} });
    const again = await handleInbound(derma, [ev, ev], { env: ENV, notify: async () => {} });
    expect(first[0].outcome).toBe("confirm_ack");
    expect(again.map((r) => r.outcome)).toEqual(["duplicate", "duplicate"]);
    const acks = await system((tx) =>
      tx
        .select()
        .from(messages)
        .where(and(eq(messages.appointmentId, a.id), eq(messages.kind, "confirm_ack"))),
    );
    expect(acks).toHaveLength(1);
  });

  it("never crashes on unknown message types or odd JSON; photos and audio go to the inbox", async () => {
    expect(parseMetaWebhook(null)).toEqual([]);
    expect(parseMetaWebhook({ entry: "nope" })).toEqual([]);
    expect(
      parseMetaWebhook({ entry: [{ changes: [{ value: { messages: [{ nothing: 1 }] } }] }] }),
    ).toEqual([]);
    const events = parseMetaWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { id: `wamid.img-${Date.now()}`, from: "966597771234", type: "image", image: {} },
                  { id: `wamid.aud-${Date.now()}`, from: "966597771234", type: "audio", audio: {} },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(events[0]).toMatchObject({ kind: "image", from: "0597771234" });
    expect(events[1]).toMatchObject({ kind: "unsupported", unsupportedType: "audio" });
    // No WhatsApp connection here: the photo can't be downloaded, but the message is kept.
    const r = await handleInbound(derma, events, { env: ENV, notify: async () => {} });
    expect(r.map((x) => x.outcome)).toEqual(["stored", "stored"]);
    const [c] = await system((tx) =>
      tx.select().from(conversations).where(eq(conversations.phone, "0597771234")),
    );
    expect(c.needsReply).toBe(true);
  });
});

describe("webhook security", () => {
  const SECRET = "test-app-secret-123";
  const body = JSON.stringify({ entry: [] });
  const sig = (b: string, s = SECRET) =>
    `sha256=${createHmac("sha256", s).update(b).digest("hex")}`;

  it("accepts only Meta's signature made with our app secret", () => {
    expect(validSignature(body, sig(body), SECRET)).toBe(true);
    expect(validSignature(body, sig(body, "someone-else"), SECRET)).toBe(false);
    expect(validSignature(body + " ", sig(body), SECRET)).toBe(false);
    expect(validSignature(body, null, SECRET)).toBe(false);
    expect(validSignature(body, "sha1=abc", SECRET)).toBe(false);
  });

  it("the route refuses forged posts and answers Meta's challenge only with our verify token", async () => {
    const saved = { ...process.env };
    Object.assign(process.env, {
      MESSAGE_DEMO_MODE: "",
      WHATSAPP_PROVIDER: "meta",
      WHATSAPP_CLINIC: "derma",
      WHATSAPP_PHONE_NUMBER_ID: "1111",
      WHATSAPP_BUSINESS_ACCOUNT_ID: "2222",
      WHATSAPP_ACCESS_TOKEN: "t",
      WHATSAPP_APP_SECRET: SECRET,
      WHATSAPP_VERIFY_TOKEN: "my-verify-token",
    });
    try {
      const forged = await POST(
        new NextRequest("http://x/api/whatsapp/webhook", {
          method: "POST",
          body,
          headers: { "x-hub-signature-256": sig(body, "forged") },
        }),
      );
      expect(forged.status).toBe(401);
      const unsigned = await POST(
        new NextRequest("http://x/api/whatsapp/webhook", { method: "POST", body }),
      );
      expect(unsigned.status).toBe(401);
      const challenge = (token: string) =>
        GET(
          new NextRequest(
            `http://x/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=12345`,
          ),
        );
      expect((await challenge("wrong")).status).toBe(403);
      const ok = await challenge("my-verify-token");
      expect(ok.status).toBe(200);
      expect(await ok.text()).toBe("12345");
      const [s] = await system((tx) => tx.select().from(tenantSettings));
      expect(s.whatsappWebhookVerifiedAt).not.toBeNull();
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });
});

describe("buttons act through the booking engine", () => {
  it("Cancel respects the cancellation window; outside it the patient is told to contact the clinic", async () => {
    const a = await book("D-0031", "consultation", "derma-dr-faisal", "2027-03");
    await sendReminder(derma, a.id, ENV);
    const cancel = await buttonOf(a.id, "reminder", 2);
    const phone = await phoneOf("D-0031");
    // Pretend the window is huge, so this visit is "too close" to cancel.
    await system((tx) => tx.update(tenantSettings).set({ cancellationWindowHours: 30000 }));
    try {
      await tap(phone, cancel);
      expect(await statusOf(a.id)).toBe("booked");
      expect((await lastOut(phone))?.kind).toBe("cancel_too_late");
    } finally {
      await system((tx) => tx.update(tenantSettings).set({ cancellationWindowHours: 24 }));
    }
    const pushes: PushEvent[] = [];
    await tap(phone, cancel, async (e) => pushes.push(...e));
    expect(await statusOf(a.id)).toBe("cancelled");
    expect((await lastOut(phone))?.kind).toBe("cancel_ack");
    expect(pushes.map((p) => p.type).sort()).toEqual(["cancelled", "patient_cancelled"]);
  });

  it("Reschedule offers the next free times with the same doctor; a taken time is refused (no double-booking)", async () => {
    const a = await book("D-0032", "consultation", "derma-dr-reem");
    await sendReminder(derma, a.id, ENV);
    const phone = await phoneOf("D-0032");
    await tap(phone, await buttonOf(a.id, "reminder", 1));
    const offer = await lastOut(phone);
    expect(offer?.kind).toBe("reschedule_offer");
    expect(offer!.buttons!.length).toBeGreaterThan(0);
    expect(offer!.buttons!.length).toBeLessThanOrEqual(3);
    for (const b of offer!.buttons!) expect(b.title.length).toBeLessThanOrEqual(20);

    // Someone else takes the first offered time before the patient taps it.
    const first = offer!.buttons![0];
    const minutes = Number(first.id.split(".")[3]);
    await withActor(reception, (tx) =>
      bookAppointment(tx, reception, {
        branchId: RIYADH,
        patientId: patient("D-0033"),
        serviceId: service("consultation"),
        practitionerId: member("derma-dr-reem"),
        startsAt: new Date(minutes * 60_000),
      }),
    );
    await tap(phone, first);
    expect((await lastOut(phone))?.kind).toBe("reschedule_failed");
    expect(
      (
        await system((tx) => tx.select().from(appointments).where(eq(appointments.id, a.id)))
      )[0].startsAt.getTime(),
    ).toBe(a.startsAt.getTime());

    // The second offered time works.
    const second = offer!.buttons![1];
    if (second) {
      const pushes: PushEvent[] = [];
      await tap(phone, second, async (e) => pushes.push(...e));
      expect((await lastOut(phone))?.kind).toBe("reschedule_done");
      const [moved] = await system((tx) =>
        tx.select().from(appointments).where(eq(appointments.id, a.id)),
      );
      expect(moved.startsAt.getTime()).toBe(Number(second.id.split(".")[3]) * 60_000);
      expect(moved.source).toBe("reception"); // the booking's origin stays; the move is audited as WhatsApp
      expect(pushes.map((p) => p.type).sort()).toEqual(["patient_rescheduled", "rescheduled"]);
    }
  });

  it("a forged payload, or a real button from another patient's phone, changes nothing", async () => {
    const a = await book("D-0034");
    await sendReminder(derma, a.id, ENV);
    const confirm = await buttonOf(a.id, "reminder", 0);
    await tap(await phoneOf("D-0034"), { id: confirm.id.replace("confirm", "cancel"), title: "x" });
    expect(await statusOf(a.id)).toBe("booked");
    await tap(await phoneOf("D-0035"), confirm); // valid signature, wrong person
    expect(await statusOf(a.id)).toBe("booked");
    expect((await lastOut(await phoneOf("D-0035")))?.kind).toBe("not_found");
    // A real payload signed for another clinic doesn't work here either.
    await tap(await phoneOf("D-0034"), { id: buttonPayload(LAMSA, "confirm", a.id), title: "x" });
    expect(await statusOf(a.id)).toBe("booked");
  });
});

describe("opt-out, concerns and new numbers", () => {
  it("STOP opts out (no more reminders); START switches back on", async () => {
    const phone = await phoneOf("D-0036");
    const say = (text: string) =>
      handleInbound(derma, [{ type: "message", eventId: sim(), from: phone, kind: "text", text }], {
        env: ENV,
        notify: async () => {},
      });
    await say("إيقاف");
    const [p] = await system((tx) =>
      tx
        .select()
        .from(patients)
        .where(eq(patients.id, patient("D-0036"))),
    );
    expect(p.whatsappOptedOutAt).not.toBeNull();
    expect((await lastOut(phone))?.kind).toBe("stop_ack");
    const a = await book("D-0036");
    expect(await sendReminder(derma, a.id, ENV)).toEqual({
      outcome: "skipped",
      reason: "no_consent",
    });
    await say("START");
    const [back] = await system((tx) =>
      tx
        .select()
        .from(patients)
        .where(eq(patients.id, patient("D-0036"))),
    );
    expect(back.whatsappOptedOutAt).toBeNull();
    expect((await sendReminder(derma, a.id, ENV)).outcome).toBe("sent");
  });

  it("post-care 'I have a concern' → flagged, needs reply, push to the doctor and reception", async () => {
    const a = await book("D-0037", "laser_hair_removal");
    expect((await sendPostCare(derma, a.id, ENV)).outcome).toBe("sent");
    const concern = await buttonOf(a.id, "post_care", 1);
    const phone = await phoneOf("D-0037");
    const pushes: PushEvent[] = [];
    await tap(phone, concern, async (e) => pushes.push(...e));
    expect(pushes).toEqual([{ type: "patient_concern", appointmentId: a.id }]);
    expect((await lastOut(phone))?.kind).toBe("concern_ack");
    const [flagged] = await system((tx) =>
      tx
        .select()
        .from(messages)
        .where(and(eq(messages.appointmentId, a.id), eq(messages.flag, "concern"))),
    );
    expect(flagged.direction).toBe("in");
    const [c] = await system((tx) =>
      tx.select().from(conversations).where(eq(conversations.phone, phone)),
    );
    expect(c.needsReply).toBe(true);
  });

  it("a number that isn't a patient becomes a new contact in the inbox (never dropped)", async () => {
    const phone = `0596${String(Date.now()).slice(-6)}`;
    const r = await handleInbound(
      derma,
      [
        {
          type: "message",
          eventId: sim(),
          from: phone,
          profileName: "Noura",
          kind: "text",
          text: "كم سعر البوتوكس؟",
        },
      ],
      { env: ENV, notify: async () => {} },
    );
    expect(r[0].outcome).toBe("stored");
    const [c] = await system((tx) =>
      tx.select().from(conversations).where(eq(conversations.phone, phone)),
    );
    expect(c).toMatchObject({ patientId: null, profileName: "Noura", needsReply: true });
    const msgs = await system((tx) =>
      tx.select().from(messages).where(eq(messages.conversationId, c.id)),
    );
    expect(msgs.map((m) => m.body)).toEqual(["كم سعر البوتوكس؟"]);
  });
});

describe("delivery statuses", () => {
  it("sent → delivered → read move forward only; failed stores the error", async () => {
    const a = await book("D-0038");
    await sendReminder(derma, a.id, ENV);
    const [m] = await system((tx) =>
      tx
        .select()
        .from(messages)
        .where(and(eq(messages.appointmentId, a.id), eq(messages.kind, "reminder"))),
    );
    // Pretend it went through Meta and got an id (the status update grant allows this column).
    const wamid = `wamid.st-${Date.now()}`;
    await system((tx) =>
      tx
        .update(messages)
        .set({ providerMessageId: wamid, status: "sent" })
        .where(eq(messages.id, m.id)),
    );
    const st = (status: "delivered" | "read" | "failed", errorCode?: string) =>
      handleInbound(
        derma,
        [
          {
            type: "status",
            eventId: `${wamid}:${status}`,
            providerMessageId: wamid,
            status,
            errorCode,
            errorText: errorCode ? "Business Account locked" : null,
          },
        ],
        { env: ENV },
      );
    const statusNow = async () =>
      (await system((tx) => tx.select().from(messages).where(eq(messages.id, m.id))))[0];
    await st("read");
    expect((await statusNow()).status).toBe("read");
    await st("delivered"); // arrives late: ignored
    expect((await statusNow()).status).toBe("read");
    await st("failed", "131031");
    expect(await statusNow()).toMatchObject({ status: "failed", errorCode: "131031" });
  });
});

describe("clinic separation", () => {
  it("a message to another clinic never touches this clinic's patients or chats", async () => {
    const phone = await phoneOf("D-0039");
    const before = await system((tx) => tx.select().from(messages));
    await handleInbound(
      { id: LAMSA, slug: "lamsa", isDemo: true },
      [{ type: "message", eventId: sim(), from: phone, kind: "text", text: "إيقاف" }],
      { env: ENV, notify: async () => {} },
    );
    const after = await system((tx) => tx.select().from(messages));
    expect(after.length).toBe(before.length);
    const [p] = await system((tx) =>
      tx
        .select()
        .from(patients)
        .where(eq(patients.id, patient("D-0039"))),
    );
    expect(p.whatsappOptedOutAt).toBeNull();
  });
});
