/**
 * The WhatsApp AI receptionist, driven by a SCRIPTED fake model (no real API calls):
 * confirm-before-book, new contacts, own data only, hand-off to staff, staff take-over,
 * clinic switch, daily limit, failures, and prices only when the clinic shows them.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import {
  appointments,
  auditLogs,
  conversations,
  messages,
  patients,
  tenantSettings,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { withActor } from "@/lib/auth/db";
import { bookAppointment } from "@/lib/booking/engine";
import {
  anthropicClient,
  type ClaudeClient,
  type ClaudeRequest,
  type ContentBlock,
} from "@/lib/ai/claude";
import {
  FALLBACK_REPLY,
  fitReply,
  historyTurns,
  isClearYes,
  runReceptionist,
  systemPrompt,
  toWhatsAppText,
  TOOLS,
} from "@/lib/ai/receptionist";
import type { PushEvent } from "@/lib/push/notify";
import { handleInbound } from "@/lib/whatsapp/inbound";
import { setAiPaused } from "@/lib/whatsapp/staff";
import { DERMA, member, patient, reception, riyadhAt, RIYADH, service } from "./fixtures";

afterAll(closeDb);

const ENV = { ...process.env, MESSAGE_DEMO_MODE: "on" };
const derma = { id: DERMA, slug: "derma", isDemo: true };
const system = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(DERMA, fn);
/** "Now" for these tests: far from the demo week and other tests' bookings. */
const NOW = riyadhAt("08:00", "2035-03-04");

let n = 0;
const sim = () => `sim-ai-${Date.now()}-${n++}`;

// ─── A scripted fake model ──────────────────────────────────────────────────

type Step = (req: ClaudeRequest, results: Record<string, unknown>[]) => ContentBlock[];

/** Plays the steps in order; each step sees the tool results of the previous step. */
function scripted(steps: Step[]) {
  const calls: ClaudeRequest[] = [];
  const client: ClaudeClient = {
    async create(req) {
      calls.push(structuredClone(req));
      const step = steps[calls.length - 1];
      if (!step) throw new Error("the script has no more steps");
      const last = req.messages.at(-1);
      const results =
        last && Array.isArray(last.content)
          ? last.content
              .filter((b) => b.type === "tool_result")
              .map((b) => JSON.parse((b as { content: string }).content) as Record<string, unknown>)
          : [];
      const content = step(req, results);
      return {
        content,
        stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
      };
    },
  };
  return { client, calls };
}
let toolN = 0;
const use = (name: string, input: Record<string, unknown> = {}): ContentBlock => ({
  type: "tool_use",
  id: `tu_${toolN++}`,
  name,
  input,
});
const say = (text: string): ContentBlock[] => [{ type: "text", text }];

/** Saved between the steps of one test (e.g. the time find_times offered). */
const memo: Record<string, string> = {};

async function write(
  from: string,
  text: string,
  client: ClaudeClient | null,
  pushes: PushEvent[] = [],
) {
  return handleInbound(
    derma,
    [{ type: "message", eventId: sim(), from, kind: "text", text, profileName: "Test" }],
    {
      env: ENV,
      now: NOW,
      ai: client,
      notify: async (e) => {
        pushes.push(...e);
      },
    },
  );
}
const convoOf = async (phone: string) =>
  (await system((tx) => tx.select().from(conversations).where(eq(conversations.phone, phone))))[0];
