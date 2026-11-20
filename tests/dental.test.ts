/**
 * Dental: the chart (clinical, a history), the treatment plan across visits (done in a visit →
 * an invoice line), lab cases, and the dental room kept for dental work.
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { dentalChartEntries, dentalPlanItems, visitCharges } from "@/db/schema";
import { withActor } from "@/lib/auth/db";
import { PermissionError } from "@/lib/auth/permissions";
import { bookAppointment, BookingError, roomsForService } from "@/lib/booking/engine";
import { chartHistory, DentalError, dentalEnabled, recordTooth } from "@/lib/dental/chart";
import { createLabCase, isOverdue, listLabCases, setLabStatus } from "@/lib/dental/lab";
import { addPlanItem, cancelPlanItem, markPlanDone, planFor, planTotals } from "@/lib/dental/plan";
import { currentChart, isTooth, normalizeSurfaces } from "@/lib/dental/teeth";
import { checkIn } from "@/lib/visits/check-in";
import { startVisit } from "@/lib/visits/visit";
import {
  DERMA,
  drNawaf,
  drSara,
  member,
  nurse,
  patient,
  reception,
  RIYADH,
  riyadhAt,
  room,
  service,
} from "./fixtures";

afterAll(closeDb);

const DAY = "2036-04-27"; // a Sunday no other test uses
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof DentalError || e instanceof BookingError) return e.code;
    throw e;
  }
  return "ok";
};

describe("teeth (pure)", () => {
  it("knows FDI numbers, surfaces and the chart's current state", () => {
    expect([11, 18, 21, 38, 48].every(isTooth)).toBe(true);
    expect([10, 19, 50, 9, 41.5].some(isTooth)).toBe(false);
    expect(normalizeSurfaces("dmox")).toBe("MOD");
    const at = (n: number) => new Date(2030, 0, n);
    const now = currentChart([
      { tooth: 36, condition: "caries", surfaces: "MO", createdAt: at(1) },
      { tooth: 36, condition: "filled", surfaces: "MO", createdAt: at(2) },
      { tooth: 11, condition: "watch", surfaces: "", createdAt: at(1) },
      { tooth: 11, condition: "healthy", surfaces: "", createdAt: at(3) },
    ] as const);
    expect(now.get(36)?.condition).toBe("filled");
    expect(now.has(11)).toBe(false); // "healthy" clears
  });
});

describe("dental chart", () => {
  it("demo: D-0015's chart, seen by the dentist and nurses only", async () => {
    expect(await withActor(drNawaf, (tx) => dentalEnabled(tx))).toBe(true);
    const h = await withActor(drNawaf, (tx) => chartHistory(tx, drNawaf, patient("D-0015")));
    const now = currentChart(h);
    expect(now.get(36)).toMatchObject({ condition: "filled", surfaces: "MO" });
    expect(now.get(46)?.condition).toBe("crown");
    expect(now.get(18)?.condition).toBe("missing");
    // Reception: not allowed, and the database shows nothing either.
    await expect(
      withActor(reception, (tx) => chartHistory(tx, reception, patient("D-0015"))),
    ).rejects.toThrow(PermissionError);
    const rows = await withActor(reception, (tx) =>
      tx.select().from(dentalChartEntries).where(eq(dentalChartEntries.patientId, patient("D-0015"))),
    );
    expect(rows).toHaveLength(0);
  });

  it("records a change as a new row; never edited", async () => {
    const e = await withActor(nurse, (tx) =>
      recordTooth(tx, nurse, {
        patientId: patient("D-0016"),
        tooth: 24,
        condition: "caries",
        surfaces: "od",
      }),
    );
    expect(e).toMatchObject({ tooth: 24, surfaces: "OD", recordedByUserId: nurse.userId });
    expect(
      await code(
        withActor(drNawaf, (tx) =>
          recordTooth(tx, drNawaf, { patientId: patient("D-0016"), tooth: 19, condition: "caries" }),
        ),
      ),
    ).toBe("bad_tooth");
    await expect(
      withActor(drNawaf, (tx) =>
        tx.update(dentalChartEntries).set({ note: "x" }).where(eq(dentalChartEntries.id, e.id)),
      ),
    ).rejects.toThrow();
  });
});

describe("treatment plan", () => {
  it("everyone reads it; doctors and nurses change it; database agrees", async () => {
    const items = await withActor(reception, (tx) => planFor(tx, patient("D-0015")));
    expect(items.map((i) => i.code)).toContain("root_canal");
    expect(planTotals(items).planned).toBeGreaterThan(0);
    await expect(
      withActor(reception, (tx) =>
        addPlanItem(tx, reception, {
          patientId: patient("D-0015"),
          serviceId: service("dental_filling"),
        }),
      ),
    ).rejects.toThrow(PermissionError);
    await expect(
      withActor(reception, (tx) =>
        tx
          .update(dentalPlanItems)
          .set({ status: "cancelled" })
          .where(eq(dentalPlanItems.patientId, patient("D-0015")))
          .returning(),
      ),
    ).resolves.toHaveLength(0);
  });

  it("done in a visit: added to the visit's invoice lines, once", async () => {
    const a = await withActor(reception, (tx) =>
      bookAppointment(tx, reception, {
        branchId: RIYADH,
        patientId: patient("D-0017"),
        serviceId: service("dental_consultation"),
        practitionerId: member("derma-dr-nawaf"),
        startsAt: riyadhAt("10:00", DAY),
      }),
    );
    // The dental room, never a dermatology room.
    expect(a.roomId).toBe(room("ruh-dental"));
    await withActor(reception, (tx) => checkIn(tx, reception, a.id));
    await withActor(drNawaf, (tx) => startVisit(tx, drNawaf, a.id));
    const item = await withActor(drNawaf, (tx) =>
      addPlanItem(tx, drNawaf, {
        patientId: patient("D-0017"),
        serviceId: service("dental_filling"),
        tooth: 26,
        surfaces: "O",
      }),
    );
    expect(item).toMatchObject({ code: "dental_filling", priceHalalas: 45000, status: "planned" });
    await withActor(drNawaf, (tx) =>
      markPlanDone(tx, drNawaf, { itemId: item.id, appointmentId: a.id }),
    );
    const lines = await withActor(drNawaf, (tx) =>
      tx.select().from(visitCharges).where(eq(visitCharges.appointmentId, a.id)),
    );
    expect(lines.map((l) => l.code)).toContain("dental_filling");
    expect(
      await code(
        withActor(drNawaf, (tx) =>
          markPlanDone(tx, drNawaf, { itemId: item.id, appointmentId: a.id }),
        ),
      ),
    ).toBe("not_planned");
    const other = await withActor(drNawaf, (tx) =>
      addPlanItem(tx, drNawaf, { patientId: patient("D-0017"), serviceId: service("dental_crown") }),
    );
    await withActor(drNawaf, (tx) => cancelPlanItem(tx, drNawaf, other.id));
    const after = await withActor(reception, (tx) => planFor(tx, patient("D-0017")));
    expect(after.find((i) => i.id === other.id)?.status).toBe("cancelled");
  });
});

describe("dental room and dentist", () => {
  it("the dentist does dental work only; the dental room only takes dental work", async () => {
    expect(
      await code(
        withActor(reception, (tx) =>
          bookAppointment(tx, reception, {
            branchId: RIYADH,
            patientId: patient("D-0018"),
            serviceId: service("botox"),
            practitionerId: member("derma-dr-nawaf"),
            startsAt: riyadhAt("12:00", DAY),
          }),
        ),
      ),
    ).toBe("not_for_service");
    const derm = await withActor(reception, (tx) =>
      bookAppointment(tx, reception, {
        branchId: RIYADH,
        patientId: patient("D-0018"),
        serviceId: service("consultation"),
        practitionerId: member("derma-dr-sara"),
        startsAt: riyadhAt("12:00", DAY),
      }),
    );
    expect(derm.roomId).not.toBe(room("ruh-dental"));
    const rows = [
      { id: "general", departmentId: null },
      { id: "dental", departmentId: "dep-dental" },
    ];
    expect(roomsForService(rows, { departmentId: "dep-dental" }).map((r) => r.id)).toEqual([
      "dental",
    ]);
    expect(roomsForService(rows, { departmentId: "dep-skin" }).map((r) => r.id)).toEqual([
      "general",
    ]);
  });
});

describe("lab cases", () => {
  it("sent → received → fitted; overdue shows; wrong steps refused", async () => {
    const open = await withActor(reception, (tx) => listLabCases(tx, reception, { open: true }));
    expect(open.some((r) => isOverdue(r.c))).toBe(true); // demo: D-0009's bridge is late
    const c = await withActor(drNawaf, (tx) =>
      createLabCase(tx, drNawaf, {
        patientId: patient("D-0015"),
        practitionerId: member("derma-dr-nawaf"),
        labName: "Smile Lab",
        work: "crown",
        teeth: "25",
        shade: "A2",
        sentOn: "2036-04-27",
        dueOn: "2036-05-04",
      }),
    );
    expect(c.status).toBe("sent");
    expect(
      await code(withActor(reception, (tx) => setLabStatus(tx, reception, { id: c.id, status: "fitted" }))),
    ).toBe("bad_status");
    await withActor(reception, (tx) => setLabStatus(tx, reception, { id: c.id, status: "received" }));
    const fitted = await withActor(drNawaf, (tx) =>
      setLabStatus(tx, drNawaf, { id: c.id, status: "fitted" }),
    );
    expect(fitted.fittedAt).toBeInstanceOf(Date);
    expect(isOverdue({ status: "sent", dueOn: "2036-05-01" }, "2036-05-02")).toBe(true);
    expect(isOverdue({ status: "received", dueOn: "2036-05-01" }, "2036-05-02")).toBe(false);
    expect(DERMA).toBeTruthy();
  });
});
