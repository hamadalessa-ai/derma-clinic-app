/**
 * WhatsApp sending: the sender switch (demo / live / off), the Meta Cloud API adapter (against a
 * fake Meta server), consent rules, the "show service name" setting, at-most-once sending and
 * signed reply buttons.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { conversations, messages, messageTemplates, patients, tenantSettings } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { withActor } from "@/lib/auth/db";
import { bookAppointment, type Appointment } from "@/lib/booking/engine";
import { buttonPayload, parseButtonPayload } from "@/lib/whatsapp/buttons";
import { liveConfig, whatsappMode } from "@/lib/whatsapp/config";
import { explainError } from "@/lib/whatsapp/errors";
import { createMetaTransport, metaPayload, toInternational } from "@/lib/whatsapp/meta";
import { sendBookingConfirmation, sendRecall, sendReminder } from "@/lib/whatsapp/outbox";
import { sendMessage } from "@/lib/whatsapp/send";
import { DERMA, LAMSA, member, patient, reception, riyadhAt, RIYADH, service } from "./fixtures";

afterAll(closeDb);
afterEach(() => vi.unstubAllGlobals());

const DEMO_ENV = { ...process.env, MESSAGE_DEMO_MODE: "on" };
const derma = { id: DERMA, slug: "derma", isDemo: true };
const LIVE_ENV = {
  ...process.env,
  MESSAGE_DEMO_MODE: undefined,
  WHATSAPP_PROVIDER: "meta",
  WHATSAPP_CLINIC: "derma",
  WHATSAPP_PHONE_NUMBER_ID: "1111",
  WHATSAPP_BUSINESS_ACCOUNT_ID: "2222",
  WHATSAPP_ACCESS_TOKEN: "test-token",
  WHATSAPP_APP_SECRET: "test-app-secret",
  WHATSAPP_VERIFY_TOKEN: "test-verify",
};

const system = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(DERMA, fn);

let slot = 0;
/** A booking on a quiet future day (each call a new time). */
async function book(file: string, code = "botox"): Promise<Appointment> {
  const minutes = 10 * 60 + (slot++ % 16) * 30;
  const day = `2032-02-${String(1 + Math.floor(slot / 16)).padStart(2, "0")}`;
  const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return withActor(reception, (tx) =>
    bookAppointment(tx, reception, {
      branchId: RIYADH,
      patientId: patient(file),
      serviceId: service(code),
      practitionerId: member("derma-dr-reem"),
      startsAt: riyadhAt(time, day),
    }),
  ).catch(() => book(file, code));
}

async function threadOf(file: string) {
  return system((tx) =>
    tx
      .select({ m: messages })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(eq(messages.patientId, patient(file)))
      .orderBy(messages.createdAt),
  ).then((rows) => rows.map((r) => r.m));
}

describe("which way messages go (settings only)", () => {
  it("demo needs a demo clinic AND MESSAGE_DEMO_MODE=on; a real clinic never uses the simulator", () => {
    expect(whatsappMode({ isDemo: true, slug: "derma" }, { MESSAGE_DEMO_MODE: "on" })).toBe("demo");
    expect(whatsappMode({ isDemo: false, slug: "derma" }, { MESSAGE_DEMO_MODE: "on" })).toBe("off");
    expect(whatsappMode({ isDemo: true, slug: "derma" }, {})).toBe("off");
  });

  it("live only when every Meta setting is present and the number belongs to this clinic", () => {
    expect(whatsappMode({ isDemo: false, slug: "derma" }, LIVE_ENV)).toBe("live");
    expect(whatsappMode({ isDemo: false, slug: "lamsa" }, LIVE_ENV)).toBe("off");
    const missing = liveConfig({ ...LIVE_ENV, WHATSAPP_APP_SECRET: "" });
    expect(missing.config).toBeNull();
    expect(missing.missing).toEqual(["WHATSAPP_APP_SECRET"]);
    expect(liveConfig({ WHATSAPP_PROVIDER: "carrier-pigeon" }).missing[0]).toMatch(/unknown/);
  });

  it("explains Meta errors in plain words (131031 = business verification)", () => {
    expect(explainError("131031", "en")).toMatch(/business verification/);
    expect(explainError("131031", "ar")).toMatch(/توثيق/);
    expect(explainError("999999")).toBeNull();
  });
});

