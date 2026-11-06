import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { withTenant } from "@/db/tenant";
import { branches, tenantMembers, tenants, users } from "@/db/schema";
import { staffMaySignIn } from "@/lib/tenant/status";
import type { Role } from "./permissions";

export type Branch = typeof branches.$inferSelect;

export interface StaffAccess {
  /** All roles in this clinic (at least one). */
  roles: Role[];
  memberId: string | null;
  /** Set when this person may only work in one branch. */
  restrictedBranchId: string | null;
  /** Branches this person may switch between (all, or only their own). */
  branches: Branch[];
  titleAr: string | null;
  titleEn: string | null;
}

/**
 * What a signed-in user may do inside one clinic. Returns null when they don't belong to it.
 * Clinic membership wins over platform-owner status.
 */
export async function getStaffAccess(
  tenantId: string,
  user: { id: string; isPlatformOwner?: boolean | null },
): Promise<StaffAccess | null> {
  if (!user.isPlatformOwner && !(await clinicOpenToStaff(tenantId))) return null;
  return withTenant(tenantId, async (tx) => {
    const [member] = await tx
      .select()
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, user.id))
      .limit(1);

    // A deactivated member (left the clinic) has no access, like a non-member.
    if (member?.deactivatedAt && !user.isPlatformOwner) return null;
    if (!member && !user.isPlatformOwner) return null;

    const all = await tx
      .select()
      .from(branches)
      .orderBy(asc(branches.sortOrder), asc(branches.nameEn));
    const visible = member?.branchId ? all.filter((b) => b.id === member.branchId) : all;

    return {
      roles: member && !member.deactivatedAt ? member.roles : ["platform_owner"],
      memberId: member && !member.deactivatedAt ? member.id : null,
      restrictedBranchId: member && !member.deactivatedAt ? member.branchId : null,
      branches: visible,
      titleAr: member?.titleAr ?? null,
      titleEn: member?.titleEn ?? null,
    };
  });
}

/** Before checking a password: is this email allowed to sign in to this clinic at all? */
export async function canSignInToClinic(tenantId: string, email: string): Promise<boolean> {
  const [user] = await getDb()
    .select({ id: users.id, isPlatformOwner: users.isPlatformOwner })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  if (!user) return false;
  if (user.isPlatformOwner) return true;
  if (!(await clinicOpenToStaff(tenantId))) return false;
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: tenantMembers.id })
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.userId, user.id),
          eq(tenantMembers.tenantId, tenantId),
          isNull(tenantMembers.deactivatedAt),
        ),
      )
      .limit(1),
  );
  return rows.length > 0;
}

/** A suspended clinic: nobody but the platform owner signs in (existing sessions stop working). */
async function clinicOpenToStaff(tenantId: string) {
  const [t] = await getDb()
    .select({ status: tenants.status })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return !!t && staffMaySignIn(t);
}
