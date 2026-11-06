import "server-only";
/**
 * Platform owner → New clinic. Creates the clinic (address, names, colour), its first branch,
 * first department and a consultation room, and its first admin, who gets an invitation link to
 * set their own password. The owner never becomes a member and never sees the clinic's patients:
 * from then on the clinic's own admin runs it (Settings → Team, Services, Working hours…).
 *
 * All in ONE transaction: either the whole clinic exists, or nothing does.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { branches, departments, rooms, tenantMembers, tenants, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { assertCan, type Role } from "@/lib/auth/permissions";

export class ClinicError extends Error {
  constructor(public code: "slug_taken" | "slug_invalid") {
    super(code);
  }
}

export interface NewClinic {
  slug: string;
  nameAr: string;
  nameEn: string;
  brandColor: string;
  isDemo: boolean;
  branch: { nameAr: string; nameEn: string; cityAr: string; cityEn: string };
  department: { nameAr: string; nameEn: string };
  admin: { nameAr: string; nameEn?: string | null; email: string };
}

/** Same rule as the database function: starts with a letter, 2–30 characters. */
export const SLUG_RULE = /^[a-z][a-z0-9-]{0,28}[a-z0-9]$/;
const RESERVED = new Set(["www", "app", "api", "admin"]);

export async function createClinic(
  owner: { userId: string; roles: readonly Role[] },
  c: NewClinic,
): Promise<{ tenantId: string; slug: string; adminUserId: string; needsPassword: boolean }> {
  assertCan(owner.roles, "platform:clinics");
  const slug = c.slug.trim().toLowerCase();
  if (!SLUG_RULE.test(slug) || RESERVED.has(slug)) throw new ClinicError("slug_invalid");
  const db = getDb();
  const [taken] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug));
  if (taken) throw new ClinicError("slug_taken");

  return db.transaction(async (tx) => {
    // The database checks again that this user is a platform owner.
    await tx.execute(sql`select set_config('app.user_id', ${owner.userId}, true)`);
    const created = await tx.execute<{ id: string }>(
      sql`select public.app_create_clinic(${slug}, ${c.nameAr.trim()}, ${c.nameEn.trim()},
            ${c.brandColor.toLowerCase()}, ${c.isDemo}) as id`,
    );
    const tenantId = String(created[0]?.id);
    // From here on this transaction works inside the NEW clinic only (same setting withTenant uses).
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);

    const email = c.admin.email.trim().toLowerCase();
    let [user] = await tx.select().from(users).where(eq(users.email, email)).limit(1);
    const isNew = !user;
    if (!user) {
      [user] = await tx
        .insert(users)
        .values({
          id: `usr_${randomUUID().replace(/-/g, "")}`,
          name: c.admin.nameAr.trim(),
          nameEn: c.admin.nameEn?.trim() || null,
          email,
          emailVerified: false,
        })
        .returning();
    }

    const [branch] = await tx
      .insert(branches)
      .values({
        tenantId,
        nameAr: c.branch.nameAr.trim(),
        nameEn: c.branch.nameEn.trim(),
        cityAr: c.branch.cityAr.trim(),
        cityEn: c.branch.cityEn.trim(),
      })
      .returning({ id: branches.id });
    await tx.insert(departments).values({
      tenantId,
      code: "main",
      nameAr: c.department.nameAr.trim(),
      nameEn: c.department.nameEn.trim(),
      isActive: true,
    });
    await tx.insert(rooms).values({
      tenantId,
      branchId: branch.id,
      nameAr: "غرفة الكشف 1",
      nameEn: "Consultation Room 1",
    });
    const [member] = await tx
      .insert(tenantMembers)
      .values({ tenantId, userId: user.id, roles: ["clinic_admin"], branchId: null })
      .returning({ id: tenantMembers.id });
    await audit(tx, {
      actorUserId: owner.userId,
      action: "clinic.create",
      entityType: "tenant",
      entityId: tenantId,
      metadata: { slug, adminMemberId: member.id, isDemo: c.isDemo },
    });
    return { tenantId, slug, adminUserId: user.id, needsPassword: isNew };
  });
}

/**
 * The new clinic's own address, built from the address the owner is using now
 * (derma.clinicapp.sa → newclinic.clinicapp.sa). Null when the platform has no domain of its
 * own yet (e.g. *.vercel.app): clinic addresses only work under APP_ROOT_DOMAIN.
 */
export function clinicAddress(
  slug: string,
  current: { host: string; proto: string },
  rootDomain = process.env.APP_ROOT_DOMAIN ?? "localhost",
): string | null {
  const root = rootDomain.trim().toLowerCase();
  const [hostname, port] = current.host.toLowerCase().split(":");
  if (!root || (hostname !== root && !hostname.endsWith(`.${root}`))) return null;
  return `${current.proto}://${slug}.${root}${port ? `:${port}` : ""}`;
}
