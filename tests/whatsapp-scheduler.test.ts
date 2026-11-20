/**
 * Scheduled WhatsApp messages: reminders (24 h before, catch-up until 2 h before), post-care
 * (24 h after), no-show follow-ups, recalls; never twice (even run at the same moment);
 * quiet hours 22:00–08:00 Riyadh; demo fast-forward; opt-out respected; the cron endpoint is
 * protected. Most tests use a fixed "now" in 2033 so other tests' bookings never interfere.
 */
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/cron/messages/route";
import { closeDb } from "@/db/client";
import { messages, services } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { withActor } from "@/lib/auth/db";
import { addDays, riyadhDay } from "@/lib/booking/time";
import { bookAppointment, changeStatus, type Appointment } from "@/lib/booking/engine";
import { checkIn } from "@/lib/visits/check-in";
import { inQuietHours, runScheduledMessages } from "@/lib/whatsapp/scheduler";
import { DERMA, member, patient, reception, riyadhAt, RIYADH, service } from "./fixtures";

afterAll(closeDb);

const ENV = { ...process.env, MESSAGE_DEMO_MODE: "on" };
const derma = { id: DERMA, slug: "derma", isDemo: true };
const system = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(DERMA, fn);

async function book(
  file: string,
  day: string,
  code = "facial_treatment",
  opts: { allowPast?: boolean; doctor?: string; from?: string } = {},
): Promise<Appointment> {
  // First free quarter hour of the day, with the given doctor or any Riyadh doctor.
  const doctors = opts.doctor
    ? [opts.doctor]
    : ["derma-dr-reem", "derma-dr-faisal", "derma-dr-sara"];
  const start = opts.from
    ? Number(opts.from.slice(0, 2)) * 60 + Number(opts.from.slice(3))
    : 10 * 60;
  for (let m = start; m < 20 * 60; m += 15) {
    const time = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    for (const doctor of doctors) {
      try {
        return await withActor(reception, (tx) =>
          bookAppointment(tx, reception, {
            branchId: RIYADH,
            patientId: patient(file),
            serviceId: service(code),
            practitionerId: member(doctor),
            startsAt: riyadhAt(time, day),
            allowPast: opts.allowPast,
          }),
        );
      } catch {
        /* taken or outside hours: try the next one */
      }
    }
  }
  throw new Error(`no free time on ${day}`);
}

async function complete(a: Appointment) {
  await withActor(reception, async (tx) => {
    await checkIn(tx, reception, a.id);
    await changeStatus(tx, reception, a.id, "in_session");
    await changeStatus(tx, reception, a.id, "completed");
  });
}

const sentFor = (appointmentId: string, kind: string) =>
  system((tx) =>
    tx
      .select()
      .from(messages)
      .where(and(eq(messages.appointmentId, appointmentId), eq(messages.kind, kind))),
  );

const hoursBefore = (d: Date, h: number) => new Date(d.getTime() - h * 3600_000);

