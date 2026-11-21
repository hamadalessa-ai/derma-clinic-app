/**
 * Small gaps after dental basics:
 *  - a room can belong to a department (Clinic set-up),
 *  - "your crown is back from the lab" on WhatsApp when reception marks a lab case received,
 *  - the patient page (/my) shows the dental treatment plan still to do + the estimate,
 *    while the dental chart stays hidden from patients (database).
 */
import { afterAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { messages, rooms } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { withActor } from "@/lib/auth/db";
import { createLabCase, setLabStatus } from "@/lib/dental/lab";
import { loadPortal } from "@/lib/portal/data";
import { patientDbContext } from "@/lib/portal/session";
import { saveRoom } from "@/lib/setup/admin";
import { sendLabReady } from "@/lib/whatsapp/outbox";
import { admin, DERMA, drNawaf, member, patient, reception, RIYADH } from "./fixtures";

afterAll(closeDb);

const derma = { id: DERMA, slug: "derma", isDemo: true };
const ENV = { ...process.env, MESSAGE_DEMO_MODE: "on" };

describe("rooms and departments", () => {
  it("a room can be kept for a department; a video room never is", async () => {
    const [dept] = await withTenant(DERMA, (tx) =>
      tx.execute<{ id: string }>(sql`select id from departments where code = 'dental'`),
    );
    const saved = await withActor(admin, (tx) =>
      saveRoom(tx, admin, {
        branchId: RIYADH,
        nameAr: "غرفة اختبار",
        nameEn: "Test room",
        isVirtual: false,
        isActive: false, // never offered to bookings in other tests
        departmentId: dept.id,
      }),
    );
    const [row] = await withTenant(DERMA, (tx) =>
      tx.select().from(rooms).where(eq(rooms.id, saved.id)),
    );
    expect(row.departmentId).toBe(dept.id);
    await withActor(admin, (tx) =>
      saveRoom(tx, admin, {
        id: saved.id,
        branchId: RIYADH,
        nameAr: "غرفة اختبار",
        nameEn: "Test room",
        isVirtual: true,
        isActive: false,
        departmentId: dept.id,
      }),
    );
    const [after] = await withTenant(DERMA, (tx) =>
      tx.select().from(rooms).where(eq(rooms.id, saved.id)),
    );
    expect(after.departmentId).toBeNull();
  });
});

describe("lab work ready", () => {
  it("received → one WhatsApp with the booking link, never twice", async () => {
    const c = await withActor(drNawaf, (tx) =>
      createLabCase(tx, drNawaf, {
        patientId: patient("D-0015"),
        practitionerId: member("derma-dr-nawaf"),
        labName: "Smile Lab",
        work: "crown",
        teeth: "36",
        sentOn: "2036-05-01",
        dueOn: "2036-05-08",
      }),
    );
    // Not back yet: nothing to say.
    expect((await sendLabReady(derma, c.id, ENV)).outcome).toBe("skipped");
    await withActor(reception, (tx) =>
      setLabStatus(tx, reception, { id: c.id, status: "received" }),
    );
    expect((await sendLabReady(derma, c.id, ENV)).outcome).toBe("sent");
    expect((await sendLabReady(derma, c.id, ENV)).outcome).toBe("skipped");
    const sent = await withTenant(DERMA, (tx) =>
      tx
        .select()
        .from(messages)
        .where(and(eq(messages.kind, "lab_ready"), eq(messages.patientId, patient("D-0015")))),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain("/book");
    expect(sent[0].body).toMatch(/التاج|crown/);
  });
});

describe("dental estimate on /my", () => {
  it("shows the planned steps and their prices, not the done ones", async () => {
    const data = await loadPortal(DERMA, patient("D-0015"));
    expect(data.dentalPlan.length).toBeGreaterThan(0);
    for (const i of data.dentalPlan) {
      expect(i.patientId).toBe(patient("D-0015"));
      expect(i.priceHalalas).toBeGreaterThan(0);
    }
  });

  it("another patient sees no one else's plan; the chart stays hidden from patients", async () => {
    const other = await loadPortal(DERMA, patient("D-0001"));
    expect(other.dentalPlan.every((i) => i.patientId !== patient("D-0015"))).toBe(true);
    const chart = await withTenant(patientDbContext(DERMA, patient("D-0015")), (tx) =>
      tx.execute(sql`select id from dental_chart_entries`),
    );
    expect(chart).toHaveLength(0);
  });
});
