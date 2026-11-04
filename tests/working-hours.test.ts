/**
 * Flexible working hours: several shifts a day (each at a branch), one-off changes for single
 * dates (day off / special hours / extra working day), who may change whose hours, and the list
 * of booked appointments that no longer fit (nothing is moved or cancelled).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { appointments, auditLogs, scheduleExceptions, staffSchedules } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { withActor, type Actor } from "@/lib/auth/db";
import { bookAppointment, BookingError, findFreeSlots } from "@/lib/booking/engine";
import {
  addHoursException,
  editableDoctors,
  HoursError,
  loadWorkingHours,
  removeHoursException,
  saveWeeklyHours,
  type WeeklyShiftInput,
} from "@/lib/booking/working-hours";
import { updateSettings } from "@/lib/settings";
import { loadDoctors } from "@/lib/views/schedule";
import {
  admin,
  DERMA,
  drLina,
  JEDDAH,
  member,
  patient,
  reception,
  receptionJeddah,
  RIYADH,
  riyadhAt,
  service,
} from "./fixtures";

const MAJED = member("derma-dr-majed");
const drMajed: Actor = {
  tenantId: DERMA,
  userId: "usr_derma-dr-majed",
  roles: ["practitioner"],
  memberId: MAJED,
  restrictedBranchId: JEDDAH,
};
const SUN = "2037-03-08";
const TUE = "2037-03-10";
const FRI = "2037-03-13";
/** "Now" for the conflict list (it looks 180 days ahead). */
const NOW = riyadhAt("08:00", "2037-03-01");

let original: (typeof staffSchedules.$inferSelect)[] = [];
beforeAll(async () => {
  original = await withTenant(DERMA, (tx) =>
    tx.select().from(staffSchedules).where(eq(staffSchedules.memberId, MAJED)),
  );
});
afterAll(async () => {
  // Put Dr. Majed's demo hours back for the other test files.
  await withTenant(DERMA, async (tx) => {
    await tx.delete(scheduleExceptions).where(eq(scheduleExceptions.memberId, MAJED));
    await tx.delete(staffSchedules).where(eq(staffSchedules.memberId, MAJED));
    if (original.length) await tx.insert(staffSchedules).values(original);
  });
  await closeDb();
});

const shift = (weekday: number, start: string, end: string, branchId = JEDDAH) =>
  ({ weekday, branchId, start, end }) satisfies WeeklyShiftInput;
const SPLIT_WEEK = [
  shift(0, "09:00", "12:00"),
  shift(0, "17:00", "21:00"),
  shift(2, "10:00", "14:00"),
];

async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof HoursError || e instanceof BookingError) return e.code;
    throw e;
  }
  return "ok";
}

const book = (file: string, day: string, time: string) =>
  withActor(receptionJeddah, (tx) =>
    bookAppointment(tx, receptionJeddah, {
      branchId: JEDDAH,
      patientId: patient(file),
      serviceId: service("consultation"), // 20 min + 10 min buffer
      practitionerId: MAJED,
      startsAt: riyadhAt(time, day),
    }),
  );

describe("who may change whose hours", () => {
  it("admin: everyone; reception: own branch; doctor: themself (if the clinic allows)", async () => {
    const save = (actor: Actor) =>
      withActor(actor, (tx) =>
        saveWeeklyHours(tx, actor, { memberId: MAJED, shifts: SPLIT_WEEK }, NOW),
      );
    expect(await code(save(reception))).toBe("not_allowed"); // Riyadh reception, Jeddah doctor
    expect(await code(save(drLina))).toBe("not_allowed"); // another doctor
    expect(await code(save(admin))).toBe("ok");
    expect(await code(save(receptionJeddah))).toBe("ok");
    expect(await code(save(drMajed))).toBe("ok");

    const riyadhList = await withActor(reception, (tx) => editableDoctors(tx, reception));
    expect(riyadhList.map((d) => d.id)).not.toContain(MAJED);
    const own = await withActor(drMajed, (tx) => editableDoctors(tx, drMajed));
    expect(own.map((d) => d.id)).toEqual([MAJED]);

    // The clinic switches "doctors set their own hours" off.
    await withActor(admin, (tx) => updateSettings(tx, admin, { doctorsEditOwnHours: false }));
    expect(await code(save(drMajed))).toBe("not_allowed");
    await withActor(admin, (tx) => updateSettings(tx, admin, { doctorsEditOwnHours: true }));

    const [log] = await withTenant(DERMA, (tx) =>
      tx.select().from(auditLogs).where(eq(auditLogs.action, "schedule.weekly_update")),
    );
    expect(log).toBeDefined();
  });

  it("refuses overlapping shifts, bad times and branches the doctor doesn't work at", async () => {
    const save = (shifts: WeeklyShiftInput[]) =>
      withActor(admin, (tx) => saveWeeklyHours(tx, admin, { memberId: MAJED, shifts }, NOW));
    expect(await code(save([shift(0, "09:00", "13:00"), shift(0, "12:00", "15:00")]))).toBe(
      "overlap",
    );
    expect(await code(save([shift(0, "15:00", "09:00")]))).toBe("bad_time");
    expect(await code(save([shift(0, "09:00", "12:00", RIYADH)]))).toBe("wrong_branch");
  });
});

