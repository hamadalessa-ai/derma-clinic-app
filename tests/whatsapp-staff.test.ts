/**
 * Reception's WhatsApp tools: replying (24-hour rule), new numbers linked to a patient or turned
 * into a new patient, recording consent, "doctor running late", and the admin's wording rules.
 */
import { afterAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { conversations, messages, patients } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { withActor } from "@/lib/auth/db";
import { PermissionError } from "@/lib/auth/permissions";
import { bookAppointment, changeStatus, type Appointment } from "@/lib/booking/engine";
import { TemplateError, updateTemplate } from "@/lib/whatsapp/admin";
import { handleInbound } from "@/lib/whatsapp/inbound";
import { sendReminder } from "@/lib/whatsapp/outbox";
import {
  createPatientFromConversation,
  doctorRunningLate,
  linkConversation,
  listConversations,
  setWhatsappConsent,
  staffReply,
  WhatsAppError,
} from "@/lib/whatsapp/staff";
import {
  admin,
  DERMA,
  drSara,
  member,
  patient,
  reception,
  riyadhAt,
  RIYADH,
  service,
} from "./fixtures";

// These tests use the demo simulator; the flag is put back afterwards.
const savedDemoFlag = process.env.MESSAGE_DEMO_MODE;
process.env.MESSAGE_DEMO_MODE = "on";
afterAll(async () => {
  if (savedDemoFlag === undefined) delete process.env.MESSAGE_DEMO_MODE;
  else process.env.MESSAGE_DEMO_MODE = savedDemoFlag;
  await closeDb();
});
const derma = { id: DERMA, slug: "derma", isDemo: true };
const system = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(DERMA, fn);
let k = 0;
const newPhone = () => `0595${String(Date.now() + k++).slice(-6)}`;

const write = (from: string, text: string, profileName?: string) =>
  handleInbound(
    derma,
    [
      {
        type: "message",
        eventId: `sim-staff-${Date.now()}-${k++}`,
        from,
        kind: "text",
        text,
        profileName,
      },
    ],
    {
      notify: async () => {},
    },
  );
const convoOf = async (phone: string) =>
  (await system((tx) => tx.select().from(conversations).where(eq(conversations.phone, phone))))[0];
const caught = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: Error) => (e instanceof WhatsAppError || e instanceof TemplateError ? e.code : e.name),
  );

describe("replying from the inbox", () => {
  it("inside the 24-hour window: sent, and the chat no longer needs a reply", async () => {
    const phone = newPhone();
    await write(phone, "هل يوجد موعد اليوم؟");
    const c = await convoOf(phone);
    expect(c.needsReply).toBe(true);
    const inbox = await withActor(reception, (tx) => listConversations(tx, "needs_reply"));
    expect(inbox.some((x) => x.id === c.id && x.patient === null && x.canReplyFreely)).toBe(true);
    const r = await staffReply(derma, reception, c.id, "نعم، الساعة 5 مساءً متاح.");
    expect(r.outcome).toBe("sent");
    expect((await convoOf(phone)).needsReply).toBe(false);
    const [reply] = await system((tx) =>
      tx
        .select()
        .from(messages)
        .where(and(eq(messages.conversationId, c.id), eq(messages.kind, "staff_reply"))),
    );
    expect(reply).toMatchObject({
      direction: "out",
      sentBy: reception.userId,
      body: "نعم، الساعة 5 مساءً متاح.",
    });
  });

  it("outside the window: refused (only approved templates may be sent)", async () => {
    const phone = newPhone();
    await write(phone, "مرحبا");
    const c = await convoOf(phone);
    await system((tx) =>
      tx
        .update(conversations)
        .set({ lastInboundAt: sql`now() - interval '25 hours'` })
        .where(eq(conversations.id, c.id)),
    );
    expect(await caught(staffReply(derma, reception, c.id, "رد متأخر"))).toBe("outside_window");
  });

  it("doctors can't use the inbox", async () => {
    const phone = newPhone();
    await write(phone, "سؤال");
    const c = await convoOf(phone);
    expect(await caught(staffReply(derma, drSara, c.id, "x"))).toBe("PermissionError");
  });
});

describe("new numbers ('not a patient yet')", () => {
  it("can be linked to an existing patient", async () => {
    const phone = newPhone();
    await write(phone, "أنا مريضة لديكم برقم جديد", "Sara");
    const c = await convoOf(phone);
    expect(c.patientId).toBeNull();
    await withActor(reception, (tx) => linkConversation(tx, reception, c.id, patient("D-0021")));
    expect((await convoOf(phone)).patientId).toBe(patient("D-0021"));
    expect(
      await caught(
        withActor(reception, (tx) => linkConversation(tx, reception, c.id, patient("D-0022"))),
      ),
    ).toBe("already_linked");
  });

  it("can become a new patient (needs completion, booked via WhatsApp)", async () => {
    const phone = newPhone();
    await write(phone, "أريد حجز استشارة", "Noura");
    const c = await convoOf(phone);
    const p = await withActor(reception, (tx) =>
      createPatientFromConversation(tx, reception, {
        conversationId: c.id,
        fullNameAr: "نورة الشمري",
        gender: "female",
        filePrefix: "D",
      }),
    );
    expect(p).toMatchObject({ phone, createdVia: "whatsapp", needsCompletion: true, isFake: true });
    expect(p.fileNumber).toMatch(/^D-\d{4}$/);
    expect((await convoOf(phone)).patientId).toBe(p.id);
  });
});

