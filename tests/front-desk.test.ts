/**
 * Front desk fast lane: find by mobile (any spelling) with today's visit; walk-in = book the
 * free time and check in at once (consent still asked when the service needs one).
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { appointments, patients } from "@/db/schema";
import { withActor } from "@/lib/auth/db";
import { PermissionError } from "@/lib/auth/permissions";
import { bookAppointment, findFreeSlots } from "@/lib/booking/engine";
import { intlMobile, telLink, waLink } from "@/lib/front-desk/contact";
import { deskSearch, walkIn } from "@/lib/front-desk/desk";
import { DERMA, drSara, member, reception, RIYADH, riyadhAt, service } from "./fixtures";

afterAll(closeDb);

const DAY = "2036-04-20"; // a Sunday no other test uses
const NOON = riyadhAt("09:00", DAY); // "now" for these tests

/** Fresh (fake) patients of our own, so no other test's bookings or consents get in the way. */
async function newPatient(file: string, phone: string) {
  const [p] = await withActor(reception, (tx) =>
    tx
      .insert(patients)
      .values({
        tenantId: DERMA,
        fileNumber: file,
        fullNameAr: "مريضة اختبار الاستقبال",
        phone,
        gender: "female",
        isFake: true,
      })
      .returning(),
  );
  return p!.id;
}

describe("contact links", () => {
  it("dials and opens WhatsApp in the international form", () => {
    expect(intlMobile("0501234567")).toBe("966501234567");
    expect(intlMobile("+966 50 123 4567")).toBe("966501234567");
    expect(telLink("0501234567")).toBe("tel:+966501234567");
    expect(waLink("0501234567")).toBe("https://wa.me/966501234567");
  });
});

describe("front desk", () => {
  it("finds by mobile (Arabic digits, +966) and shows today's visit", async () => {
    const phone = "0598760001";
    const id = await newPatient("FD-0001", phone);
    const a = await withActor(reception, (tx) =>
      bookAppointment(tx, reception, {
        branchId: RIYADH,
        patientId: id,
        serviceId: service("consultation"),
        practitionerId: member("derma-dr-sara"),
        startsAt: riyadhAt("11:00", DAY),
      }),
    );
    const arabic = phone.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]!);
    for (const q of [phone, arabic, `+966 ${phone.slice(1)}`]) {
      const hits = await withActor(reception, (tx) => deskSearch(tx, reception, q, NOON));
      const hit = hits.find((h) => h.id === id);
      expect(hit, q).toBeDefined();
      expect(hit!.today).toMatchObject({ id: a.id, status: "booked" });
    }
    // The next day: no visit "today".
    const later = await withActor(reception, (tx) =>
      deskSearch(tx, reception, phone, riyadhAt("09:00", "2036-04-21")),
    );
    expect(later.find((h) => h.id === id)!.today).toBeNull();
    // Reception's tool only.
    await expect(withActor(drSara, (tx) => deskSearch(tx, drSara, phone, NOON))).rejects.toThrow(
      PermissionError,
    );
  });

  it("walk-in: booked and checked in in one step", async () => {
    const id = await newPatient("FD-0002", "0598760002");
    const [slot] = await withActor(reception, (tx) =>
      findFreeSlots(tx, {
        branchId: RIYADH,
        serviceId: service("consultation"),
        from: riyadhAt("13:00", DAY),
        limit: 1,
      }),
    );
    const r = await withActor(reception, (tx) =>
      walkIn(tx, reception, {
        branchId: RIYADH,
        patientId: id,
        serviceId: service("consultation"),
        practitionerId: slot!.practitionerId,
        startsAt: slot!.startsAt,
      }),
    );
    expect(r.result.status).toBe("checked_in");
    const [row] = await withActor(reception, (tx) =>
      tx.select().from(appointments).where(eq(appointments.id, r.appointmentId)),
    );
    expect(row).toMatchObject({ status: "arrived", source: "reception" });
    expect(row!.arrivedAt).toBeInstanceOf(Date);
  });

  it("walk-in for a service that needs a consent: booked, consent asked first", async () => {
    const id = await newPatient("FD-0003", "0598760003");
    const [slot] = await withActor(reception, (tx) =>
      findFreeSlots(tx, {
        branchId: RIYADH,
        serviceId: service("botox"),
        from: riyadhAt("15:00", DAY),
        limit: 1,
      }),
    );
    const r = await withActor(reception, (tx) =>
      walkIn(tx, reception, {
        branchId: RIYADH,
        patientId: id,
        serviceId: service("botox"),
        practitionerId: slot!.practitionerId,
        startsAt: slot!.startsAt,
      }),
    );
    expect(r.result.status).toBe("consent_required");
    const [row] = await withActor(reception, (tx) =>
      tx.select().from(appointments).where(eq(appointments.id, r.appointmentId)),
    );
    expect(row!.status).toBe("booked");
  });
});