async function outgoing(phone: string, kind: string) {
  return system((tx) =>
    tx
      .select({ m: messages })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(
        and(eq(conversations.phone, phone), eq(messages.direction, "out"), eq(messages.kind, kind)),
      )
      .orderBy(desc(messages.createdAt)),
  );
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
async function clearChat(phone: string) {
  await system((tx) =>
    tx
      .update(conversations)
      .set({ needsReply: false, aiPausedAt: null, aiPendingAction: null })
      .where(eq(conversations.phone, phone)),
  );
}

beforeEach(async () => {
  await system((tx) =>
    tx
      .update(tenantSettings)
      .set({ aiReceptionistEnabled: true, aiDailyLimit: 200, showPricesOnline: true }),
  );
});

// ─── Unit pieces ────────────────────────────────────────────────────────────

describe("pieces", () => {
  it("no API key → no client", () => {
    expect(anthropicClient({})).toBeNull();
    expect(anthropicClient({ ANTHROPIC_API_KEY: "  " })).toBeNull();
    expect(anthropicClient({ ANTHROPIC_API_KEY: "sk-test" })).not.toBeNull();
  });

  it("history alternates and starts with the patient", () => {
    const turns = historyTurns([
      { direction: "out", body: "reminder", kind: "reminder" },
      { direction: "in", body: "hi", kind: "inbound_text" },
      { direction: "in", body: "Confirm", kind: "inbound_button" },
      { direction: "out", body: "ok", kind: "confirm_ack" },
      { direction: "in", body: "thanks", kind: "inbound_text" },
    ]);
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant", "user"]);
    expect(turns[0].content).toContain("[tapped the button: Confirm]");
  });

  it("offers exactly the six tools", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(
      [
        "clinic_info",
        "confirm_action",
        "find_times",
        "hand_off_to_staff",
        "my_appointments",
        "propose_action",
      ].sort(),
    );
  });
});

// ─── Booking ────────────────────────────────────────────────────────────────

