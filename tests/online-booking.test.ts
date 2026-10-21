/**
 * Online booking (/book) and the patient's own changes (/my), through the booking engine.
 * Rules: online switched on, service enabled online, minimum notice, horizon, working hours,
 * no double-booking (database-enforced), doctor gender preference, approval → "pending",
 * cancel / reschedule only within the cancellation window, only own or family appointments.
 * Dates are fixed in 2031 with an explicit "now", so results never depend on the real clock.
 */
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { auditLogs, patients, services, tenantSettings } from "@/db/schema";
import { withTenant, type TenantTx } from "@/db/tenant";
import { withActor } from "@/lib/auth/db";
import {
  bookOnline,
  BookingError,
  cancelByPatient,
  changeStatus,
  findOnlineSlots,
  moveByPatient,
  onlineDoctors,
} from "@/lib/booking/engine";
import { findOrCreateOnlinePatient } from "@/lib/patients/queries";
import { DERMA, drSara, member, patient, reception, riyadhAt, RIYADH, service } from "./fixtures";

afterAll(closeDb);

const NOW = riyadhAt("08:00", "2031-03-01"); // Saturday morning
const SARA = member("derma-dr-sara");
const FAISAL = member("derma-dr-faisal");
const REEM = member("derma-dr-reem");

/** Clinic transaction with no staff user — like the public booking page. */
const online = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(DERMA, fn);

const book = (
  input: Partial<Parameters<typeof bookOnline>[1]> & { startsAt: Date; patientId: string },
) =>
  online((tx) =>
    bookOnline(tx, {
      tenantId: DERMA,
      branchId: RIYADH,
      serviceId: service("consultation"),
      now: NOW,
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

/** Runs `fn` with temporary settings, then rolls everything back. */
async function withSettings(
  values: Partial<typeof tenantSettings.$inferInsert>,
  fn: (tx: TenantTx) => Promise<void>,
) {
  const ROLLBACK = new Error("rollback");
  await online(async (tx) => {
    await tx.update(tenantSettings).set(values);
    await fn(tx);
    throw ROLLBACK;
  }).catch((e) => {
    if (e !== ROLLBACK) throw e;
  });
}

describe("online booking rules", () => {
  it("books online: source 'online', status 'booked', audited without a staff user", async () => {
    const a = await book({
      startsAt: riyadhAt("10:00", "2031-03-02"),
      patientId: patient("D-0003"),
      practitionerId: SARA,
    });
    expect(a.source).toBe("online");
    expect(a.status).toBe("booked");
    expect(a.createdBy).toBeNull();
    const [log] = await online((tx) =>
      tx
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityId, a.id), eq(auditLogs.action, "appointment.create"))),
    );
    expect(log.actorUserId).toBeNull();
    expect(log.metadata).toMatchObject({ source: "online", via: "patient_page" });
  });

  it("only services enabled for online booking", async () => {
    expect(
      await code(
        book({
          startsAt: riyadhAt("11:00", "2031-03-02"),
          patientId: patient("D-0003"),
          serviceId: service("thread_lift"),
        }),
      ),
    ).toBe("not_online");
  });

  it("nothing when the clinic has online booking switched off", async () => {
    await withSettings({ onlineBookingEnabled: false }, async (tx) => {
      const err = await code(
        bookOnline(tx, {
          tenantId: DERMA,
          branchId: RIYADH,
          serviceId: service("consultation"),
          patientId: patient("D-0003"),
          startsAt: riyadhAt("12:00", "2031-03-02"),
          now: NOW,
        }),
      );
      expect(err).toBe("online_disabled");
    });
  });

  it("minimum notice (2 hours) and horizon (30 days)", async () => {
    const start = riyadhAt("16:00", "2031-03-02");
    const p = patient("D-0004");
    const minus = (m: number) => new Date(start.getTime() - m * 60_000);
    expect(await code(book({ startsAt: start, patientId: p, now: minus(60) }))).toBe("too_soon");
    expect(await code(book({ startsAt: start, patientId: p, now: minus(31 * 24 * 60) }))).toBe(
      "too_far",
    );
    expect(await code(book({ startsAt: start, patientId: p, now: minus(121) }))).toBe("ok");
  });

  it("working hours, break and days off", async () => {
    const p = patient("D-0005");
    const at = (time: string, day = "2031-03-03") => ({
      startsAt: riyadhAt(time, day),
      patientId: p,
      practitionerId: SARA,
    });
    expect(await code(book(at("09:00")))).toBe("outside_hours");
    expect(await code(book(at("19:50")))).toBe("outside_hours");
    expect(await code(book(at("14:15")))).toBe("during_break");
    expect(await code(book(at("11:00", "2031-03-07")))).toBe("not_working"); // Friday
  });

  it("no double-booking: the same doctor and time can't be booked twice", async () => {
    const startsAt = riyadhAt("17:00", "2031-03-03");
    expect(await code(book({ startsAt, patientId: patient("D-0006"), practitionerId: SARA }))).toBe(
      "ok",
    );
    expect(await code(book({ startsAt, patientId: patient("D-0009"), practitionerId: SARA }))).toBe(
      "slot_taken",
    );
  });

  it("no double-booking even when many requests arrive at the same moment", async () => {
    const startsAt = riyadhAt("18:00", "2031-03-03");
    const files = ["D-0010", "D-0012", "D-0013", "D-0014", "D-0016"];
    const results = await Promise.all(
      files.map((f) => code(book({ startsAt, patientId: patient(f), practitionerId: SARA }))),
    );
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r === "slot_taken")).toHaveLength(files.length - 1);
  });

  it("the same patient can't book the same time twice", async () => {
    const startsAt = riyadhAt("12:00", "2031-03-04");
    expect(await code(book({ startsAt, patientId: patient("D-0017") }))).toBe("ok");
    expect(await code(book({ startsAt, patientId: patient("D-0017") }))).toBe("already_booked");
  });
});