describe("reminders", () => {
  it("sent from 24 hours before; a late run still sends (catch-up); too close = not sent", async () => {
    const a = await book("D-0003", "2033-05-01");
    expect(
      (await runScheduledMessages(derma, { now: hoursBefore(a.startsAt, 30), env: ENV })).sent,
    ).toEqual({});
    expect(await sentFor(a.id, "reminder")).toHaveLength(0);
    // The run at 24 h was missed; the next one is 5 hours later — still sent.
    const r = await runScheduledMessages(derma, {
      now: hoursBefore(a.startsAt, 19),
      env: ENV,
      ignoreQuietHours: true,
    });
    expect(r.sent.reminder).toBeGreaterThanOrEqual(1);
    expect(await sentFor(a.id, "reminder")).toHaveLength(1);

    const late = await book("D-0004", "2033-05-02");
    await runScheduledMessages(derma, {
      now: hoursBefore(late.startsAt, 1),
      env: ENV,
      ignoreQuietHours: true,
    });
    expect(await sentFor(late.id, "reminder")).toHaveLength(0);
  });

  it("never twice: run twice in a row and three times at the same moment → one reminder", async () => {
    const a = await book("D-0005", "2033-05-03");
    const now = hoursBefore(a.startsAt, 20);
    const opts = { now, env: ENV, ignoreQuietHours: true };
    await runScheduledMessages(derma, opts);
    await runScheduledMessages(derma, opts);
    await Promise.all([1, 2, 3].map(() => runScheduledMessages(derma, opts)));
    expect(await sentFor(a.id, "reminder")).toHaveLength(1);
  });

  it("out of time: nothing new starts, 'more' says call again; the next call finishes", async () => {
    const a = await book("D-0007", "2033-05-05");
    const opts = { now: hoursBefore(a.startsAt, 20), env: ENV, ignoreQuietHours: true };
    const first = await runScheduledMessages(derma, { ...opts, budgetMs: -1 });
    expect(first.more).toBe(true);
    expect(await sentFor(a.id, "reminder")).toHaveLength(0);
    const second = await runScheduledMessages(derma, opts);
    expect(second.more).toBe(false);
    expect(await sentFor(a.id, "reminder")).toHaveLength(1);
    // Already sent: skipped up front, not even tried again.
    const third = await runScheduledMessages(derma, opts);
    expect(third.sent.reminder ?? 0).toBe(0);
    expect(third.skipped.reminder ?? 0).toBe(0);
  });

  it("opted-out patients get no reminder", async () => {
    const a = await book("D-0014", "2033-05-04"); // seeded: sent STOP
    await runScheduledMessages(derma, {
      now: hoursBefore(a.startsAt, 20),
      env: ENV,
      ignoreQuietHours: true,
    });
    expect(await sentFor(a.id, "reminder")).toHaveLength(0);
  });
});

describe("quiet hours (22:00–08:00 Riyadh)", () => {
  it("nothing is sent at night; it goes out after 08:00", async () => {
    expect(inQuietHours(riyadhAt("22:00", "2033-05-07"))).toBe(true);
    expect(inQuietHours(riyadhAt("07:59", "2033-05-07"))).toBe(true);
    expect(inQuietHours(riyadhAt("08:00", "2033-05-07"))).toBe(false);
    expect(inQuietHours(riyadhAt("21:59", "2033-05-07"))).toBe(false);

    const a = await book("D-0006", "2033-05-08", "facial_treatment", { from: "12:00" });
    const night = riyadhAt("23:00", "2033-05-07");
    const r = await runScheduledMessages(derma, { now: night, env: ENV });
    expect(r.quietHours).toBe(true);
    expect(await sentFor(a.id, "reminder")).toHaveLength(0);
    await runScheduledMessages(derma, { now: riyadhAt("08:05", "2033-05-08"), env: ENV });
    expect(await sentFor(a.id, "reminder")).toHaveLength(1);
  });

  it("demo: 'ignore quiet hours' sends at night", async () => {
    const a = await book("D-0009", "2033-05-05");
    await runScheduledMessages(derma, {
      now: hoursBefore(a.startsAt, 12), // late the evening before
      env: ENV,
      ignoreQuietHours: true,
    });
    expect(await sentFor(a.id, "reminder")).toHaveLength(1);
  });
});

