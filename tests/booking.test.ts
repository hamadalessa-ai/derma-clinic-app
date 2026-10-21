import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { auditLogs, reservations } from "@/db/schema";
import { withActor } from "@/lib/auth/db";
import {
  blockTime,
  bookAppointment,
  BookingError,
  changeStatus,
  findFreeSlots,
  moveAppointment,
  type BookInput,
} from "@/lib/booking/engine";
import {
  drFaisal,
  drLina,
  drReem,
  drSara,
  JEDDAH,
  member,
  patient,
  reception,
  riyadhAt,
  RIYADH,
  room,
  service,
  device,
} from "./fixtures";

afterAll(closeDb);

const book = (input: Partial<BookInput> & { startsAt: Date }, actor = reception) =>
  withActor(actor, (tx) =>
    bookAppointment(tx, actor, {
      branchId: RIYADH,
      patientId: patient("D-0002"),
      serviceId: service("botox"),
      practitionerId: member("derma-dr-sara"),
      ...input,
    }),
  );

async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof BookingError) return e.code;
    throw e;
  }
  return "ok";
}

describe("booking basics", () => {
  const day = "2030-01-13"; // a Sunday

  it("books with the service's duration and buffer, and reserves doctor + room", async () => {
    const a = await book({ startsAt: riyadhAt("10:00", day) });
    expect(a.endsAt.toISOString()).toBe(riyadhAt("10:30", day).toISOString()); // Botox: 30 min
    expect(a.blockedUntil.toISOString()).toBe(riyadhAt("10:40", day).toISOString()); // +10 min buffer
    expect(a.status).toBe("booked");
    const res = await withActor(reception, (tx) =>
      tx.select().from(reservations).where(eq(reservations.appointmentId, a.id)),
    );
    expect(res.map((r) => r.resourceKind).sort()).toEqual(["practitioner", "room"]);
    const logs = await withActor(reception, (tx) =>
      tx
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityId, a.id), eq(auditLogs.action, "appointment.create"))),
    );
    expect(logs).toHaveLength(1);
  });

  it("a service that needs a device gets that device, in the device's room", async () => {
    const a = await book({
      startsAt: riyadhAt("11:00", day),
      serviceId: service("laser_hair_removal"),
      practitionerId: member("derma-dr-faisal"),
    });
    expect(a.deviceId).toBe(device("ruh-lhr"));
    expect(a.roomId).toBe(room("ruh-3"));
  });

  it("the same doctor cannot be double-booked, including the buffer", async () => {
    expect(await code(book({ startsAt: riyadhAt("10:15", day) }))).toBe("slot_taken");
    expect(await code(book({ startsAt: riyadhAt("10:30", day) }))).toBe("slot_taken"); // inside buffer
    expect(await code(book({ startsAt: riyadhAt("10:40", day) }))).toBe("ok"); // right after buffer
  });

  it("the same room cannot be double-booked, but another free room is picked automatically", async () => {
    const first = await book({
      startsAt: riyadhAt("13:00", day),
      practitionerId: member("derma-dr-reem"),
    });
    expect(
      await code(
        book({
          startsAt: riyadhAt("13:00", day),
          practitionerId: member("derma-dr-sara"),
          roomId: first.roomId,
        }),
      ),
    ).toBe("slot_taken");
    const other = await book({
      startsAt: riyadhAt("13:00", day),
      practitionerId: member("derma-dr-sara"),
    });
    expect(other.roomId).not.toBe(first.roomId);
  });

  it("the only Morpheus8 cannot be used by two doctors at once", async () => {
    await book({
      startsAt: riyadhAt("16:00", day),
      serviceId: service("morpheus8"),
      practitionerId: member("derma-dr-sara"),
    });
    expect(
      await code(
        book({
          startsAt: riyadhAt("16:30", day),
          serviceId: service("morpheus8"),
          practitionerId: member("derma-dr-reem"),
        }),
      ),
    ).toBe("slot_taken");
  });
});