describe("doctor choice and gender preference", () => {
  it("doctors have a gender; the filter keeps only matching doctors at the branch", async () => {
    const female = await online((tx) => onlineDoctors(tx, RIYADH, "female"));
    const male = await online((tx) => onlineDoctors(tx, RIYADH, "male"));
    expect(female.map((d) => d.id).sort()).toEqual([SARA, REEM].sort());
    expect(male.map((d) => d.id)).toEqual([FAISAL]);
  });

  it("'any female doctor' books a female doctor; 'any male' a male one", async () => {
    const f = await book({
      startsAt: riyadhAt("10:00", "2031-03-04"),
      patientId: patient("D-0018"),
      gender: "female",
    });
    expect([SARA, REEM]).toContain(f.practitionerId);
    const m = await book({
      startsAt: riyadhAt("10:00", "2031-03-04"),
      patientId: patient("D-0019"),
      gender: "male",
    });
    expect(m.practitionerId).toBe(FAISAL);
  });

  it("'any' moves on to the next matching doctor when the first is busy", async () => {
    const startsAt = riyadhAt("11:00", "2031-03-04");
    const a = await book({ startsAt, patientId: patient("D-0003"), gender: "female" });
    const b = await book({ startsAt, patientId: patient("D-0004"), gender: "female" });
    expect(new Set([a.practitionerId, b.practitionerId])).toEqual(new Set([SARA, REEM]));
    // Both female doctors are busy now: the gender choice is respected, no male doctor is used.
    expect(await code(book({ startsAt, patientId: patient("D-0005"), gender: "female" }))).toBe(
      "slot_taken",
    );
  });

  it("a chosen doctor who doesn't match the gender is refused", async () => {
    expect(
      await code(
        book({
          startsAt: riyadhAt("13:00", "2031-03-04"),
          patientId: patient("D-0006"),
          practitionerId: FAISAL,
          gender: "female",
        }),
      ),
    ).toBe("no_doctor");
  });

  it("free times: 'any' lists each time once, earliest first; gender filters doctors", async () => {
    const day = "2031-03-05";
    const any = await online((tx) =>
      findOnlineSlots(tx, { branchId: RIYADH, serviceId: service("consultation"), day, now: NOW }),
    );
    const times = any.map((s) => s.startsAt.getTime());
    expect(times.length).toBeGreaterThan(0);
    expect(new Set(times).size).toBe(times.length);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(any[0].startsAt.toISOString()).toBe(riyadhAt("10:00", day).toISOString());

    const male = await online((tx) =>
      findOnlineSlots(tx, {
        branchId: RIYADH,
        serviceId: service("consultation"),
        day,
        gender: "male",
        now: NOW,
      }),
    );
    expect(male.length).toBeGreaterThan(0);
    expect(male.every((s) => s.practitionerId === FAISAL)).toBe(true);
  });

  it("free times respect the minimum notice and the horizon", async () => {
    const day = "2031-03-05";
    const slots = await online((tx) =>
      findOnlineSlots(tx, {
        branchId: RIYADH,
        serviceId: service("consultation"),
        day,
        now: riyadhAt("11:00", day),
      }),
    );
    expect(slots.every((s) => s.startsAt >= riyadhAt("13:00", day))).toBe(true);
    const far = await online((tx) =>
      findOnlineSlots(tx, {
        branchId: RIYADH,
        serviceId: service("consultation"),
        day: "2031-04-20",
        now: NOW,
      }),
    );
    expect(far).toEqual([]);
  });

  it("free times are not offered for services that aren't online", async () => {
    expect(
      await code(
        online((tx) =>
          findOnlineSlots(tx, {
            branchId: RIYADH,
            serviceId: service("thread_lift"),
            day: "2031-03-05",
            now: NOW,
          }),
        ),
      ),
    ).toBe("not_online");
  });
});