describe("post-care, no-show and recall", () => {
  it("post-care check-in 24 hours after a completed visit (demo fast-forward: right away)", async () => {
    // A short service with a post-care question, so it fits between the demo week's bookings.
    await system((tx) =>
      tx
        .update(services)
        .set({ postCareAr: "كيف حالك بعد الاستشارة؟" })
        .where(eq(services.id, service("consultation"))),
    );
    try {
      // A real visit two days ago (not a Friday), completed.
      let day = addDays(riyadhDay(new Date()), -2);
      if (new Date(`${day}T12:00:00+03:00`).getUTCDay() === 5) day = addDays(day, -1);
      const a = await book("D-0010", day, "consultation", { allowPast: true });
      await complete(a);
      const r = await runScheduledMessages(derma, { env: ENV, ignoreQuietHours: true });
      expect(r.sent.post_care ?? 0).toBeGreaterThanOrEqual(1);
      const [m] = await sentFor(a.id, "post_care");
      expect(m.body).toContain("كيف حالك بعد الاستشارة؟");
      expect(m.buttons?.map((b) => b.title)).toEqual(["كل شيء جيد", "لدي استفسار/قلق"]);

      // Fast-forward (demo button): a visit for tomorrow, completed early today, would normally get
      // its check-in tomorrow — the demo button sends it right away.
      let tomorrow = addDays(riyadhDay(new Date()), 1);
      if (new Date(`${tomorrow}T12:00:00+03:00`).getUTCDay() === 5) {
        tomorrow = addDays(tomorrow, 1);
      }
      const early = await book("D-0012", tomorrow, "consultation", { from: "17:00" });
      await complete(early);
      await runScheduledMessages(derma, { env: ENV, ignoreQuietHours: true });
      expect(await sentFor(early.id, "post_care")).toHaveLength(0);
      await runScheduledMessages(derma, { env: ENV, ignoreQuietHours: true, fastForwardHours: 24 });
      expect(await sentFor(early.id, "post_care")).toHaveLength(1);
    } finally {
      await system((tx) =>
        tx
          .update(services)
          .set({ postCareAr: null })
          .where(eq(services.id, service("consultation"))),
      );
    }
  });

  it("no-show follow-up with a booking link", async () => {
    const a = await book("D-0013", "2033-05-02", "consultation", { doctor: "derma-dr-sara" });
    await withActor(reception, (tx) => changeStatus(tx, reception, a.id, "no_show"));
    await runScheduledMessages(derma, {
      now: new Date(a.startsAt.getTime() + 3 * 3600_000),
      env: ENV,
      ignoreQuietHours: true,
    });
    const [m] = await sentFor(a.id, "no_show");
    expect(m.body).toContain("/book");
  });

  it("recall after the service's delay (facial: 30 days), not when a newer visit is booked", async () => {
    const a = await book("D-0015", "2033-03-27", "facial_treatment", { doctor: "derma-dr-sara" });
    await complete(a);
    const b = await book("D-0016", "2033-03-27", "facial_treatment", { doctor: "derma-dr-sara" });
    await complete(b);
    await book("D-0016", "2033-05-08", "facial_treatment", { doctor: "derma-dr-sara" }); // already rebooked
    const at = (d: string) => riyadhAt("12:00", d);
    await runScheduledMessages(derma, { now: at("2033-04-20"), env: ENV }); // only 24 days
    expect(await sentFor(a.id, "recall")).toHaveLength(0);
    await runScheduledMessages(derma, { now: at("2033-05-01"), env: ENV }); // 35 days
    const [m] = await sentFor(a.id, "recall");
    expect(m.body).toContain("/book");
    expect(await sentFor(b.id, "recall")).toHaveLength(0);
  });
});

describe("the hourly endpoint", () => {
  it("is refused without CRON_SECRET and works with it", async () => {
    const saved = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "a-test-cron-secret-abcdef";
    try {
      const call = (auth?: string) =>
        GET(
          new NextRequest("http://x/api/cron/messages", {
            headers: auth ? { authorization: auth } : {},
          }),
        );
      expect((await call()).status).toBe(401);
      expect((await call("Bearer nope")).status).toBe(401);
      const ok = await call("Bearer a-test-cron-secret-abcdef");
      expect(ok.status).toBe(200);
      expect((await ok.json()).ok).toBe(true);
    } finally {
      if (saved) process.env.CRON_SECRET = saved;
      else delete process.env.CRON_SECRET;
    }
  });
});