describe("WhatsApp consent recorded by reception", () => {
  it("switching it on lets reminders go; switching it off stops them", async () => {
    await system((tx) =>
      tx
        .update(patients)
        .set({ whatsappOptInAt: null })
        .where(eq(patients.id, patient("D-0029"))),
    );
    const a = await withActor(reception, (tx) =>
      bookAppointment(tx, reception, {
        branchId: RIYADH,
        patientId: patient("D-0029"),
        serviceId: service("consultation"),
        practitionerId: member("derma-dr-faisal"),
        startsAt: riyadhAt("10:00", "2033-06-05"),
      }),
    );
    expect((await sendReminder(derma, a.id)).outcome).toBe("skipped");
    const p = await withActor(reception, (tx) =>
      setWhatsappConsent(tx, reception, patient("D-0029"), { optIn: true, language: "en" }),
    );
    expect(p).toMatchObject({ whatsappOptInSource: "reception", preferredLanguage: "en" });
    expect((await sendReminder(derma, a.id)).outcome).toBe("sent");
  });
});

describe("doctor running late", () => {
  it("messages that doctor's patients still to come that day — once per tap", async () => {
    const day = "2033-06-06";
    const book = (file: string, time: string): Promise<Appointment> =>
      withActor(reception, (tx) =>
        bookAppointment(tx, reception, {
          branchId: RIYADH,
          patientId: patient(file),
          serviceId: service("consultation"),
          practitionerId: member("derma-dr-sara"),
          startsAt: riyadhAt(time, day),
        }),
      );
    const a = await book("D-0003", "10:00");
    const b = await book("D-0004", "11:00");
    const gone = await book("D-0005", "12:00");
    await withActor(reception, (tx) =>
      changeStatus(tx, reception, gone.id, "cancelled", { reason: "x" }),
    );
    const other = await withActor(reception, (tx) =>
      bookAppointment(tx, reception, {
        branchId: RIYADH,
        patientId: patient("D-0006"),
        serviceId: service("consultation"),
        practitionerId: member("derma-dr-reem"),
        startsAt: riyadhAt("10:00", day),
      }),
    );
    const r = await doctorRunningLate(derma, reception, {
      memberId: member("derma-dr-sara"),
      day,
      minutes: 20,
      batchId: "batch-1",
    });
    expect(r).toEqual({ affected: 2, sent: 2 });
    const again = await doctorRunningLate(derma, reception, {
      memberId: member("derma-dr-sara"),
      day,
      minutes: 20,
      batchId: "batch-1",
    });
    expect(again.sent).toBe(0);
    const late = await system((tx) =>
      tx.select().from(messages).where(eq(messages.kind, "running_late")),
    );
    const ids = late.map((m) => m.appointmentId);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(ids).not.toContain(gone.id);
    expect(ids).not.toContain(other.id);
    expect(late.find((m) => m.appointmentId === a.id)!.body).toContain("20");
    expect(
      await caught(
        doctorRunningLate(derma, drSara, { memberId: member("derma-dr-sara"), day, minutes: 10 }),
      ),
    ).toBe("PermissionError");
  });
});

describe("message wording (admin)", () => {
  it("only known placeholders; codes can't be switched off; only admins", async () => {
    const upd = (
      actor: typeof admin,
      kind: "reminder" | "verification_code",
      over: Partial<{ enabled: boolean; bodyAr: string; bodyEn: string }> = {},
    ) =>
      caught(
        withActor(actor, (tx) =>
          updateTemplate(tx, actor, {
            kind,
            enabled: true,
            bodyAr: "تذكير {patient_first_name} {time}",
            bodyEn: "Reminder {patient_first_name} {time}",
            ...over,
          }),
        ),
      );
    expect(await upd(admin, "reminder", { bodyAr: "مرحبا {phone_number}" })).toBe(
      "unknown_placeholder",
    );
    expect(await upd(admin, "reminder", { bodyEn: "   " })).toBe("empty_text");
    expect(
      await upd(admin, "verification_code", { enabled: false, bodyAr: "{code}", bodyEn: "{code}" }),
    ).toBe("cannot_disable");
    expect(await upd(reception, "reminder")).toBe("PermissionError");
    expect(await upd(admin, "reminder")).toBe("ok");
  });
});

it("permission errors are real PermissionErrors", () => {
  expect(new PermissionError("whatsapp:inbox").name).toBe("PermissionError");
});