describe("two people booking the same slot at the same moment", () => {
  it("only one of them succeeds (the database decides)", async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        book({
          startsAt: riyadhAt("10:00", "2030-01-14"),
          practitionerId: member("derma-dr-reem"),
          patientId: patient(`D-00${10 + i}`),
        }),
      ),
    );
    const ok = attempts.filter((a) => a.status === "fulfilled");
    const refused = attempts.filter((a) => a.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(5);
    for (const r of refused) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(BookingError);
      expect(((r as PromiseRejectedResult).reason as BookingError).code).toBe("slot_taken");
    }
  });

  it("also for the same device with different doctors", async () => {
    const attempts = await Promise.allSettled(
      [member("derma-dr-sara"), member("derma-dr-faisal"), member("derma-dr-reem")].map((doc) =>
        book({
          startsAt: riyadhAt("15:00", "2030-01-14"),
          serviceId: service("ultherapy"),
          practitionerId: doc,
        }),
      ),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
  });
});

describe("working hours, breaks and holidays", () => {
  const day = "2030-01-15"; // Tuesday
  it.each([
    ["before opening", "09:30", "outside_hours"],
    ["running past closing", "19:45", "outside_hours"],
    ["during the 14:00–15:00 break", "13:45", "during_break"],
  ])("refuses a booking %s", async (_label, time, expected) => {
    expect(await code(book({ startsAt: riyadhAt(time, day) }))).toBe(expected);
  });

  it("refuses Fridays (doctor not working)", async () => {
    expect(await code(book({ startsAt: riyadhAt("11:00", "2030-01-18") }))).toBe("not_working");
  });

  it("refuses clinic holidays (Founding Day 2027)", async () => {
    expect(await code(book({ startsAt: riyadhAt("11:00", "2027-02-22") }))).toBe("closed");
  });

  it("refuses a Jeddah doctor in Riyadh, and a receptionist as the doctor", async () => {
    expect(
      await code(
        book({ startsAt: riyadhAt("11:00", day), practitionerId: member("derma-dr-lina") }),
      ),
    ).toBe("wrong_branch");
    expect(
      await code(
        book({ startsAt: riyadhAt("11:00", day), practitionerId: member("derma-rec-ruh1") }),
      ),
    ).toBe("not_practitioner");
  });

  it("refuses times in the past", async () => {
    expect(await code(book({ startsAt: new Date(Date.now() - 86400_000) }))).toBe("in_past");
  });

  it("refuses another clinic's patient (invisible through RLS)", async () => {
    expect(
      await code(
        book({
          startsAt: riyadhAt("11:00", day),
          patientId: "00000000-0000-5000-8000-000000000000",
        }),
      ),
    ).toBe("not_found");
  });
});

describe("statuses, cancelling and moving", () => {
  const day = "2030-01-16"; // Wednesday

  it("follows the allowed status steps and logs each change", async () => {
    const a = await book({ startsAt: riyadhAt("10:00", day) });
    const status = (to: Parameters<typeof changeStatus>[3]) =>
      code(withActor(reception, (tx) => changeStatus(tx, reception, a.id, to)));
    expect(await status("confirmed")).toBe("ok");
    expect(await status("confirmed")).toBe("ok"); // double tap: no-op
    expect(await status("booked")).toBe("bad_status");
    expect(await status("arrived")).toBe("not_allowed"); // only via check-in
    expect(await status("completed")).toBe("bad_status");
    const logs = await withActor(reception, (tx) =>
      tx
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityId, a.id), eq(auditLogs.action, "appointment.status"))),
    );
    expect(logs.map((l) => l.metadata)).toEqual([{ from: "booked", to: "confirmed" }]);
  });

  it("cancelling frees the slot", async () => {
    const a = await book({ startsAt: riyadhAt("11:00", day) });
    expect(await code(book({ startsAt: riyadhAt("11:00", day) }))).toBe("slot_taken");
    await withActor(reception, (tx) =>
      changeStatus(tx, reception, a.id, "cancelled", { reason: "patient asked" }),
    );
    expect(await code(book({ startsAt: riyadhAt("11:00", day) }))).toBe("ok");
  });

  it("moving frees the old slot and refuses a taken one", async () => {
    const a = await book({ startsAt: riyadhAt("16:00", day) });
    const b = await book({ startsAt: riyadhAt("17:00", day) });
    expect(
      await code(
        withActor(reception, (tx) =>
          moveAppointment(tx, reception, a.id, { startsAt: riyadhAt("17:15", day) }),
        ),
      ),
    ).toBe("slot_taken");
    const moved = await withActor(reception, (tx) =>
      moveAppointment(tx, reception, a.id, { startsAt: riyadhAt("18:00", day) }),
    );
    expect(moved.startsAt.toISOString()).toBe(riyadhAt("18:00", day).toISOString());
    expect(await code(book({ startsAt: riyadhAt("16:00", day) }))).toBe("ok"); // old slot free
    expect(b.status).toBe("booked");
  });
});