describe("approval required", () => {
  it("bookings start 'pending', still hold the slot, and only reception approves", async () => {
    let id = "";
    await withSettings({ onlineRequiresApproval: true }, async (tx) => {
      const a = await bookOnline(tx, {
        tenantId: DERMA,
        branchId: RIYADH,
        serviceId: service("consultation"),
        patientId: patient("D-0007"),
        practitionerId: SARA,
        startsAt: riyadhAt("15:00", "2031-03-05"),
        now: NOW,
      });
      expect(a.status).toBe("pending");
      id = a.id;
      // The slot is held.
      expect(
        await code(
          bookOnline(tx, {
            tenantId: DERMA,
            branchId: RIYADH,
            serviceId: service("consultation"),
            patientId: patient("D-0009"),
            practitionerId: SARA,
            startsAt: riyadhAt("15:00", "2031-03-05"),
            now: NOW,
          }),
        ),
      ).toBe("slot_taken");
      // The doctor can't approve; reception can.
      expect(await code(changeStatus(tx, drSara, id, "confirmed"))).toBe("not_allowed");
      const ok = await changeStatus(tx, reception, id, "confirmed");
      expect(ok.status).toBe("confirmed");
    });
    expect(id).not.toBe("");
  });

  it("a rejected request frees the slot", async () => {
    await withSettings({ onlineRequiresApproval: true }, async (tx) => {
      const a = await bookOnline(tx, {
        tenantId: DERMA,
        branchId: RIYADH,
        serviceId: service("consultation"),
        patientId: patient("D-0007"),
        practitionerId: SARA,
        startsAt: riyadhAt("16:00", "2031-03-05"),
        now: NOW,
      });
      await changeStatus(tx, reception, a.id, "cancelled", { reason: "rejected" });
      const b = await bookOnline(tx, {
        tenantId: DERMA,
        branchId: RIYADH,
        serviceId: service("consultation"),
        patientId: patient("D-0009"),
        practitionerId: SARA,
        startsAt: riyadhAt("16:00", "2031-03-05"),
        now: NOW,
      });
      expect(b.status).toBe("pending");
    });
  });
});