describe("booking through the AI", () => {
  it("never books in the same turn: proposes, waits for 'yes', then books", async () => {
    const phone = await phoneOf("D-0031");
    await clearChat(phone);
    const pushes: PushEvent[] = [];

    // Turn 1: find a time, propose it, try (wrongly) to confirm at once → refused.
    let confirmEarly: Record<string, unknown> | undefined;
    const turn1 = scripted([
      () => [
        use("find_times", {
          branch_id: RIYADH,
          service_id: service("consultation"),
          date: "2035-03-05",
        }),
      ],
      (_req, [r]) => {
        const times = r.times as { starts_at: string }[];
        expect(times.length).toBeGreaterThan(0);
        memo.slot = times[0].starts_at;
        return [
          use("propose_action", {
            action: "book",
            branch_id: RIYADH,
            service_id: service("consultation"),
            starts_at: memo.slot,
          }),
        ];
      },
      (_req, [r]) => {
        expect(r.saved).toBe(true);
        return [use("confirm_action")];
      },
      (_req, [r]) => {
        confirmEarly = r;
        return say("هل أؤكد الحجز؟ ردّي بـ نعم.");
      },
    ]);
    expect(await write(phone, "أبغى أحجز استشارة الأسبوع الجاي", turn1.client, pushes)).toEqual([
      expect.objectContaining({ outcome: "ai_replied" }),
    ]);
    expect(confirmEarly).toEqual({ error: "ask_the_person_first" });
    const booked0 = await system((tx) =>
      tx
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.patientId, patient("D-0031")),
            eq(appointments.startsAt, new Date(memo.slot)),
          ),
        ),
    );
    expect(booked0).toHaveLength(0);
    expect((await convoOf(phone)).aiPendingAction).toMatchObject({ action: "book" });
    expect((await convoOf(phone)).needsReply).toBe(false);
    const [reply1] = await outgoing(phone, "ai_reply");
    expect(reply1.m.body).toContain("نعم");

    // Turn 2: the patient says yes → booked through the engine, as a WhatsApp booking.
    const turn2 = scripted([
      () => [use("confirm_action")],
      (_req, [r]) => {
        expect(r).toMatchObject({ done: true, status: "booked" });
        return say("تم الحجز ✓");
      },
    ]);
    await write(phone, "نعم", turn2.client, pushes);
    const [appt] = await system((tx) =>
      tx
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.patientId, patient("D-0031")),
            eq(appointments.startsAt, new Date(memo.slot)),
          ),
        ),
    );
    expect(appt).toBeDefined();
    expect(appt.status).toBe("booked");
    expect(appt.source).toBe("whatsapp");
    expect(pushes.map((p) => p.type)).toEqual(
      expect.arrayContaining(["new_booking", "online_booking"]),
    );
    expect((await convoOf(phone)).aiPendingAction).toBeNull();
    expect(await outgoing(phone, "booking_confirmation")).not.toHaveLength(0);
    const [log] = await system((tx) =>
      tx
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, "ai.booked"), eq(auditLogs.entityId, appt.id))),
    );
    expect(log).toBeDefined();
  });

  it("a new number: needs a name and gender, then becomes a patient", async () => {
    const phone = "0590007711";
    const turn1 = scripted([
      () => [
        use("find_times", {
          branch_id: RIYADH,
          service_id: service("consultation"),
          date: "2035-03-06",
        }),
      ],
      (_req, [r]) => {
        memo.newSlot = (r.times as { starts_at: string }[])[0].starts_at;
        return [
          use("propose_action", {
            action: "book",
            branch_id: RIYADH,
            service_id: service("consultation"),
            starts_at: memo.newSlot,
          }),
        ];
      },
      (_req, [r]) => {
        expect(r).toEqual({ error: "need_full_name_and_gender" });
        return [
          use("propose_action", {
            action: "book",
            branch_id: RIYADH,
            service_id: service("consultation"),
            starts_at: memo.newSlot,
            full_name: "نورة الاختبار",
            gender: "female",
          }),
        ];
      },
      (_req, [r]) => {
        expect(r.saved).toBe(true);
        return say("Shall I book it? Reply yes.");
      },
    ]);
    await write(phone, "I want a consultation, I'm Noura Test, female", turn1.client);
    expect((await convoOf(phone)).patientId).toBeNull();

    const turn2 = scripted([() => [use("confirm_action")], () => say("Booked ✓")]);
    await write(phone, "yes", turn2.client);
    const c = await convoOf(phone);
    expect(c.patientId).not.toBeNull();
    const [p] = await system((tx) =>
      tx.select().from(patients).where(eq(patients.id, c.patientId!)),
    );
    expect(p.fullNameAr).toBe("نورة الاختبار");
    expect(p.createdVia).toBe("whatsapp");
    expect(p.needsCompletion).toBe(true);
    expect(p.whatsappOptInAt).not.toBeNull();
  });

  it("only the person's own appointments can be cancelled", async () => {
    const phone = await phoneOf("D-0032");
    await clearChat(phone);
    // Someone else's appointment.
    const other = await withActor(reception, (tx) =>
      bookAppointment(tx, reception, {
        branchId: RIYADH,
        patientId: patient("D-0033"),
        serviceId: service("consultation"),
        practitionerId: member("derma-dr-reem"),
        startsAt: riyadhAt("11:00", "2035-03-18"),
      }),
    );
    const turn = scripted([
      () => [use("my_appointments")],
      (_req, [r]) => {
        const ids = (r.appointments as { appointment_id: string }[]).map((x) => x.appointment_id);
        expect(ids).not.toContain(other.id);
        return [use("propose_action", { action: "cancel", appointment_id: other.id })];
      },
      (_req, [r]) => {
        expect(r).toEqual({ error: "not_your_appointment" });
        return say("I can't find that visit.");
      },
    ]);
    await write(phone, "cancel my visit on the 18th", turn.client);
    expect(
      (await system((tx) => tx.select().from(appointments).where(eq(appointments.id, other.id))))[0]
        .status,
    ).toBe("booked");
  });
});

// ─── Prices ─────────────────────────────────────────────────────────────────

describe("clinic info", () => {
  it("shows prices only when the clinic shows them online", async () => {
    const phone = "0590007734";
    await clearChat(phone);
    let info: Record<string, unknown> = {};
    const ask = () =>
      scripted([
        () => [use("clinic_info")],
        (_req, [r]) => {
          info = r;
          return say("…");
        },
      ]).client;
    await write(phone, "كم سعر الاستشارة؟", ask());
    const price = (info.services as Record<string, unknown>[])[0];
    expect(price).toHaveProperty("price_sar");

    await system((tx) => tx.update(tenantSettings).set({ showPricesOnline: false }));
    await write(phone, "والفلر؟", ask());
    expect((info.services as Record<string, unknown>[])[0]).not.toHaveProperty("price_sar");
    expect(info.prices_shown).toBe(false);
  });
});