describe("split shifts", () => {
  beforeAll(async () => {
    await withActor(admin, (tx) =>
      saveWeeklyHours(tx, admin, { memberId: MAJED, shifts: SPLIT_WEEK }, NOW),
    );
  });

  it("books inside a shift only; the gap between shifts is a break", async () => {
    expect(await code(book("D-0011", SUN, "10:00"))).toBe("ok");
    expect(await code(book("D-0012", SUN, "11:45"))).toBe("during_break"); // runs past 12:00
    expect(await code(book("D-0012", SUN, "14:00"))).toBe("during_break");
    expect(await code(book("D-0012", SUN, "17:00"))).toBe("ok");
    expect(await code(book("D-0013", SUN, "20:45"))).toBe("outside_hours");
    expect(await code(book("D-0013", SUN, "08:30"))).toBe("outside_hours");
  });

  it("free times start at each shift's own start, and the calendar shows the break", async () => {
    const slots = await withActor(receptionJeddah, (tx) =>
      findFreeSlots(tx, {
        branchId: JEDDAH,
        serviceId: service("consultation"),
        practitionerId: MAJED,
        from: riyadhAt("00:00", SUN),
        days: 1,
        limit: 40,
      }),
    );
    const times = slots.map((s) =>
      s.startsAt.toLocaleTimeString("en-GB", {
        timeZone: "Asia/Riyadh",
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
    expect(times).toContain("09:00");
    expect(times).toContain("17:30"); // 17:00 was booked above (until 17:30)
    expect(times.some((t) => t >= "12:00" && t < "17:00")).toBe(false);

    const [doc] = (
      await withActor(receptionJeddah, (tx) => loadDoctors(tx, JEDDAH, [SUN, FRI]))
    ).filter((d) => d.id === MAJED);
    expect(doc.hours[SUN]).toEqual({
      start: 9 * 60,
      end: 21 * 60,
      breaks: [{ start: 12 * 60, end: 17 * 60 }],
    });
    expect(doc.hours[FRI]).toBeNull();
  });
});

describe("changes for a single date", () => {
  it("day off, an extra working day, and removing a change", async () => {
    const add = (input: Parameters<typeof addHoursException>[2]) =>
      withActor(receptionJeddah, (tx) => addHoursException(tx, receptionJeddah, input, NOW));

    // Extra Friday clinic 16:00–20:00.
    await add({
      memberId: MAJED,
      day: FRI,
      kind: "hours",
      branchId: JEDDAH,
      start: "16:00",
      end: "20:00",
    });
    expect(await code(book("D-0014", FRI, "16:00"))).toBe("ok");
    expect(await code(book("D-0014", FRI, "10:00"))).toBe("outside_hours");
    expect(
      await code(
        add({
          memberId: MAJED,
          day: FRI,
          kind: "hours",
          branchId: JEDDAH,
          start: "19:00",
          end: "21:00",
        }),
      ),
    ).toBe("overlap");

    // Tuesday off (weekly 10:00–14:00): nothing can be booked; after removing it, it can.
    await add({ memberId: MAJED, day: TUE, kind: "off", note: "Conference" });
    expect(await code(book("D-0015", TUE, "10:00"))).toBe("not_working");
    const data = await withActor(receptionJeddah, (tx) =>
      loadWorkingHours(tx, receptionJeddah, MAJED, NOW),
    );
    const off = data.exceptions.find((e) => e.day === TUE)!;
    expect(off).toMatchObject({ kind: "off", note: "Conference" });
    await withActor(receptionJeddah, (tx) =>
      removeHoursException(tx, receptionJeddah, off.id, NOW),
    );
    expect(await code(book("D-0015", TUE, "10:00"))).toBe("ok");

    expect(await code(add({ memberId: MAJED, day: "2037-02-01", kind: "off" }))).toBe("in_past");
  });

  it("lists booked appointments outside new hours, but never moves or cancels them", async () => {
    // Sunday evening 17:00 was booked above; now Sunday is mornings only.
    const r = await withActor(admin, (tx) =>
      saveWeeklyHours(
        tx,
        admin,
        { memberId: MAJED, shifts: [shift(0, "09:00", "12:00"), shift(2, "10:00", "14:00")] },
        NOW,
      ),
    );
    const evening = r.conflicts.find((c) => c.startsAt === riyadhAt("17:00", SUN).toISOString());
    expect(evening).toBeDefined();
    const [still] = await withActor(admin, (tx) =>
      tx.select().from(appointments).where(eq(appointments.id, evening!.id)),
    );
    expect(still.status).toBe("booked");
  });
});