describe("the patient's own changes (patient page)", () => {
  const startsAt = riyadhAt("10:00", "2031-03-06");

  it("cancel: own appointment, before the 24-hour window", async () => {
    const a = await book({ startsAt, patientId: patient("D-0003"), practitionerId: REEM });
    // Someone else can't cancel it.
    expect(
      await code(
        online((tx) =>
          cancelByPatient(tx, { patientId: patient("D-0004"), appointmentId: a.id, now: NOW }),
        ),
      ),
    ).toBe("not_found");
    // Too late (less than 24 hours before).
    expect(
      await code(
        online((tx) =>
          cancelByPatient(tx, {
            patientId: patient("D-0003"),
            appointmentId: a.id,
            now: riyadhAt("12:00", "2031-03-05"),
          }),
        ),
      ),
    ).toBe("outside_window");
    const done = await online((tx) =>
      cancelByPatient(tx, { patientId: patient("D-0003"), appointmentId: a.id, now: NOW }),
    );
    expect(done.status).toBe("cancelled");
    const [log] = await withActor(reception, (tx) =>
      tx
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityId, a.id), eq(auditLogs.action, "appointment.status"))),
    );
    expect(log.actorUserId).toBeNull();
    expect(log.metadata).toMatchObject({ to: "cancelled", via: "patient_page" });
  });

  it("a guardian can cancel their child's appointment; the child can't cancel the guardian's", async () => {
    const child = await book({
      startsAt: riyadhAt("11:00", "2031-03-06"),
      patientId: patient("D-0039"),
      practitionerId: REEM,
    });
    const guardian = await book({
      startsAt: riyadhAt("12:00", "2031-03-06"),
      patientId: patient("D-0008"),
      practitionerId: REEM,
    });
    expect(
      await code(
        online((tx) =>
          cancelByPatient(tx, {
            patientId: patient("D-0039"),
            appointmentId: guardian.id,
            now: NOW,
          }),
        ),
      ),
    ).toBe("not_found");
    const done = await online((tx) =>
      cancelByPatient(tx, { patientId: patient("D-0008"), appointmentId: child.id, now: NOW }),
    );
    expect(done.status).toBe("cancelled");
  });

  it("reschedule: same rules as booking (notice, hours, free slot), within the window", async () => {
    const a = await book({
      startsAt: riyadhAt("13:00", "2031-03-06"),
      patientId: patient("D-0005"),
      practitionerId: REEM,
    });
    const move = (time: string, day = "2031-03-08", now = NOW) =>
      code(
        online((tx) =>
          moveByPatient(tx, {
            patientId: patient("D-0005"),
            appointmentId: a.id,
            startsAt: riyadhAt(time, day),
            now,
          }),
        ),
      );
    expect(await move("21:00")).toBe("outside_hours");
    expect(await move("10:00", "2031-04-20")).toBe("too_far");
    expect(await move("10:00", "2031-03-08", riyadhAt("08:00", "2031-03-06"))).toBe(
      "outside_window",
    );
    expect(await move("10:00")).toBe("ok");
    const [moved] = await withActor(reception, (tx) =>
      tx
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityId, a.id), eq(auditLogs.action, "appointment.reschedule"))),
    );
    expect(moved.metadata).toMatchObject({ via: "patient_page" });
  });
});

describe("patients from online booking", () => {
  it("a known mobile finds the existing patient (the adult when a family shares it)", async () => {
    const [d8] = await online((tx) =>
      tx
        .select()
        .from(patients)
        .where(eq(patients.id, patient("D-0008"))),
    );
    const { patient: found, created } = await online((tx) =>
      findOrCreateOnlinePatient(tx, {
        tenantId: DERMA,
        filePrefix: "D",
        phone: d8.phone,
        fullName: "اسم مختلف",
        gender: "male",
      }),
    );
    expect(created).toBe(false);
    expect(found.id).toBe(d8.id);
    expect(found.fullNameAr).toBe(d8.fullNameAr); // the name is not overwritten
  });

  it("an unknown mobile creates a new patient marked 'booked online — needs completion'", async () => {
    const { patient: p, created } = await online((tx) =>
      findOrCreateOnlinePatient(tx, {
        tenantId: DERMA,
        filePrefix: "D",
        phone: "0598765001",
        fullName: "  مريضة جديدة تجريبية ",
        gender: "female",
      }),
    );
    expect(created).toBe(true);
    expect(p.fileNumber).toMatch(/^D-\d{4}$/);
    expect(p.fullNameAr).toBe("مريضة جديدة تجريبية");
    expect(p.createdVia).toBe("online");
    expect(p.needsCompletion).toBe(true);
    expect(p.isFake).toBe(true);
  });

  it("two new patients at the same moment get different file numbers", async () => {
    const make = (phone: string) =>
      online((tx) =>
        findOrCreateOnlinePatient(tx, {
          tenantId: DERMA,
          filePrefix: "D",
          phone,
          fullName: "مريض متزامن",
          gender: "male",
        }),
      );
    const [a, b] = await Promise.all([make("0598765002"), make("0598765003")]);
    expect(a.patient.fileNumber).not.toBe(b.patient.fileNumber);
  });
});

describe("demo data", () => {
  it("Derma has online booking on, approval off, prices shown; six services online", async () => {
    const [s] = await online((tx) => tx.select().from(tenantSettings));
    expect(s).toMatchObject({
      onlineBookingEnabled: true,
      onlineRequiresApproval: false,
      showPricesOnline: true,
      onlineHorizonDays: 30,
      onlineMinNoticeMinutes: 120,
      cancellationWindowHours: 24,
    });
    const online6 = await online((tx) =>
      tx.select({ code: services.code }).from(services).where(eq(services.onlineBookable, true)),
    );
    expect(online6.map((r) => r.code).sort()).toEqual(
      [
        "chemical_peeling",
        "consultation",
        "botox",
        "facial_treatment",
        "fillers",
        "laser_hair_removal",
      ].sort(),
    );
  });
});
