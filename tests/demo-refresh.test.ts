import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { appointments, rescheduleRequests, tenantSettings, timeBlocks } from "@/db/schema";
import { demoId } from "@/db/seed-data";
import { withActor } from "@/lib/auth/db";
import { PermissionError } from "@/lib/auth/permissions";
import { riyadhDay, riyadhTime } from "@/lib/booking/time";
import { refreshDemoWeek } from "@/lib/demo/refresh";
import { generateDemoWeek } from "@/db/demo-week";
import { admin, lamsaAdmin, reception } from "./fixtures";

afterAll(closeDb);

describe("demo week", () => {
  it("is generated without overlaps (the database accepted it) and has today's story", () => {
    const week = generateDemoWeek();
    expect(week.length).toBeGreaterThan(150);
    const saraToday = week.filter((a) => a.doctorKey === "derma-dr-sara" && a.dayIndex === 0);
    expect(
      saraToday.some((a) => a.patientFile === "D-0002" && a.serviceCode === "laser_hair_removal"),
    ).toBe(true);
    expect(new Set(week.map((a) => a.status))).toEqual(
      new Set([
        "completed",
        "no_show",
        "cancelled",
        "in_session",
        "arrived",
        "confirmed",
        "booked",
      ]),
    );
  });
});

describe("refresh demo week", () => {
  const appt = demoId("lamsa:appointment:today-1");

  it("moves the demo week to a new day, keeping times and the pending request", async () => {
    const before = await withActor(lamsaAdmin, (tx) =>
      tx.select().from(appointments).where(eq(appointments.id, appt)),
    );
    const r = await withActor(lamsaAdmin, (tx) => refreshDemoWeek(tx, lamsaAdmin, "2030-03-10"));
    expect(r.moved).toBe(1);
    const [after] = await withActor(lamsaAdmin, (tx) =>
      tx.select().from(appointments).where(eq(appointments.id, appt)),
    );
    expect(riyadhDay(after.startsAt)).toBe("2030-03-10");
    expect(riyadhTime(after.startsAt)).toBe(riyadhTime(before[0].startsAt));
    expect(after.blockedUntil.getTime() - after.startsAt.getTime()).toBe(
      before[0].blockedUntil.getTime() - before[0].startsAt.getTime(),
    );
    const [req] = await withActor(lamsaAdmin, (tx) =>
      tx.select().from(rescheduleRequests).where(eq(rescheduleRequests.appointmentId, appt)),
    );
    expect(riyadhDay(req.proposedStartsAt)).toBe("2030-03-11"); // one working day later, as seeded
    const [block] = await withActor(lamsaAdmin, (tx) => tx.select().from(timeBlocks));
    expect(riyadhDay(block.startsAt)).toBe("2030-03-10");
    const [settings] = await withActor(lamsaAdmin, (tx) => tx.select().from(tenantSettings));
    expect(settings.demoAnchorDay).toBe("2030-03-10");
  });

  it("skips Fridays: anchoring on a Friday starts the week on Saturday", async () => {
    await withActor(lamsaAdmin, (tx) => refreshDemoWeek(tx, lamsaAdmin, "2030-03-15")); // a Friday
    const [after] = await withActor(lamsaAdmin, (tx) =>
      tx.select().from(appointments).where(eq(appointments.id, appt)),
    );
    expect(riyadhDay(after.startsAt)).toBe("2030-03-16");
  });

  it("moves back to today", async () => {
    await withActor(lamsaAdmin, (tx) => refreshDemoWeek(tx, lamsaAdmin));
    const [after] = await withActor(lamsaAdmin, (tx) =>
      tx.select().from(appointments).where(eq(appointments.id, appt)),
    );
    const today = riyadhDay(new Date());
    const isFriday = new Date(`${today}T12:00:00Z`).getUTCDay() === 5;
    if (!isFriday) expect(riyadhDay(after.startsAt)).toBe(today);
  });

  it("moves Derma's full week (hundreds of bookings) without any overlap", async () => {
    const r = await withActor(admin, (tx) => refreshDemoWeek(tx, admin, "2031-05-04"));
    expect(r.moved).toBeGreaterThan(150);
    const back = await withActor(admin, (tx) => refreshDemoWeek(tx, admin));
    expect(back.moved).toBe(r.moved);
  });

  it("only touches the current clinic, and only the admin may do it", async () => {
    const dermaBefore = await withActor(admin, (tx) =>
      tx.select({ id: appointments.id }).from(appointments),
    );
    await withActor(lamsaAdmin, (tx) => refreshDemoWeek(tx, lamsaAdmin));
    const dermaAfter = await withActor(admin, (tx) =>
      tx.select({ id: appointments.id }).from(appointments),
    );
    expect(dermaAfter.length).toBe(dermaBefore.length);
    await expect(withActor(reception, (tx) => refreshDemoWeek(tx, reception))).rejects.toThrow(
      PermissionError,
    );
  });
});
