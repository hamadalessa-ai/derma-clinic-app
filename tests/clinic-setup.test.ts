/**
 * Clinic set-up by the admin: departments, services (with the doctors who do them), rooms,
 * devices, packages and new consent forms. Only admins; audited; the booking engine follows it.
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { auditLogs, rooms, tenantMembers } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import type { Actor } from "@/lib/auth/db";
import { createClinic } from "@/lib/platform/clinics";
import { withActor } from "@/lib/auth/db";
import { PermissionError } from "@/lib/auth/permissions";
import { BookingError, bookAppointment, findFreeSlots } from "@/lib/booking/engine";
import {
  codeFrom,
  createConsentForm,
  loadSetup,
  saveBranch,
  saveDepartment,
  saveDevice,
  savePackage,
  saveRoom,
  saveService,
  SetupError,
} from "@/lib/setup/admin";
import { admin, drReem, drSara, patient, reception, RIYADH, riyadhAt } from "./fixtures";

afterAll(closeDb);

const stamp = Date.now()
  .toString(36)
  .replace(/[^a-z]/g, "");

describe("codes", () => {
  it("come from the English name, letters only, never twice", () => {
    expect(codeFrom("Laser Hair Removal", [])).toBe("laser_hair_removal");
    expect(codeFrom("Laser Hair Removal", ["laser_hair_removal"])).toBe("laser_hair_removal_a");
    expect(codeFrom("123", [])).toBe("item");
  });
});

describe("clinic set-up", () => {
  it("only clinic admins may change it", async () => {
    await expect(
      withActor(reception, (tx) =>
        saveDepartment(tx, reception, { nameAr: "س", nameEn: "X", isActive: true }),
      ),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("adds a department and a service only some doctors do; booking follows it", async () => {
    const dept = await withActor(admin, (tx) =>
      saveDepartment(tx, admin, {
        nameAr: "طب الأسنان",
        nameEn: `Dental ${stamp}`,
        isActive: true,
      }),
    );
    const svc = await withActor(admin, (tx) =>
      saveService(tx, admin, {
        departmentId: dept.id,
        nameAr: "تنظيف الأسنان",
        nameEn: `Teeth Cleaning ${stamp}`,
        durationMinutes: 30,
        bufferMinutes: 10,
        priceHalalas: 25000,
        onlineBookable: false,
        isVirtual: false,
        isActive: true,
        doctorIds: [drSara.memberId!],
      }),
    );
    expect(svc).toMatchObject({ priceHalalas: 25000, isDemoValue: false });

    const slots = (doctor: string) =>
      withActor(admin, (tx) =>
        findFreeSlots(tx, {
          branchId: RIYADH,
          serviceId: svc.id,
          practitionerId: doctor,
          from: riyadhAt("09:00", "2030-02-10"),
          days: 3,
          limit: 3,
        }),
      );
    expect((await slots(drSara.memberId!)).length).toBeGreaterThan(0);
    expect(await slots(drReem.memberId!)).toEqual([]);

    await expect(
      withActor(admin, (tx) =>
        bookAppointment(tx, admin, {
          branchId: RIYADH,
          patientId: patient("D-0005"),
          serviceId: svc.id,
          practitionerId: drReem.memberId!,
          startsAt: riyadhAt("11:00", "2030-02-11"),
        }),
      ),
    ).rejects.toMatchObject({ code: "not_for_service" });

    // Everyone again when no doctor is ticked.
    await withActor(admin, (tx) =>
      saveService(tx, admin, {
        id: svc.id,
        departmentId: dept.id,
        nameAr: "تنظيف الأسنان",
        nameEn: `Teeth Cleaning ${stamp}`,
        durationMinutes: 30,
        bufferMinutes: 10,
        priceHalalas: 25000,
        onlineBookable: false,
        isVirtual: false,
        isActive: true,
        doctorIds: [],
      }),
    );
    expect((await slots(drReem.memberId!)).length).toBeGreaterThan(0);

    const log = await withActor(admin, (tx) =>
      tx.select().from(auditLogs).where(eq(auditLogs.entityId, svc.id)),
    );
    expect(log.map((l) => l.action)).toEqual(
      expect.arrayContaining(["setup.service.create", "setup.service.update"]),
    );
  });

  it("rejects a doctor who isn't a doctor and a consent form that doesn't exist", async () => {
    const { departments } = await withActor(admin, (tx) => loadSetup(tx));
    const base = {
      departmentId: departments[0]!.id,
      nameAr: "خدمة",
      nameEn: `Bad ${stamp}`,
      durationMinutes: 30,
      bufferMinutes: 0,
      priceHalalas: 100,
      onlineBookable: false,
      isVirtual: false,
      isActive: true,
    };
    await expect(
      withActor(admin, (tx) =>
        saveService(tx, admin, { ...base, doctorIds: [reception.memberId!] }),
      ),
    ).rejects.toMatchObject({ code: "bad_doctor" });
    await expect(
      withActor(admin, (tx) =>
        saveService(tx, admin, { ...base, consentCode: "nope", doctorIds: [] }),
      ),
    ).rejects.toBeInstanceOf(SetupError);
  });

  it("a new branch gets a first room; rooms and devices can be switched off", async () => {
    // In a clinic of its own, so Derma's branch count stays the same for other tests.
    const c = await createClinic(
      { userId: "usr_platform-owner", roles: ["platform_owner"] },
      {
        slug: `setup-${stamp}`.slice(0, 30),
        nameAr: "عيادة الإعداد",
        nameEn: "Setup Clinic",
        brandColor: "#28817a",
        isDemo: true,
        branch: { nameAr: "الفرع", nameEn: "Main", cityAr: "الرياض", cityEn: "Riyadh" },
        department: { nameAr: "الجلدية", nameEn: "Dermatology" },
        admin: { nameAr: "مدير", email: `admin-setup-${stamp}@t.demo` },
      },
    );
    const [m] = await withTenant(c.tenantId, (tx) =>
      tx.select({ id: tenantMembers.id }).from(tenantMembers),
    );
    const owner: Actor = {
      tenantId: c.tenantId,
      userId: c.adminUserId,
      roles: ["clinic_admin"],
      memberId: m!.id,
      restrictedBranchId: null,
    };
    const branch = await withActor(owner, (tx) =>
      saveBranch(tx, owner, {
        nameAr: "فرع الاختبار",
        nameEn: `Test ${stamp}`,
        cityAr: "الرياض",
        cityEn: "Riyadh",
      }),
    );
    const [first] = await withActor(owner, (tx) =>
      tx.select().from(rooms).where(eq(rooms.branchId, branch.id)),
    );
    expect(first).toBeDefined();
    const off = await withActor(owner, (tx) =>
      saveRoom(tx, owner, {
        id: first!.id,
        branchId: branch.id,
        nameAr: first!.nameAr,
        nameEn: first!.nameEn,
        isActive: false,
      }),
    );
    expect(off.isActive).toBe(false);
    const dev = await withActor(owner, (tx) =>
      saveDevice(tx, owner, {
        branchId: branch.id,
        deviceType: "Pico Laser",
        nameAr: "بيكو",
        nameEn: "Pico",
        isActive: true,
      }),
    );
    expect(dev.deviceType).toBe("pico_laser");
  });

  it("adds a package and a new consent form (version 1)", async () => {
    const { services } = await withActor(admin, (tx) => loadSetup(tx));
    const pkg = await withActor(admin, (tx) =>
      savePackage(tx, admin, {
        serviceId: services[0]!.id,
        nameAr: "باقة",
        nameEn: `Pack ${stamp}`,
        sessionsCount: 4,
        priceHalalas: 200000,
        validityDays: 180,
        isActive: true,
      }),
    );
    expect(pkg.sessionsCount).toBe(4);
    const form = await withActor(admin, (tx) =>
      createConsentForm(tx, admin, {
        titleAr: "موافقة تنظيف الأسنان",
        titleEn: `Teeth Cleaning Consent ${stamp}`,
        bodyAr: "أوافق.",
        bodyEn: "I agree.",
      }),
    );
    expect(form).toMatchObject({ version: 1, isCurrent: true });
    expect(form.code).toMatch(/^[a-z_]+$/);
  });
});

it("BookingError is still the engine's error type", () => {
  expect(new BookingError("not_for_service").code).toBe("not_for_service");
});
