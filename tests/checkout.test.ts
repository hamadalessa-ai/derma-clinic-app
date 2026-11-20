/**
 * Checkout (reception): invoice lines → amount due (package sessions at 0), payment + the clinic
 * system's invoice number, once per visit and only after posting; next plan sessions; the
 * patient's instruction sheet and its signed link.
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { services, visitCheckouts } from "@/db/schema";
import { demoId } from "@/db/seed-data";
import { withActor } from "@/lib/auth/db";
import { PermissionError } from "@/lib/auth/permissions";
import { bookAppointment } from "@/lib/booking/engine";
import { careToken, parseCareToken } from "@/lib/video/link";
import { checkIn } from "@/lib/visits/check-in";
import { checkoutData, checkOut, dueOf, instructionsData } from "@/lib/visits/checkout";
import { addCharge, addOrder, postVisit, startVisit, VisitError } from "@/lib/visits/visit";
import {
  DERMA,
  drSara,
  LAMSA,
  member,
  nurse,
  patient,
  reception,
  RIYADH,
  riyadhAt,
  service,
} from "./fixtures";

afterAll(closeDb);

const DAY = "2036-04-13"; // a Sunday no other test uses
const BTX = demoId("derma:billing_item:BTX-U");

async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof VisitError) return e.code;
    throw e;
  }
  return "ok";
}

async function postedVisit(file: string, time: string) {
  const a = await withActor(reception, (tx) =>
    bookAppointment(tx, reception, {
      branchId: RIYADH,
      patientId: patient(file),
      serviceId: service("consultation"),
      practitionerId: member("derma-dr-sara"),
      startsAt: riyadhAt(time, DAY),
    }),
  );
  await withActor(reception, (tx) => checkIn(tx, reception, a.id));
  const { noteId } = await withActor(drSara, (tx) => startVisit(tx, drSara, a.id));
  await withActor(drSara, (tx) =>
    addCharge(tx, drSara, { appointmentId: a.id, billingItemId: BTX, quantity: 2 }),
  );
  await withActor(drSara, (tx) =>
    addOrder(tx, drSara, {
      appointmentId: a.id,
      kind: "medication",
      name: "Azelaic acid 15% gel",
      frequency: "Twice daily",
    }),
  );
  await withActor(drSara, (tx) =>
    addOrder(tx, drSara, {
      appointmentId: a.id,
      kind: "treatment",
      name: "Follow-up course",
      sessions: 2,
      intervalWeeks: 2,
      serviceId: service("consultation"),
    }),
  );
  return { a, noteId };
}

describe("checkout", () => {
  it("only after posting; amount due from the lines; once; reception only", async () => {
    const { a, noteId } = await postedVisit("D-0027", "10:00");
    // Not posted yet.
    expect(
      await code(
        withActor(reception, (tx) =>
          checkOut(tx, reception, { appointmentId: a.id, paidHalalas: 0, method: null }),
        ),
      ),
    ).toBe("not_completed");
    await withActor(drSara, (tx) =>
      postVisit(tx, drSara, { appointmentId: a.id, noteId, body: "Rosacea. Plan as ordered." }),
    );

    const [consult] = await withActor(reception, (tx) =>
      tx
        .select()
        .from(services)
        .where(eq(services.id, service("consultation"))),
    );
    const d = await withActor(reception, (tx) => checkoutData(tx, reception, a.id));
    expect(d.lines.map((l) => l.code).sort()).toEqual(["BTX-U", consult!.code].sort());
    expect(d.due).toBe(consult!.priceHalalas + 2 * 2500);
    expect(dueOf(d.lines)).toBe(d.due);
    expect(d.checkout).toBeNull();

    // Plan: 2 sessions, every 2 weeks → 2 suggestions with a free time.
    expect(d.suggestions).toHaveLength(2);
    expect(d.suggestions.every((s) => s.slot !== null)).toBe(true);
    expect(d.suggestions[0]!.targetDay).toBe("2036-04-27");

    // Doctors and nurses don't take payments.
    await expect(withActor(drSara, (tx) => checkoutData(tx, drSara, a.id))).rejects.toThrow(
      PermissionError,
    );
    await expect(
      withActor(nurse, (tx) =>
        checkOut(tx, nurse, { appointmentId: a.id, paidHalalas: 0, method: null }),
      ),
    ).rejects.toThrow(PermissionError);

    expect(
      await code(
        withActor(reception, (tx) =>
          checkOut(tx, reception, { appointmentId: a.id, paidHalalas: 1000, method: null }),
        ),
      ),
    ).toBe("method_needed");
    const row = await withActor(reception, (tx) =>
      checkOut(tx, reception, {
        appointmentId: a.id,
        paidHalalas: d.due,
        method: "card",
        invoiceNumber: " INV-77 ",
      }),
    );
    expect(row).toMatchObject({ dueHalalas: d.due, paidHalalas: d.due, invoiceNumber: "INV-77" });
    expect(
      await code(
        withActor(reception, (tx) =>
          checkOut(tx, reception, { appointmentId: a.id, paidHalalas: 0, method: null }),
        ),
      ),
    ).toBe("checked_out");

    // Never edited or deleted, even straight in the database.
    await expect(
      withActor(reception, (tx) =>
        tx.update(visitCheckouts).set({ paidHalalas: 1 }).where(eq(visitCheckouts.id, row.id)),
      ),
    ).rejects.toThrow();
    await expect(
      withActor(reception, (tx) => tx.delete(visitCheckouts).where(eq(visitCheckouts.id, row.id))),
    ).rejects.toThrow();
  });

  it("the database refuses a checkout for a visit that isn't posted", async () => {
    const a = await withActor(reception, (tx) =>
      bookAppointment(tx, reception, {
        branchId: RIYADH,
        patientId: patient("D-0028"),
        serviceId: service("consultation"),
        practitionerId: member("derma-dr-sara"),
        startsAt: riyadhAt("12:00", DAY),
      }),
    );
    await expect(
      withActor(reception, (tx) =>
        tx.insert(visitCheckouts).values({
          tenantId: DERMA,
          appointmentId: a.id,
          patientId: patient("D-0028"),
          dueHalalas: 0,
          paidHalalas: 0,
          checkedOutByUserId: reception.userId,
        }),
      ),
    ).rejects.toThrow();
  });

  it("instruction sheet and its signed link", async () => {
    const { a, noteId } = await postedVisit("D-0029", "16:00");
    await withActor(drSara, (tx) =>
      postVisit(tx, drSara, { appointmentId: a.id, noteId, body: "Done." }),
    );
    const sheet = await withActor(reception, (tx) => instructionsData(tx, a.id));
    expect(sheet!.medications.map((m) => m.name)).toEqual(["Azelaic acid 15% gel"]);
    expect(sheet!.plans[0]!.service?.id).toBe(service("consultation"));
    // Nothing clinical beyond the orders: no note text anywhere.
    expect(JSON.stringify(sheet)).not.toContain("Done.");

    const token = careToken(DERMA, a.id);
    expect(parseCareToken(DERMA, token)).toBe(a.id);
    expect(parseCareToken(LAMSA, token)).toBeNull(); // bound to the clinic
    expect(parseCareToken(DERMA, token.slice(0, -1) + "x")).toBeNull();
  });
});
