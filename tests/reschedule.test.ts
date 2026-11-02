/**
 * Rescheduling must never say "all full" when the real reason is something else.
 *  - the appointment being moved never blocks its own new time (earlier times stay available);
 *  - within the cancellation window, a service not bookable online, or a checked-in visit → a reason;
 *  - when the doctor is full, other doctors' free times are offered (patients: online doctors only);
 *  - the same rules on /my, the WhatsApp Reschedule button and the reception calendar.
 * Fixed dates in 2031 with an explicit "now", so results never depend on the real clock.
 */
import { afterAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { appointments, conversations, messages, patients } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { withActor } from "@/lib/auth/db";
import {
  blockTime,
  bookAppointment,
  BookingError,
  moveAppointment,
  moveByPatient,
  rescheduleOptions,
  type Appointment,
} from "@/lib/booking/engine";
import { checkIn } from "@/lib/visits/check-in";
import { handleInbound } from "@/lib/whatsapp/inbound";
import { sendReminder } from "@/lib/whatsapp/outbox";
import { DERMA, member, patient, reception, riyadhAt, RIYADH, service } from "./fixtures";

afterAll(closeDb);

const SARA = member("derma-dr-sara");
const REEM = member("derma-dr-reem");
const time = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(11, 16);
const system = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(DERMA, fn);
const book = (file: string, at: Date, code = "consultation", doctor = SARA): Promise<Appointment> =>
  withActor(reception, (tx) =>
    bookAppointment(tx, reception, {
      branchId: RIYADH,
      patientId: patient(file),
      serviceId: service(code),
      practitionerId: doctor,
      startsAt: at,
    }),
  );
const block = (from: Date, to: Date, doctor = SARA) =>
  withActor(reception, (tx) =>
    blockTime(tx, reception, { branchId: RIYADH, memberId: doctor, startsAt: from, endsAt: to }),
  );
const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: unknown) => (e instanceof BookingError ? e.code : String(e)),
  );

