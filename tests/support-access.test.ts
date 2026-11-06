/**
 * Support access: given by the clinic's admin, never taken by the platform. Without it the platform
 * owner sees NO patient data (enforced by the database, app_platform_gate()); with it they work as
 * a clinic admin (never clinical notes), view-only unless the clinic allowed changes, and every page
 * is recorded. The platform can't give itself access.
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { auditLogs, clinicalNotes, patients, supportGrants } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { getStaffAccess } from "@/lib/auth/access";
import type { Actor } from "@/lib/auth/db";
import { PermissionError } from "@/lib/auth/permissions";
import { createClinic } from "@/lib/platform/clinics";
import { activeGrant, endSupport, grantSupport, SupportError } from "@/lib/support/grants";

afterAll(closeDb);

const OWNER_ID = "usr_platform-owner";
const stamp = Date.now().toString(36);

async function clinicWithPatient(tag: string) {
  const c = await createClinic(
    { userId: OWNER_ID, roles: ["platform_owner"] },
    {
      slug: `sup-${tag}-${stamp}`,
      nameAr: "عيادة الدعم",
      nameEn: "Support Clinic",
      brandColor: "#28817a",
      isDemo: true,
      branch: { nameAr: "الفرع", nameEn: "Main", cityAr: "الرياض", cityEn: "Riyadh" },
      department: { nameAr: "الجلدية", nameEn: "Dermatology" },
      admin: { nameAr: "مدير", email: `admin-sup-${tag}-${stamp}@t.demo` },
    },
  );
  await withTenant(c.tenantId, (tx) =>
    tx.insert(patients).values({
      tenantId: c.tenantId,
      fileNumber: "S-0001",
      fullNameAr: "مريض تجريبي",
      phone: "0550000001",
      gender: "female",
      isFake: true,
    }),
  );
  const [member] = await withTenant(c.tenantId, (tx) =>
    tx.execute<{ id: string }>(sql`select id from public.tenant_members limit 1`),
  );
  const admin: Actor = {
    tenantId: c.tenantId,
    userId: c.adminUserId,
    roles: ["clinic_admin"],
    memberId: member.id,
    restrictedBranchId: null,
  };
  return { ...c, admin };
}

/** What the platform owner's queries see in this clinic (as the app would run them). */
const ownerSees = (tenantId: string) =>
  withTenant(
    { tenantId, userId: OWNER_ID, roles: ["platform_owner", "clinic_admin"] },
    (tx) => tx.select({ id: patients.id }).from(patients),
  );

describe("support access", () => {
  it("without a grant, the platform owner sees no patients, even with admin roles", async () => {
    const c = await clinicWithPatient("a");
    expect(await ownerSees(c.tenantId)).toHaveLength(0);
    // The clinic's own admin sees them.
    const own = await withTenant(
      { tenantId: c.tenantId, userId: c.adminUserId, roles: ["clinic_admin"] },
      (tx) => tx.select().from(patients),
    );
    expect(own).toHaveLength(1);
    const access = await getStaffAccess(c.tenantId, { id: OWNER_ID, isPlatformOwner: true });
    expect(access).toMatchObject({ roles: ["platform_owner"], support: null });
  });

  it("with a grant: a clinic admin's view (no notes), until it is ended", async () => {
    const c = await clinicWithPatient("b");
    await withTenant(
      { tenantId: c.tenantId, userId: c.adminUserId, roles: ["clinic_admin"] },
      (tx) => grantSupport(tx, c.admin, { hours: 4, allowChanges: false, reason: "Hours setup" }),
    );
    const access = await getStaffAccess(c.tenantId, { id: OWNER_ID, isPlatformOwner: true });
    expect(access?.roles.sort()).toEqual(["clinic_admin", "platform_owner"]);
    expect(access?.support).toMatchObject({ allowChanges: false });
    expect(await ownerSees(c.tenantId)).toHaveLength(1);
    // Clinical notes stay closed (they need the practitioner role).
    const notes = await withTenant(
      { tenantId: c.tenantId, userId: OWNER_ID, roles: ["platform_owner", "clinic_admin"] },
      (tx) => tx.select({ id: clinicalNotes.id }).from(clinicalNotes),
    );
    expect(notes).toHaveLength(0);

    await withTenant(
      { tenantId: c.tenantId, userId: c.adminUserId, roles: ["clinic_admin"] },
      (tx) => endSupport(tx, c.admin),
    );
    expect(await ownerSees(c.tenantId)).toHaveLength(0);
    const log = await withTenant(c.tenantId, (tx) =>
      tx.select({ action: auditLogs.action }).from(auditLogs),
    );
    expect(log.map((l) => l.action)).toEqual(
      expect.arrayContaining(["support.granted", "support.ended"]),
    );
  });

  it("expires on its own", async () => {
    const c = await clinicWithPatient("c");
    await withTenant(
      { tenantId: c.tenantId, userId: c.adminUserId, roles: ["clinic_admin"] },
      (tx) => grantSupport(tx, c.admin, { hours: 1, allowChanges: true }),
    );
    expect(await ownerSees(c.tenantId)).toHaveLength(1);
    // Simulate time passing: the grant is checked against now().
    const later = new Date(Date.now() + 2 * 3600_000);
    expect(await withTenant(c.tenantId, (tx) => activeGrant(tx, later))).toBeNull();
  });

  it("can't be given or ended by the platform itself (app AND database)", async () => {
    const c = await clinicWithPatient("d");
    const ownerActor: Actor = {
      tenantId: c.tenantId,
      userId: OWNER_ID,
      roles: ["platform_owner", "clinic_admin"],
      memberId: null,
      restrictedBranchId: null,
    };
    const ctx = { tenantId: c.tenantId, userId: OWNER_ID, roles: ["platform_owner", "clinic_admin"] };
    await expect(
      withTenant(ctx, (tx) => grantSupport(tx, ownerActor, { hours: 72, allowChanges: true })),
    ).rejects.toBeInstanceOf(PermissionError);
    await expect(
      withTenant(ctx, (tx) =>
        tx.insert(supportGrants).values({
          tenantId: c.tenantId,
          grantedBy: OWNER_ID,
          expiresAt: sql`now() + interval '72 hours'`,
        }),
      ),
    ).rejects.toThrow();
    expect(await ownerSees(c.tenantId)).toHaveLength(0);
  });

  it("only one grant at a time", async () => {
    const c = await clinicWithPatient("e");
    const as = { tenantId: c.tenantId, userId: c.adminUserId, roles: ["clinic_admin"] };
    await withTenant(as, (tx) => grantSupport(tx, c.admin, { hours: 1, allowChanges: false }));
    await expect(
      withTenant(as, (tx) => grantSupport(tx, c.admin, { hours: 1, allowChanges: false })),
    ).rejects.toBeInstanceOf(SupportError);
  });
});