// ─── When the AI stays quiet ────────────────────────────────────────────────

describe("hand-off and staying quiet", () => {
  it("hands a medical question to staff; then helps with other things, chat still flagged", async () => {
    const phone = "0590007735";
    await clearChat(phone);
    const turn = scripted([
      () => [use("hand_off_to_staff", { reason: "medical", summary: "Redness after peel" })],
      () => say("سيرد عليك أحد أفراد الفريق قريبًا."),
    ]);
    expect(await write(phone, "عندي احمرار بعد التقشير، طبيعي؟", turn.client)).toEqual([
      expect.objectContaining({ outcome: "ai_handed_off" }),
    ]);
    expect((await convoOf(phone)).needsReply).toBe(true);
    expect(await outgoing(phone, "ai_reply")).not.toHaveLength(0);

    // A non-medical request next (live: "ابغى حجز بوتكس يوم الاثنين"): the AI still answers,
    // told to keep off the handed-off topic, and the chat stays flagged for the team.
    const next = scripted([
      (req) => {
        expect(req.system).toContain("This chat is waiting for the clinic team");
        return say("أكيد، أي فرع يناسبك؟");
      },
    ]);
    expect(await write(phone, "ابغى حجز بوتكس يوم الاثنين", next.client)).toEqual([
      expect.objectContaining({ outcome: "ai_replied" }),
    ]);
    expect(next.calls).toHaveLength(1);
    expect((await convoOf(phone)).needsReply).toBe(true);
  });

  it("stays quiet when staff took over the chat", async () => {
    const phone = "0590007736";
    await clearChat(phone);
    await write(phone, "hello", scripted([() => say("Hi!")]).client);
    const c = await convoOf(phone);
    await withActor(reception, (tx) => setAiPaused(tx, reception, c.id, true));
    const silent = scripted([]);
    await write(phone, "are you there?", silent.client);
    expect(silent.calls).toHaveLength(0);
    expect((await convoOf(phone)).needsReply).toBe(true);

    await withActor(reception, (tx) => setAiPaused(tx, reception, c.id, false));
    await clearChat(phone);
    const back = scripted([() => say("Yes, how can I help?")]);
    await write(phone, "hello again", back.client);
    expect(back.calls).toHaveLength(1);
  });

  it("stays quiet when the clinic switched it off, or today's limit is reached", async () => {
    const phone = "0590007737";
    await clearChat(phone);
    await system((tx) => tx.update(tenantSettings).set({ aiReceptionistEnabled: false }));
    const off = scripted([]);
    await write(phone, "hi", off.client);
    expect(off.calls).toHaveLength(0);

    await clearChat(phone);
    await system((tx) =>
      tx.update(tenantSettings).set({ aiReceptionistEnabled: true, aiDailyLimit: 0 }),
    );
    const limited = scripted([]);
    await write(phone, "hi", limited.client);
    expect(limited.calls).toHaveLength(0);
    expect((await convoOf(phone)).needsReply).toBe(true);
  });

  it("with no API key, messages go to the inbox as before", async () => {
    const phone = "0590007738";
    await clearChat(phone);
    expect(await write(phone, "hi", null)).toEqual([
      expect.objectContaining({ outcome: "stored" }),
    ]);
    expect((await convoOf(phone)).needsReply).toBe(true);
  });

  it("a model failure goes to the inbox — never silence", async () => {
    const phone = "0590007739";
    await clearChat(phone);
    const broken: ClaudeClient = {
      async create() {
        throw new Error("Claude API 400: invalid_request_error credit balance too low");
      },
    };
    expect(await write(phone, "hi", broken)).toEqual([
      expect.objectContaining({ outcome: "ai_failed" }),
    ]);
    expect((await convoOf(phone)).needsReply).toBe(true);
    // The patient still gets a polite "the team will reply" (never left waiting).
    const replies = await outgoing(phone, "ai_reply");
    expect(replies).toHaveLength(1);
    expect(replies[0].m.body).toBe(FALLBACK_REPLY.ar);
  });

  it("a medical worry from a patient with a visit: marked as a concern for the doctor", async () => {
    // What happened live: the number had a booking, so the message is marked as a concern.
    const visit = await withActor(reception, (tx) =>
      bookAppointment(tx, reception, {
        branchId: RIYADH,
        patientId: patient("D-0019"),
        serviceId: service("laser_hair_removal"),
        practitionerId: member("derma-dr-sara"),
        startsAt: riyadhAt("12:00", "2035-03-12"),
      }),
    );
    const phone = await phoneOf("D-0019");
    await clearChat(phone);
    const pushes: PushEvent[] = [];
    const turn = scripted([
      () => [use("hand_off_to_staff", { reason: "medical", summary: "Redness after laser" })],
      () => say("سيرد عليك أحد أفراد الفريق قريبًا."),
    ]);
    expect(await write(phone, "عندي احمرار بعد الليزر", turn.client, pushes)).toEqual([
      expect.objectContaining({ outcome: "ai_handed_off" }),
    ]);
    const [inbound] = await system((tx) =>
      tx
        .select({ m: messages })
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(and(eq(conversations.phone, phone), eq(messages.direction, "in")))
        .orderBy(desc(messages.createdAt))
        .limit(1),
    );
    expect(inbound.m.flag).toBe("concern");
    expect(inbound.m.appointmentId).toBe(visit.id);
    expect(pushes).toContainEqual({ type: "patient_concern", appointmentId: visit.id });
    expect((await convoOf(phone)).needsReply).toBe(true);
    expect((await outgoing(phone, "ai_reply"))[0].m.body).toContain("الفريق");
  });

  it("if handing off breaks, the chat still goes to staff and the patient still hears back", async () => {
    const phone = "0590007740";
    const turn = scripted([
      () => [use("hand_off_to_staff", { reason: "medical", summary: "x" })],
      () => [], // the model ends without any text
    ]);
    await write(phone, "عندي ألم", turn.client);
    expect((await convoOf(phone)).needsReply).toBe(true);
    expect((await outgoing(phone, "ai_reply"))[0].m.body).toBe(FALLBACK_REPLY.ar);
  });
});

