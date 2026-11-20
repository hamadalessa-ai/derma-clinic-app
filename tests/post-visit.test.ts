/**
 * Post visit (doctor's room PC): one screen with the note, medication / treatment orders and
 * invoice codes from the clinic's price list; "Post visit" completes it in one go. Afterwards the
 * codes and orders are locked — in the app and in the database.
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { billingItems, visitCharges, visitOrders } from "@/db/schema";
import { demoId } from "@/db/seed-data";
import { withActor } from "@/lib/auth/db";
import { PermissionError } from "@/lib/auth/permissions";
import { bookAppointment } from "@/lib/booking/engine";
import { saveBillingItem, SetupError } from "@/lib/setup/admin";
import { checkIn } from "@/lib/visits/check-in";
import {
  addCharge,
  addOrder,
  postVisit,
  removeCharge,
  startVisit,
  visitExtras,
  VisitError,
} from "@/lib/visits/visit";
import {
  admin,
  drSara,
  lamsaAdmin,
  member,
  nurse,
  patient,
  reception,
  RIYADH,
  riyadhAt,
  service,
} from "./fixtures";

afterAll(closeDb);

const DAY = "2036-03-30"; // a Sunday no other test uses
const BTX = demoId("derma:billing_item:BTX-U");
const SPF = demoId("derma:billing_item:SPF50");

async function arrived(file: string, time: string) {
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
  return a;
}
async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof VisitError || e instanceof SetupError) return e.code;
    throw e;
  }
  return "ok";
}

describe("post visit", () => {
  it("adds the booked service, codes and orders, then posts and locks them", async () => {
    const a = await arrived("D-0023", "10:00");
    const { noteId } = await withActor(drSara, (tx) => startVisit(tx, drSara, a.id));
    // The booked service is on the bill automatically, once.
    await withActor(drSara, (tx) => startVisit(tx, drSara, a.id));
    let extras = await withActor(drSara, (tx) => visitExtras(tx, a.id));
    expect(extras.charges.filter((c) => c.serviceId === service("consultation"))).toHaveLength(1);

    // Price-list codes, at today's price (snapshot).
    const btx = await withActor(drSara, (tx) =>
      addCharge(tx, drSara, { appointmentId: a.id, billingItemId: BTX, quantity: 20 }),
    );
    expect(btx).toMatchObject({ code: "BTX-U", quantity: 20, unitPriceHalalas: 2500 });
    const spf = await withActor(nurse, (tx) =>
      addCharge(tx, nurse, { appointmentId: a.id, billingItemId: SPF, quantity: 1 }),
    );
    await withActor(nurse, (tx) => removeCharge(tx, nurse, { appointmentId: a.id, chargeId: spf.id }));
    // Another clinic's item is never usable.
    expect(
      await code(
        withActor(drSara, (tx) =>
          addCharge(tx, drSara, {
            appointmentId: a.id,
            billingItemId: demoId("lamsa:billing_item:SPF50"),
            quantity: 1,
          }),
        ),
      ),
    ).toBe("bad_item");

    await withActor(drSara, (tx) =>
      addOrder(tx, drSara, {
        appointmentId: a.id,
        kind: "medication",
        name: "Adapalene 0.1% gel",
        frequency: "Nightly",
        duration: "8 weeks",
      }),
    );
    await withActor(drSara, (tx) =>
      addOrder(tx, drSara, {
        appointmentId: a.id,
        kind: "treatment",
        name: "Chemical peel course",
        sessions: 4,
        intervalWeeks: 3,
      }),
    );
    extras = await withActor(drSara, (tx) => visitExtras(tx, a.id));
    expect(extras.charges.map((c) => c.code ?? "").filter(Boolean)).toContain("BTX-U");
    expect(extras.charges).toHaveLength(2);
    expect(extras.orders).toHaveLength(2);

    // Reception never edits the visit.
    await expect(
      withActor(reception, (tx) =>
        addCharge(tx, reception, { appointmentId: a.id, billingItemId: BTX, quantity: 1 }),
      ),
    ).rejects.toThrow();

    const r = await withActor(drSara, (tx) =>
      postVisit(tx, drSara, { appointmentId: a.id, noteId, body: "Acne. Plan as ordered." }),
    );
    expect(r.completed).toBe(true);

    // Locked in the app…
    expect(
      await code(
        withActor(drSara, (tx) =>
          addCharge(tx, drSara, { appointmentId: a.id, billingItemId: BTX, quantity: 1 }),
        ),
      ),
    ).toBe("locked");
    // …and in the database.
    await expect(
      withActor(drSara, (tx) => tx.delete(visitCharges).where(eq(visitCharges.appointmentId, a.id))),
    ).resolves.toBeDefined();
    const left = await withActor(drSara, (tx) =>
      tx.select().from(visitCharges).where(eq(visitCharges.appointmentId, a.id)),
    );
    expect(left).toHaveLength(2);
    const orders = await withActor(drSara, (tx) =>
      tx.select().from(visitOrders).where(eq(visitOrders.appointmentId, a.id)),
    );
    expect(orders).toHaveLength(2);
  });

  it("can't post an empty note", async () => {
    const a = await arrived("D-0024", "11:00");
    const { noteId } = await withActor(drSara, (tx) => startVisit(tx, drSara, a.id));
    await expect(
      withActor(drSara, (tx) => postVisit(tx, drSara, { appointmentId: a.id, noteId, body: " " })),
    ).rejects.toThrow();
  });
});

describe("price list", () => {
  it("is the admin's; codes are unique per clinic", async () => {
    const input = {
      code: "LASER-T",
      nameAr: "طرف ليزر",
      nameEn: "Laser tip",
      kind: "consumable" as const,
      priceHalalas: 4000,
      unitAr: "",
      unitEn: "",
      isActive: true,
    };
    await expect(withActor(reception, (tx) => saveBillingItem(tx, reception, input))).rejects.toThrow(
      PermissionError,
    );
    await withActor(admin, (tx) => saveBillingItem(tx, admin, input));
    expect(await code(withActor(admin, (tx) => saveBillingItem(tx, admin, input)))).toBe(
      "code_taken",
    );
    // Same code in another clinic is fine — and invisible here.
    await withActor(lamsaAdmin, (tx) => saveBillingItem(tx, lamsaAdmin, input));
    const mine = await withActor(admin, (tx) =>
      tx.select().from(billingItems).where(eq(billingItems.code, "LASER-T")),
    );
    expect(mine).toHaveLength(1);
  });
});
