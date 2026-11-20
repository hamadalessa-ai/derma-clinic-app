/**
 * Reception flow board: Expected → Waiting → With nurse → With doctor → Done, with the time of
 * each step recorded by the booking engine, and the nurse's "ready for doctor".
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { appointments } from "@/db/schema";
import { withActor } from "@/lib/auth/db";
import { PermissionError } from "@/lib/auth/permissions";
import { bookAppointment, BookingError } from "@/lib/booking/engine";
import { checkIn } from "@/lib/visits/check-in";
import { postVisit, readyForDoctor, startVisit } from "@/lib/visits/visit";
import { flowStage, minutesSince, needsAttention, stageSince } from "@/lib/views/flow";
import { drSara, member, nurse, patient, reception, RIYADH, riyadhAt, service } from "./fixtures";

afterAll(closeDb);

const DAY = "2036-04-06"; // a Sunday no other test uses

async function booked(file: string, time: string) {
  return withActor(reception, (tx) =>
    bookAppointment(tx, reception, {
      branchId: RIYADH,
      patientId: patient(file),
      serviceId: service("consultation"),
      practitionerId: member("derma-dr-sara"),
      startsAt: riyadhAt(time, DAY),
    }),
  );
}
const row = async (id: string) =>
  (
    await withActor(reception, (tx) =>
      tx.select().from(appointments).where(eq(appointments.id, id)),
    )
  )[0]!;
const view = (a: Awaited<ReturnType<typeof row>>) => ({
  status: a.status,
  startsAt: a.startsAt.toISOString(),
  flow: {
    arrivedAt: a.arrivedAt?.toISOString() ?? null,
    inRoomAt: a.inRoomAt?.toISOString() ?? null,
    doctorAt: a.doctorAt?.toISOString() ?? null,
    completedAt: a.completedAt?.toISOString() ?? null,
    checkedOutAt: null,
  },
});

describe("flow stages (pure)", () => {
  const base = {
    startsAt: "2036-04-06T07:00:00.000Z",
    flow: {
      arrivedAt: null,
      inRoomAt: null,
      doctorAt: null,
      completedAt: null,
      checkedOutAt: null,
    },
  };
  it("places each status in its column", () => {
    expect(flowStage({ ...base, status: "confirmed" })).toBe("expected");
    expect(flowStage({ ...base, status: "arrived" })).toBe("waiting");
    expect(flowStage({ ...base, status: "in_session" })).toBe("nurse");
    expect(
      flowStage({ ...base, status: "in_session", flow: { ...base.flow, doctorAt: base.startsAt } }),
    ).toBe("doctor");
    expect(flowStage({ ...base, status: "completed" })).toBe("checkout");
    expect(
      flowStage({
        ...base,
        status: "completed",
        flow: { ...base.flow, checkedOutAt: base.startsAt },
      }),
    ).toBe("done");
    expect(flowStage({ ...base, status: "cancelled" })).toBeNull();
    expect(flowStage({ ...base, status: "pending" })).toBeNull();
  });
  it("counts waiting time and flags long waits and late patients", () => {
    const arrived = {
      ...base,
      status: "arrived" as const,
      flow: { ...base.flow, arrivedAt: "2036-04-06T07:02:00.000Z" },
    };
    expect(stageSince(arrived, "waiting")).toBe("2036-04-06T07:02:00.000Z");
    expect(minutesSince(stageSince(arrived, "waiting"), new Date("2036-04-06T07:12:30Z"))).toBe(10);
    expect(needsAttention(arrived, "waiting", new Date("2036-04-06T07:12:00Z"))).toBe(false);
    expect(needsAttention(arrived, "waiting", new Date("2036-04-06T07:17:00Z"))).toBe(true);
    const expected = { ...base, status: "booked" as const };
    expect(needsAttention(expected, "expected", new Date("2036-04-06T07:05:00Z"))).toBe(false);
    expect(needsAttention(expected, "expected", new Date("2036-04-06T07:11:00Z"))).toBe(true);
    // Old visits without flow times fall back to the appointment time.
    expect(stageSince({ ...base, status: "arrived" }, "waiting")).toBe(base.startsAt);
  });
});

describe("flow times", () => {
  it("nurse brings the patient in, says ready; the doctor posts", async () => {
    const a = await booked("D-0025", "10:00");
    expect(flowStage(view(await row(a.id)))).toBe("expected");

    await withActor(reception, (tx) => checkIn(tx, reception, a.id));
    let r = await row(a.id);
    expect(r.arrivedAt).toBeInstanceOf(Date);
    expect(flowStage(view(r))).toBe("waiting");

    const { noteId } = await withActor(nurse, (tx) => startVisit(tx, nurse, a.id));
    r = await row(a.id);
    expect(r.inRoomAt).toBeInstanceOf(Date);
    expect(r.doctorAt).toBeNull();
    expect(flowStage(view(r))).toBe("nurse");

    // Only her: not reception, not the doctor.
    await expect(withActor(reception, (tx) => readyForDoctor(tx, reception, a.id))).rejects.toThrow(
      PermissionError,
    );
    await expect(withActor(drSara, (tx) => readyForDoctor(tx, drSara, a.id))).rejects.toThrow();

    expect(await withActor(nurse, (tx) => readyForDoctor(tx, nurse, a.id))).toEqual({
      changed: true,
    });
    expect(await withActor(nurse, (tx) => readyForDoctor(tx, nurse, a.id))).toEqual({
      changed: false,
    }); // a second tap changes nothing
    r = await row(a.id);
    expect(flowStage(view(r))).toBe("doctor");

    await withActor(drSara, (tx) =>
      postVisit(tx, drSara, { appointmentId: a.id, noteId, body: "Reviewed." }),
    );
    r = await row(a.id);
    expect(r.completedAt).toBeInstanceOf(Date);
    expect(flowStage(view(r))).toBe("checkout"); // posted: reception's turn
  });

  it("the doctor starting the visit is 'with doctor' straight away", async () => {
    const a = await booked("D-0026", "11:00");
    await withActor(reception, (tx) => checkIn(tx, reception, a.id));
    await withActor(drSara, (tx) => startVisit(tx, drSara, a.id));
    const r = await row(a.id);
    expect(r.doctorAt).toBeInstanceOf(Date);
    expect(flowStage(view(r))).toBe("doctor");
    // "Ready for doctor" only while in the room.
    const b = await booked("D-0026", "16:00");
    const err = await withActor(nurse, (tx) => readyForDoctor(tx, nurse, b.id)).catch((e) => e);
    expect(err).toBeInstanceOf(BookingError);
  });
});