// ─── Regression: "yes" after the AI re-checks the same proposal ─────────────

describe("confirming after a re-check", () => {
  it("books when the AI proposes the SAME booking again before confirming", async () => {
    const phone = "0590007712";
    const turn1 = scripted([
      () => [
        use("find_times", {
          branch_id: RIYADH,
          service_id: service("consultation"),
          date: "2035-03-07",
        }),
      ],
      (_req, [r]) => {
        memo.recheck = (r.times as { starts_at: string }[])[0].starts_at;
        return [
          use("propose_action", {
            action: "book",
            branch_id: RIYADH,
            service_id: service("consultation"),
            starts_at: memo.recheck,
            full_name: "حمد الاختبار",
            gender: "male",
          }),
        ];
      },
      () => say("أرسل نعم للتأكيد."),
    ]);
    await write(phone, "أبغى استشارة، اسمي حمد الاختبار، ذكر", turn1.client);

    // What happened live: on "نعم" the model proposed the same booking again, then confirmed.
    let reproposed: Record<string, unknown> = {};
    let confirmed: Record<string, unknown> = {};
    const turn2 = scripted([
      (req) => {
        expect(req.system).toContain("call confirm_action right away");
        return [
          use("propose_action", {
            action: "book",
            branch_id: RIYADH,
            service_id: service("consultation"),
            starts_at: memo.recheck,
            full_name: "حمد الاختبار",
            gender: "male",
          }),
        ];
      },
      (_req, [r]) => {
        reproposed = r;
        return [use("confirm_action")];
      },
      (_req, [r]) => {
        confirmed = r;
        return say("تم الحجز ✓");
      },
    ]);
    await write(phone, "نعم", turn2.client);
    expect(String(reproposed.next_step)).toContain("call confirm_action now");
    expect(confirmed).toMatchObject({ done: true, status: "booked" });
    const c = await convoOf(phone);
    const [appt] = await system((tx) =>
      tx
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.patientId, c.patientId!),
            eq(appointments.startsAt, new Date(memo.recheck)),
          ),
        ),
    );
    expect(appt?.status).toBe("booked");
  });

  it("a DIFFERENT proposal still needs a new yes", async () => {
    const phone = "0590007713";
    const turn1 = scripted([
      () => [
        use("find_times", {
          branch_id: RIYADH,
          service_id: service("consultation"),
          date: "2035-03-08",
        }),
      ],
      (_req, [r]) => {
        const times = r.times as { starts_at: string }[];
        memo.firstChoice = times[0].starts_at;
        memo.secondChoice = times[1].starts_at;
        return [
          use("propose_action", {
            action: "book",
            branch_id: RIYADH,
            service_id: service("consultation"),
            starts_at: memo.firstChoice,
            full_name: "ريم الاختبار",
            gender: "female",
          }),
        ];
      },
      () => say("أرسلي نعم للتأكيد."),
    ]);
    await write(phone, "أبغى استشارة، اسمي ريم الاختبار، أنثى", turn1.client);
    let confirmed: Record<string, unknown> = {};
    const turn2 = scripted([
      () => [
        use("propose_action", {
          action: "book",
          branch_id: RIYADH,
          service_id: service("consultation"),
          starts_at: memo.secondChoice,
          full_name: "ريم الاختبار",
          gender: "female",
        }),
      ],
      () => [use("confirm_action")],
      (_req, [r]) => {
        confirmed = r;
        return say("هل أؤكد الوقت الجديد؟");
      },
    ]);
    await write(phone, "الوقت اللي بعده أحسن", turn2.client);
    expect(confirmed).toEqual({ error: "ask_the_person_first" });
  });

  it("tells the model never to guess gender", async () => {
    const text = systemPrompt({
      clinicAr: "عيادة",
      clinicEn: "Clinic",
      now: NOW,
      patientFirstName: null,
      preferredLanguage: "ar",
    });
    expect(text).toContain("Never guess gender");
    // 997 only for emergencies, not routine worries.
    expect(text).toContain("Emergency advice ONLY when");
    expect(text).toContain("do NOT mention 997");
  });
});