describe("blocked time", () => {
  const day = "2030-01-17"; // Thursday

  it("a doctor's blocked time can't be booked, and can't be placed over a booking", async () => {
    await withActor(drFaisal, (tx) =>
      blockTime(tx, drFaisal, {
        branchId: RIYADH,
        memberId: member("derma-dr-faisal"),
        startsAt: riyadhAt("10:00", day),
        endsAt: riyadhAt("12:00", day),
        reason: "مؤتمر",
      }),
    );
    expect(
      await code(
        book({ startsAt: riyadhAt("11:00", day), practitionerId: member("derma-dr-faisal") }),
      ),
    ).toBe("slot_taken");
    await book({ startsAt: riyadhAt("15:00", day), practitionerId: member("derma-dr-faisal") });
    expect(
      await code(
        withActor(drFaisal, (tx) =>
          blockTime(tx, drFaisal, {
            branchId: RIYADH,
            memberId: member("derma-dr-faisal"),
            startsAt: riyadhAt("15:00", day),
            endsAt: riyadhAt("16:00", day),
          }),
        ),
      ),
    ).toBe("slot_taken");
  });
});

describe("next free slot", () => {
  const day = "2030-01-20"; // Sunday

  it("skips taken times and the break, and only offers bookable slots", async () => {
    await book({ startsAt: riyadhAt("10:00", day), practitionerId: member("derma-dr-reem") });
    const slots = await withActor(reception, (tx) =>
      findFreeSlots(tx, {
        branchId: RIYADH,
        serviceId: service("botox"),
        practitionerId: member("derma-dr-reem"),
        from: riyadhAt("10:00", day),
        limit: 30,
      }),
    );
    expect(slots[0].startsAt.toISOString()).toBe(riyadhAt("10:45", day).toISOString()); // 10:00 + 30 + 10 → next 15-min step
    const times = slots.map((s) => s.startsAt.toISOString());
    expect(times).not.toContain(riyadhAt("13:45", day).toISOString()); // would run into the break
    expect(times).not.toContain(riyadhAt("14:00", day).toISOString());
    // Every offered slot can actually be booked.
    expect(
      await code(book({ startsAt: slots[0].startsAt, practitionerId: member("derma-dr-reem") })),
    ).toBe("ok");
  });

  it("for a device service, only offers times when the device is free", async () => {
    await book({
      startsAt: riyadhAt("10:00", day),
      serviceId: service("ultherapy"),
      practitionerId: member("derma-dr-sara"),
    });
    const [first] = await withActor(reception, (tx) =>
      findFreeSlots(tx, {
        branchId: RIYADH,
        serviceId: service("ultherapy"),
        from: riyadhAt("10:00", day),
      }),
    );
    // Ultherapy 90 min + 15 buffer → the device is busy until 11:45.
    expect(first.startsAt.getTime()).toBeGreaterThanOrEqual(riyadhAt("11:45", day).getTime());
    expect(first.deviceId).toBe(device("ruh-ulth"));
  });

  it("a Jeddah receptionist gets Jeddah doctors only", async () => {
    const slots = await withActor(drLina, (tx) =>
      findFreeSlots(tx, {
        branchId: JEDDAH,
        serviceId: service("consultation"),
        from: riyadhAt("10:00", day),
        limit: 10,
      }),
    );
    expect(slots.length).toBeGreaterThan(0);
    expect(new Set(slots.map((s) => s.practitionerId))).toEqual(
      new Set([member("derma-dr-lina"), member("derma-dr-majed")]),
    );
  });
});

void drSara;
void drReem;
