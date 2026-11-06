/**
 * Platform owner → Add a clinic: the clinic, its first branch/department/room and first admin are
 * created together; the address must be free and valid; only a platform owner may do it (checked
 * in the app AND in the database); the owner still sees no patients; the new clinic is isolated.
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import { auditLogs, branches, patients, rooms, tenantMembers, tenants } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { getStaffAccess } from "@/lib/auth/access";
import { PermissionError } from "@/lib/auth/permissions";
import { ClinicError, clinicAddress, createClinic, type NewClinic } from "@/lib/platform/clinics";
import { inviteToken, parseInviteToken } from "@/lib/team/invite";
import { DERMA } from "./fixtures";

afterAll(closeDb);

const OWNER = { userId: "usr_platform-owner", roles: ["platform_owner"] as const };
const stamp = Date.now().toString(36);
const clinic = (slug: string, email = `admin-${slug}@t.demo`): NewClinic => ({
  slug,
  nameAr: "عيادة النخبة",
  nameEn: "Elite Clinic",
  brandColor: "#0B5D4C",
  isDemo: true,
  branch: { nameAr: "فرع العليا", nameEn: "Olaya", cityAr: "الرياض", cityEn: "Riyadh" },
  department: { nameAr: "الجلدية", nameEn: "Dermatology" },
  admin: { nameAr: "مدير النخبة", email },
});
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ClinicError) return e.code;
    if (e instanceof PermissionError) return "not_allowed";
    throw e;
  }
  return "ok";
};

describe("add a clinic", () => {
  it("creates the clinic, branch, department, room and its first admin in one go", async () => {
    const slug = `elite-${stamp}`;
    const r = await createClinic(OWNER, clinic(slug));
    expect(r.needsPassword).toBe(true);

    const [row] = await getDb().select().from(tenants).where(eq(tenants.id, r.tenantId));
    expect(row).toMatchObject({ slug, brandColor: "#0b5d4c", isDemo: true });

    const inside = await withTenant(r.tenantId, async (tx) => ({
      branches: await tx.select().from(branches),
      rooms: await tx.select().from(rooms),
      members: await tx.select().from(tenantMembers),
      audit: await tx.select().from(auditLogs).where(eq(auditLogs.action, "clinic.create")),
    }));
    expect(inside.branches).toHaveLength(1);
    expect(inside.rooms).toHaveLength(1);
    expect(inside.members).toHaveLength(1);
    expect(inside.members[0]).toMatchObject({ userId: r.adminUserId, roles: ["clinic_admin"] });
    expect(inside.audit[0]?.actorUserId).toBe(OWNER.userId);

    // The admin can work in the new clinic, and only there.
    const access = await getStaffAccess(r.tenantId, { id: r.adminUserId });
    expect(access?.roles).toEqual(["clinic_admin"]);
    expect(await getStaffAccess(DERMA, { id: r.adminUserId })).toBeNull();

    // Their invitation opens only on the new clinic.
    const tok = inviteToken(r.tenantId, r.adminUserId);
    expect(parseInviteToken(r.tenantId, tok)).toBe(r.adminUserId);
    expect(parseInviteToken(DERMA, tok)).toBeNull();

    // Nothing of the new clinic is visible from Derma.
    const seen = await withTenant(DERMA, (tx) =>
      tx.select().from(branches).where(eq(branches.tenantId, r.tenantId)),
    );
    expect(seen).toHaveLength(0);
  });

  it("rejects a taken, reserved or badly written address", async () => {
    expect(await code(createClinic(OWNER, clinic("derma")))).toBe("slug_taken");
    expect(await code(createClinic(OWNER, clinic("admin")))).toBe("slug_invalid");
    expect(await code(createClinic(OWNER, clinic("Bad Name")))).toBe("slug_invalid");
    expect(await code(createClinic(OWNER, clinic("1clinic")))).toBe("slug_invalid");
  });

  it("is for the platform owner only (app check AND database check)", async () => {
    expect(
      await code(
        createClinic({ userId: "usr_derma-admin", roles: ["clinic_admin"] }, clinic(`x-${stamp}`)),
      ),
    ).toBe("not_allowed");
    // Even if the app check were skipped, the database refuses a non-owner.
    await expect(
      getDb().transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', 'usr_derma-admin', true)`);
        await tx.execute(
          sql`select public.app_create_clinic(${`y-${stamp}`}, 'x', 'x', '#000000', true)`,
        );
      }),
    ).rejects.toThrow(/platform owner/);
    const [none] = await getDb().select().from(tenants).where(eq(tenants.slug, `y-${stamp}`));
    expect(none).toBeUndefined();
  });

  it("keeps the owner out of patient data", async () => {
    const [p] = await getDb().select().from(patients).limit(1);
    expect(p).toBeUndefined();
  });

  it("an existing account can become the admin of a second clinic", async () => {
    const email = `shared-${stamp}@t.demo`;
    const a = await createClinic(OWNER, clinic(`one-${stamp}`, email));
    const b = await createClinic(OWNER, clinic(`two-${stamp}`, email));
    expect(b.adminUserId).toBe(a.adminUserId);
    expect(b.needsPassword).toBe(false);
  });
});

describe("clinic address", () => {
  it("is a subdomain of the platform's own domain, or none on a borrowed address", () => {
    expect(clinicAddress("elite", { host: "derma.clinicapp.sa", proto: "https" }, "clinicapp.sa")).toBe(
      "https://elite.clinicapp.sa",
    );
    expect(clinicAddress("elite", { host: "derma.localhost:3000", proto: "http" }, "localhost")).toBe(
      "http://elite.localhost:3000",
    );
    expect(
      clinicAddress("elite", { host: "derma-clinic-app.vercel.app", proto: "https" }, "clinicapp.sa"),
    ).toBeNull();
  });
});