describe("the appointment doesn't block itself", () => {
  it("an earlier time overlapping the current one is offered (patient page) and works", async () => {
    const day = "2031-10-05"; // Sunday
    const now = riyadhAt("08:00", "2031-10-01");
    const a = await book("D-0003", riyadhAt("11:00", day));
    const r = await system((tx) =>
      rescheduleOptions(tx, { appointmentId: a.id, day, patientId: patient("D-0003"), now }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const times = r.sameDoctor.map((s) => time(s.startsAt));
    expect(times).toContain("10:45"); // overlaps 11:00–11:30: before the fix this was missing
    expect(times).not.toContain("11:00"); // its own current time isn't offered as a "new" time
    await system((tx) =>
      moveByPatient(tx, {
        patientId: patient("D-0003"),
        appointmentId: a.id,
        startsAt: riyadhAt("10:45", day),
        now,
      }),
    );
    const [moved] = await system((tx) =>
      tx.select().from(appointments).where(eq(appointments.id, a.id)),
    );
    expect(time(moved.startsAt)).toBe("10:45");
  });
});

describe("clear reasons instead of 'all full'", () => {
  it("within the cancellation window: 'outside_window' with the hours", async () => {
    const a = await book("D-0004", riyadhAt("12:00", "2031-10-06"));
    const r = await system((tx) =>
      rescheduleOptions(tx, {
        appointmentId: a.id,
        day: "2031-10-07",
        patientId: patient("D-0004"),
        now: riyadhAt("20:00", "2031-10-05"), // 16 hours before
      }),
    );
    expect(r).toEqual({ ok: false, reason: "outside_window", hours: 24 });
  });

  it("a service that can't be booked online: 'not_online'", async () => {
    const a = await book("D-0005", riyadhAt("12:00", "2031-10-07"), "thread_lift");
    const r = await system((tx) =>
      rescheduleOptions(tx, {
        appointmentId: a.id,
        day: "2031-10-08",
        patientId: patient("D-0005"),
        now: riyadhAt("08:00", "2031-10-01"),
      }),
    );
    expect(r).toEqual({ ok: false, reason: "not_online" });
  });

  it("after check-in: 'bad_status' (patient and reception)", async () => {
    const a = await book("D-0006", riyadhAt("13:00", "2031-10-07"), "consultation", REEM);
    await withActor(reception, (tx) => checkIn(tx, reception, a.id));
    for (const patientId of [patient("D-0006"), undefined]) {
      const r = await system((tx) =>
        rescheduleOptions(tx, {
          appointmentId: a.id,
          day: "2031-10-08",
          patientId,
          now: riyadhAt("08:00", "2031-10-01"),
        }),
      );
      expect(r).toEqual({ ok: false, reason: "bad_status" });
    }
  });

  it("someone else's appointment can't be looked at", async () => {
    const a = await book("D-0009", riyadhAt("15:00", "2031-10-08"), "consultation", REEM);
    expect(
      await code(
        system((tx) =>
          rescheduleOptions(tx, {
            appointmentId: a.id,
            day: "2031-10-08",
            patientId: patient("D-0010"),
          }),
        ),
      ),
    ).toBe("not_found");
  });
});

describe("the doctor is full → other doctors", () => {
  const day = "2031-10-12"; // Sunday
  const now = riyadhAt("08:00", "2031-10-09");

  it("patient page: the same doctor has none, other online doctors are offered; moving to one works", async () => {
    const a = await book("D-0012", riyadhAt("11:00", day));
    await block(riyadhAt("09:00", day), riyadhAt("11:00", day));
    await block(riyadhAt("11:30", day), riyadhAt("21:00", day));
    const r = await system((tx) =>
      rescheduleOptions(tx, { appointmentId: a.id, day, patientId: patient("D-0012"), now }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sameDoctor).toEqual([]);
    expect(r.otherDoctors.length).toBeGreaterThan(0);
    expect(r.otherDoctors.map((d) => d.practitionerId)).not.toContain(SARA);
    const pick = r.otherDoctors[0];
    await system((tx) =>
      moveByPatient(tx, {
        patientId: patient("D-0012"),
        appointmentId: a.id,
        startsAt: pick.slots[0].startsAt,
        practitionerId: pick.practitionerId,
        now,
      }),
    );
    const [moved] = await system((tx) =>
      tx.select().from(appointments).where(eq(appointments.id, a.id)),
    );
    expect(moved.practitionerId).toBe(pick.practitionerId);
  });

  it("a patient can't move to a doctor of another branch", async () => {
    const a = await book("D-0013", riyadhAt("16:00", "2031-10-13"), "consultation", REEM);
    expect(
      await code(
        system((tx) =>
          moveByPatient(tx, {
            patientId: patient("D-0013"),
            appointmentId: a.id,
            startsAt: riyadhAt("17:00", "2031-10-13"),
            practitionerId: member("derma-dr-lina"), // Jeddah
            now,
          }),
        ),
      ),
    ).toBe("no_doctor");
  });

  it("reception calendar: the same options, and moving onto a busy doctor says so", async () => {
    const day2 = "2031-10-14"; // Tuesday
    const a = await book("D-0015", riyadhAt("11:00", day2));
    const other = await book("D-0016", riyadhAt("12:00", day2));
    await block(riyadhAt("09:00", day2), riyadhAt("11:00", day2));
    await block(riyadhAt("11:30", day2), riyadhAt("12:00", day2));
    await block(riyadhAt("12:30", day2), riyadhAt("21:00", day2));
    const r = await system((tx) => rescheduleOptions(tx, { appointmentId: a.id, day: day2 }));
    expect(r.ok && r.sameDoctor.length).toBe(0);
    expect(r.ok && r.otherDoctors.length).toBeGreaterThan(0);
    expect(
      await code(
        withActor(reception, (tx) =>
          moveAppointment(tx, reception, a.id, { startsAt: riyadhAt("12:00", day2) }),
        ),
      ),
    ).toBe("doctor_busy");
    expect(other.id).toBeTruthy();
  });
});

describe("WhatsApp Reschedule button", () => {
  const ENV = { ...process.env, MESSAGE_DEMO_MODE: "on" };
  const derma = { id: DERMA, slug: "derma", isDemo: true };
  const now = riyadhAt("08:00", "2031-11-01"); // Saturday
  const phoneOf = async (file: string) =>
    (
      await system((tx) =>
        tx
          .select()
          .from(patients)
          .where(eq(patients.id, patient(file))),
      )
    )[0].phone;
  const lastOut = async (phone: string) => {
    const [m] = await system((tx) =>
      tx
        .select({ m: messages })
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(and(eq(conversations.phone, phone), eq(messages.direction, "out")))
        .orderBy(desc(messages.createdAt))
        .limit(1),
    );
    return m.m;
  };
  const tap = (from: string, b: { id: string; title: string }) =>
    handleInbound(
      derma,
      [
        {
          type: "message",
          eventId: `sim-resched-${Date.now()}-${Math.random()}`,
          from,
          kind: "button",
          buttonPayload: b.id,
          buttonTitle: b.title,
        },
      ],
      { env: ENV, notify: async () => {}, now },
    );

  it("doctor full for the whole booking period → other doctors' times; tapping one moves there", async () => {
    const a = await book("D-0017", riyadhAt("11:00", "2031-11-04"));
    await block(riyadhAt("00:00", "2031-11-01"), riyadhAt("11:00", "2031-11-04"));
    await block(riyadhAt("11:30", "2031-11-04"), riyadhAt("23:00", "2031-12-05"));
    await sendReminder(derma, a.id, ENV);
    const [reminder] = await system((tx) =>
      tx
        .select()
        .from(messages)
        .where(and(eq(messages.appointmentId, a.id), eq(messages.kind, "reminder"))),
    );
    const phone = await phoneOf("D-0017");
    await tap(phone, reminder.buttons![1]); // Reschedule
    const offer = await lastOut(phone);
    expect(offer.kind).toBe("reschedule_offer_other");
    expect(offer.body).toContain("سارة العتيبي");
    expect(offer.buttons!.length).toBeGreaterThan(0);
    for (const b of offer.buttons!) expect(b.title.length).toBeLessThanOrEqual(20);
    await tap(phone, offer.buttons![0]);
    expect((await lastOut(phone)).kind).toBe("reschedule_done");
    const [moved] = await system((tx) =>
      tx.select().from(appointments).where(eq(appointments.id, a.id)),
    );
    expect(moved.practitionerId).not.toBe(SARA);
  });

  it("within the window → 'can't change on WhatsApp' (not an empty list)", async () => {
    const a = await book("D-0018", riyadhAt("15:00", "2031-11-01"), "consultation", REEM);
    await sendReminder(derma, a.id, ENV);
    const [reminder] = await system((tx) =>
      tx
        .select()
        .from(messages)
        .where(and(eq(messages.appointmentId, a.id), eq(messages.kind, "reminder"))),
    );
    const phone = await phoneOf("D-0018");
    await tap(phone, reminder.buttons![1]);
    const reply = await lastOut(phone);
    expect(reply.kind).toBe("change_too_late");
    expect(reply.body).toContain("24");
  });

  it("a service that isn't online → explained, never an empty offer", async () => {
    const a = await book("D-0020", riyadhAt("12:00", "2031-11-10"), "thread_lift", REEM);
    await sendReminder(derma, a.id, ENV);
    const [reminder] = await system((tx) =>
      tx
        .select()
        .from(messages)
        .where(and(eq(messages.appointmentId, a.id), eq(messages.kind, "reminder"))),
    );
    const phone = await phoneOf("D-0020");
    await tap(phone, reminder.buttons![1]);
    expect((await lastOut(phone)).kind).toBe("reschedule_unavailable");
  });
});

describe("live data shape (Dr. Sara almost full)", () => {
  const day = "2031-10-19"; // Sunday
  const now = riyadhAt("08:00", "2031-10-15");

  it("other doctors are listed even when Dr. Sara still has a time or two", async () => {
    const a = await book("D-0021", riyadhAt("11:00", day));
    // Sara is busy all day except 18:00–18:30.
    await block(riyadhAt("09:00", day), riyadhAt("11:00", day));
    await block(riyadhAt("11:30", day), riyadhAt("18:00", day));
    await block(riyadhAt("18:30", day), riyadhAt("21:00", day));
    const r = await system((tx) =>
      rescheduleOptions(tx, { appointmentId: a.id, day, patientId: patient("D-0021"), now }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sameDoctor.map((s) => time(s.startsAt))).toEqual(["18:00"]);
    expect(r.otherDoctors.length).toBeGreaterThan(0); // the screen lists them too (not only 18:00)
  });

  it("a closed day (Friday) says 'closed', not 'no free times'", async () => {
    const a = await book("D-0022", riyadhAt("12:00", "2031-10-20"), "consultation", REEM);
    for (const patientId of [patient("D-0022"), undefined]) {
      const r = await system((tx) =>
        rescheduleOptions(tx, { appointmentId: a.id, day: "2031-10-24", patientId, now }),
      );
      expect(r).toEqual({ ok: false, reason: "closed" });
    }
  });
});