describe("WhatsApp formatting", () => {
  it("turns Markdown into WhatsApp marks", () => {
    expect(toWhatsAppText("## المواعيد\n**فرع الرياض** (د. ريم):\n- الاثنين")).toBe(
      "المواعيد\n*فرع الرياض* (د. ريم):\n- الاثنين",
    );
  });
});

// ─── Safety net (audit fixes) ───────────────────────────────────────────────

describe("a clear yes is decided in code", () => {
  it.each([
    "نعم",
    "yes",
    "Yes please",
    "تمام 👍",
    "👍",
    "أكدي الحجز",
    "إي والله",
    "ok thanks",
    "موافق",
    "تم",
    "ايوه احجزي",
  ])("%s → yes", (text) => expect(isClearYes(text)).toBe(true));

  it.each([
    "what about 5pm?",
    "نعم بس الساعة 5",
    "لا",
    "no",
    "yes but at 4",
    "الوقت اللي بعده أحسن",
    "بكرة أفضل",
    "can you make it Monday",
    "",
    "طيب وش الأسعار؟",
  ])("%s → not a clear yes", (text) => expect(isClearYes(text)).toBe(false));

  it("refuses to act when the answer to a proposal is not a clear yes", async () => {
    const phone = "0590007751";
    await clearChat(phone);
    const turn1 = scripted([
      () => [
        use("find_times", {
          branch_id: RIYADH,
          service_id: service("consultation"),
          date: "2035-03-08",
        }),
      ],
      (_req, [r]) => {
        memo.unclear = (r.times as { starts_at: string }[])[0].starts_at;
        return [
          use("propose_action", {
            action: "book",
            branch_id: RIYADH,
            service_id: service("consultation"),
            starts_at: memo.unclear,
            full_name: "سلمى الاختبار",
            gender: "female",
          }),
        ];
      },
      () => say("أرسلي نعم للتأكيد."),
    ]);
    await write(phone, "أبغى استشارة، اسمي سلمى الاختبار، أنثى", turn1.client);
    let answer: Record<string, unknown> = {};
    const turn2 = scripted([
      () => [use("confirm_action")],
      (_req, [r]) => {
        answer = r;
        return say("تبين الساعة 5 بدلاً من ذلك؟");
      },
    ]);
    await write(phone, "ممكن الساعة 5؟", turn2.client);
    expect(answer.error).toBe("not_a_clear_yes");
    const booked = await system((tx) =>
      tx.select().from(appointments).where(eq(appointments.startsAt, new Date(memo.unclear))),
    );
    expect(booked.filter((b) => b.createdVia === "whatsapp")).toHaveLength(0);
  });
});

