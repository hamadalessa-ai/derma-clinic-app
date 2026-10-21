import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { withTenant } from "@/db/tenant";
import { branches, tenantMembers, users } from "@/db/schema";
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
  return withTenant(tenantId, async (tx) => {
    const [member] = await tx
      .select()
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, user.id))
      .limit(1);

    if (!member && !user.isPlatformOwner) return null;

    const all = await tx
      .select()
      .from(branches)
      .orderBy(asc(branches.sortOrder), asc(branches.nameEn));
    const visible = member?.branchId ? all.filter((b) => b.id === member.branchId) : all;

    return {
      roles: member ? member.roles : ["platform_owner"],
      memberId: member?.id ?? null,
      restrictedBranchId: member?.branchId ?? null,
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
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: tenantMembers.id })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.userId, user.id), eq(tenantMembers.tenantId, tenantId)))
      .limit(1),
  );
  return rows.length > 0;
}