describe("Meta Cloud API adapter (fake Meta server)", () => {
  const config = liveConfig(LIVE_ENV).config!;
  const base = { to: "0501234567", language: "ar" as const, body: "مرحبا", buttons: [] };

  it("outside the 24-hour window: the approved template, variables in order, button payloads", () => {
    const p = metaPayload({
      ...base,
      buttons: [{ id: "v1.confirm.x", title: "تأكيد" }],
      template: { name: "appointment_reminder", params: ["سارة", ""] },
      insideWindow: false,
    }) as { to: string; type: string; template: { name: string; components: unknown[] } };
    expect(toInternational("0501234567")).toBe("966501234567");
    expect(p.to).toBe("966501234567");
    expect(p.type).toBe("template");
    expect(p.template.name).toBe("appointment_reminder");
    expect(JSON.stringify(p.template.components)).toContain('"text":"سارة"');
    expect(JSON.stringify(p.template.components)).toContain('"text":"-"'); // empty → "-"
    expect(JSON.stringify(p.template.components)).toContain('"payload":"v1.confirm.x"');
  });

  it("inside the window: reply buttons (max 3, short titles) or plain text", () => {
    const withButtons = metaPayload({
      ...base,
      buttons: [1, 2, 3, 4].map((i) => ({ id: `b${i}`, title: "عنوان طويل جدًا جدًا جدًا جدًا" })),
      template: null,
      insideWindow: true,
    }) as { type: string; interactive: { action: { buttons: { reply: { title: string } }[] } } };
    expect(withButtons.type).toBe("interactive");
    expect(withButtons.interactive.action.buttons).toHaveLength(3);
    expect(withButtons.interactive.action.buttons[0].reply.title.length).toBeLessThanOrEqual(20);
    expect(
      (metaPayload({ ...base, template: null, insideWindow: true }) as { type: string }).type,
    ).toBe("text");
  });

  it("success gives the WhatsApp message id; errors give the code and text", async () => {
    const ok = createMetaTransport(config, (async (url: string, init: RequestInit) => {
      expect(url).toBe("https://graph.facebook.com/v22.0/1111/messages");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
      return new Response(JSON.stringify({ messages: [{ id: "wamid.OK" }] }), { status: 200 });
    }) as unknown as typeof fetch);
    expect(await ok.send({ ...base, template: null, insideWindow: true })).toEqual({
      ok: true,
      providerMessageId: "wamid.OK",
    });
    const locked = createMetaTransport(
      config,
      (async () =>
        new Response(
          JSON.stringify({ error: { code: 131031, message: "Business Account locked" } }),
          { status: 400 },
        )) as unknown as typeof fetch,
    );
    expect(await locked.send({ ...base, template: null, insideWindow: true })).toMatchObject({
      ok: false,
      errorCode: "131031",
    });
    const down = createMetaTransport(config, (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch);
    expect(await down.send({ ...base, template: null, insideWindow: true })).toMatchObject({
      ok: false,
      errorCode: "network",
    });
  });
});

describe("sending through the one path", () => {
  it("demo: the booking confirmation lands in the patient's chat, in Arabic, with all details", async () => {
    const a = await book("D-0021");
    const r = await sendBookingConfirmation(derma, a.id, DEMO_ENV);
    expect(r.outcome).toBe("sent");
    const [msg] = (await threadOf("D-0021")).filter((m) => m.appointmentId === a.id);
    expect(msg).toMatchObject({
      kind: "booking_confirmation",
      channel: "demo",
      status: "delivered",
      language: "ar",
    });
    expect(msg.body).toContain("موعد بوتوكس");
    expect(msg.body).toContain("د. ريم الشهري");
    expect(msg.body).toContain("/my");
    expect(msg.body).toContain("maps.google.com");
  });

  it("English when the patient prefers English", async () => {
    await system((tx) =>
      tx
        .update(patients)
        .set({ preferredLanguage: "en" })
        .where(eq(patients.id, patient("D-0022"))),
    );
    const a = await book("D-0022");
    await sendBookingConfirmation(derma, a.id, DEMO_ENV);
    const [msg] = (await threadOf("D-0022")).filter((m) => m.appointmentId === a.id);
    expect(msg.language).toBe("en");
    expect(msg.body).toMatch(/^Hello /);
    expect(msg.body).toContain("your Botox appointment");
  });

  it("'show service name' OFF: confirmations, reminders and recalls say 'your appointment'", async () => {
    await system((tx) => tx.update(tenantSettings).set({ showServiceInMessages: false }));
    try {
      const a = await book("D-0023");
      await sendBookingConfirmation(derma, a.id, DEMO_ENV);
      await sendReminder(derma, a.id, DEMO_ENV);
      await sendRecall(derma, a.id, DEMO_ENV);
      const mine = (await threadOf("D-0023")).filter((m) => m.appointmentId === a.id);
      expect(mine.map((m) => m.kind).sort()).toEqual([
        "booking_confirmation",
        "recall",
        "reminder",
      ]);
      for (const m of mine) {
        expect(m.body).toContain("موعدك");
        expect(m.body).not.toContain("بوتوكس");
      }
    } finally {
      await system((tx) => tx.update(tenantSettings).set({ showServiceInMessages: true }));
    }
  });

  it("opted-out (STOP) and not-opted-in patients get no reminders; codes still go out", async () => {
    const out = await book("D-0014"); // seeded: sent STOP
    expect(await sendReminder(derma, out.id, DEMO_ENV)).toEqual({
      outcome: "skipped",
      reason: "no_consent",
    });
    await system((tx) =>
      tx
        .update(patients)
        .set({ whatsappOptInAt: null })
        .where(eq(patients.id, patient("D-0024"))),
    );
    const none = await book("D-0024");
    expect((await sendReminder(derma, none.id, DEMO_ENV)).outcome).toBe("skipped");
    const code = await sendMessage(
      derma,
      { kind: "verification_code", patientId: patient("D-0014"), secrets: { code: "123456" } },
      DEMO_ENV,
    );
    expect(code.outcome).toBe("sent");
  });

  it("a type switched off by the admin is not sent", async () => {
    await system((tx) =>
      tx
        .update(messageTemplates)
        .set({ enabled: false })
        .where(eq(messageTemplates.kind, "recall")),
    );
    try {
      const a = await book("D-0025");
      expect(await sendRecall(derma, a.id, DEMO_ENV)).toEqual({
        outcome: "skipped",
        reason: "disabled",
      });
    } finally {
      await system((tx) =>
        tx
          .update(messageTemplates)
          .set({ enabled: true })
          .where(eq(messageTemplates.kind, "recall")),
      );
    }
  });

  it("the same scheduled message is sent at most once — even when sent 6 times at the same moment", async () => {
    const a = await book("D-0026");
    const results = await Promise.all(
      Array.from({ length: 6 }, () => sendReminder(derma, a.id, DEMO_ENV)),
    );
    expect(results.filter((r) => r.outcome === "sent")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "skipped")).toHaveLength(5);
    const reminders = (await threadOf("D-0026")).filter(
      (m) => m.kind === "reminder" && m.appointmentId === a.id,
    );
    expect(reminders).toHaveLength(1);
    expect(reminders[0].buttons?.map((b) => b.title)).toEqual(["تأكيد", "تغيير الموعد", "إلغاء"]);
  });

  it("live (real WhatsApp): goes to Meta; a refusal is stored with its error code; codes are stored masked", async () => {
    const calls: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({ error: { code: 131031, message: "Business Account locked" } }),
        {
          status: 400,
        },
      );
    });
    const real = { id: DERMA, slug: "derma", isDemo: false };
    const r = await sendMessage(
      real,
      { kind: "verification_code", phone: "0597770001", secrets: { code: "654321" } },
      LIVE_ENV,
    );
    expect(r).toMatchObject({ outcome: "failed", error: "131031" });
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0])).toContain("654321"); // the real message carries the code…
    const [stored] = await system((tx) =>
      tx
        .select({ m: messages })
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(and(eq(conversations.phone, "0597770001"), eq(messages.kind, "verification_code"))),
    );
    expect(stored.m).toMatchObject({ channel: "meta", status: "failed", errorCode: "131031" });
    expect(stored.m.body).not.toContain("654321"); // …the stored copy never does
  });

  it("messages of one clinic never land in another clinic's chats", async () => {
    const a = await book("D-0027");
    await sendBookingConfirmation(derma, a.id, DEMO_ENV);
    const lamsaSees = await withTenant(LAMSA, (tx) =>
      tx.select().from(messages).where(eq(messages.appointmentId, a.id)),
    );
    expect(lamsaSees).toHaveLength(0);
  });
});

describe("signed reply buttons", () => {
  it("round-trips; a tampered, unsigned or other-clinic payload is refused", () => {
    const appt = "11111111-2222-3333-4444-555555555555";
    const p = buttonPayload(DERMA, "confirm", appt);
    expect(parseButtonPayload(DERMA, p)).toEqual({
      action: "confirm",
      appointmentId: appt,
      extra: null,
    });
    expect(parseButtonPayload(LAMSA, p)).toBeNull();
    expect(parseButtonPayload(DERMA, p.replace("confirm", "cancel"))).toBeNull();
    expect(
      parseButtonPayload(DERMA, p.replace(appt, "99999999-2222-3333-4444-555555555555")),
    ).toBeNull();
    expect(parseButtonPayload(DERMA, "v1.confirm.-.-.AAAAAAAAAAAAAAAAAAAAAA")).toBeNull();
    expect(parseButtonPayload(DERMA, "hello")).toBeNull();
    const s = buttonPayload(DERMA, "slot", appt, "29541600");
    expect(parseButtonPayload(DERMA, s)?.extra).toBe("29541600");
  });
});