describe("never silent, never stuck", () => {
  it("a message is flagged 'needs reply' as soon as it arrives; the AI clears it once answered", async () => {
    const phone = "0590007752";
    await clearChat(phone);
    let flaggedDuringTurn: boolean | undefined;
    const client = scripted([
      () => {
        // While the AI is still thinking, the chat already shows as waiting for a person.
        return [use("clinic_info")];
      },
      () => say("أهلاً! كيف أقدر أساعدك؟"),
    ]);
    const watching: ClaudeClient = {
      async create(req) {
        flaggedDuringTurn ??= (await convoOf(phone)).needsReply;
        return client.client.create(req);
      },
    };
    await write(phone, "السلام عليكم", watching);
    expect(flaggedDuringTurn).toBe(true);
    expect((await convoOf(phone)).needsReply).toBe(false);
  });

  it("a turn that runs out of time hands over to the team", async () => {
    const phone = "0590007753";
    await clearChat(phone);
    await write(phone, "مرحبا", null); // stored, waits for a person
    const c = await convoOf(phone);
    const never = scripted([]);
    const r = await runReceptionist(derma as never, c.id, {
      client: never.client,
      env: ENV,
      now: NOW,
      notify: async () => {},
      waitingBefore: false,
      budgetMs: 1,
    });
    expect(r.outcome).toBe("failed");
    expect(never.calls).toHaveLength(0);
    expect((await convoOf(phone)).needsReply).toBe(true);
    const [fallback] = await outgoing(phone, "ai_reply");
    expect(fallback.m.body).toBe(FALLBACK_REPLY.ar);
  });

  it("a long reply ends at a full sentence, not mid-word", () => {
    const long = "جملة أولى قصيرة. ".repeat(120);
    const fitted = fitReply(long, 1500);
    expect(fitted.length).toBeLessThanOrEqual(1500);
    expect(fitted.endsWith(".")).toBe(true);
    expect(fitReply("short", 1500)).toBe("short");
  });
});

describe("the real client", () => {
  it("retries once when the service is busy, and marks the prompt for caching", async () => {
    const realFetch = globalThis.fetch;
    const bodies: Record<string, unknown>[] = [];
    let n = 0;
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      n++;
      return n === 1
        ? new Response(JSON.stringify({ error: { type: "overloaded_error" } }), { status: 529 })
        : new Response(
            JSON.stringify({ content: [{ type: "text", text: "hi" }], stop_reason: "end_turn" }),
            { status: 200 },
          );
    }) as typeof fetch;
    try {
      const client = anthropicClient({ ANTHROPIC_API_KEY: "sk-test" })!;
      const res = await client.create({
        system: "You are a receptionist.",
        messages: [{ role: "user", content: "hi" }],
        tools: TOOLS,
        timeoutMs: 20_000,
      });
      expect(res.content).toEqual([{ type: "text", text: "hi" }]);
      expect(n).toBe(2);
      expect(bodies[0].system).toEqual([
        { type: "text", text: "You are a receptionist.", cache_control: { type: "ephemeral" } },
      ]);
      const tools = bodies[0].tools as { cache_control?: unknown }[];
      expect(tools.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
