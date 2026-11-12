import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auditEvent } from "@/lib/audit";
import { getCurrentTenant, type Tenant } from "@/lib/tenant/current";
import { PATH_HEADER } from "@/lib/tenant/host";
import { getAuth } from "./auth";
import { getStaffAccess, type Branch, type StaffAccess } from "./access";
import { can, type Permission } from "./permissions";
import type { Actor } from "./db";

export const BRANCH_COOKIE = "branch_id";

export interface StaffContext extends StaffAccess {
  tenant: Tenant;
  user: {
    id: string;
    name: string;
    nameEn: string | null;
    email: string;
    isPlatformOwner: boolean;
  };
  activeBranch: Branch | null;
  /** Two-step verification is on for this person. */
  twoFactorEnabled: boolean;
  /** …and must be (see twoFactorRequired): until it is, only My account works. */
  twoFactorRequired: boolean;
}

/**
 * Two-step verification is REQUIRED for clinic admins, doctors and the platform owner in real
 * (non-demo) clinics — they can reach patient records and settings. Optional for everyone else,
 * and in demo clinics (so the demo accounts keep working with a password alone).
 */
export function twoFactorRequired(
  tenant: { isDemo: boolean },
  user: { isPlatformOwner: boolean },
  roles: readonly string[],
) {
  if (tenant.isDemo) return false;
  return user.isPlatformOwner || roles.includes("clinic_admin") || roles.includes("practitioner");
}

/** Pages allowed while two-step verification still has to be set up. */
export const TWO_FACTOR_SETUP_PATH = "/account";

/** What database calls need to know about this staff member (see withActor). */
export function actorOf(ctx: StaffContext): Actor {
  return {
    tenantId: ctx.tenant.id,
    userId: ctx.user.id,
    roles: ctx.roles,
    memberId: ctx.memberId,
    restrictedBranchId: ctx.restrictedBranchId,
    name: ctx.user.name,
  };
}

/** The signed-in staff member for this clinic, or null. Cached for one request. */
export const getStaffContext = cache(async (): Promise<StaffContext | null> => {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;

  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;

  const extra = session.user as {
    isPlatformOwner?: boolean | null;
    nameEn?: string | null;
    twoFactorEnabled?: boolean | null;
  };
  const user = {
    id: session.user.id,
    name: session.user.name,
    nameEn: extra.nameEn ?? null,
    email: session.user.email,
    isPlatformOwner: Boolean(extra.isPlatformOwner),
  };
  const access = await getStaffAccess(tenant.id, user);
  if (!access) return null; // signed in, but not a member of THIS clinic

  const wanted = (await cookies()).get(BRANCH_COOKIE)?.value;
  const activeBranch = access.branches.find((b) => b.id === wanted) ?? access.branches[0] ?? null;

  return {
    ...access,
    tenant,
    user,
    activeBranch,
    twoFactorEnabled: Boolean(extra.twoFactorEnabled),
    twoFactorRequired: twoFactorRequired(tenant, user, access.roles),
  };
});

/** Use at the top of every protected page. Sends visitors to the login page. */
export async function requireStaff(): Promise<StaffContext> {
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/clinic-not-found");
  const ctx = await getStaffContext();
  if (!ctx) redirect("/login");
  if (ctx.twoFactorRequired && !ctx.twoFactorEnabled) {
    const path = (await headers()).get(PATH_HEADER) ?? "";
    if (path !== TWO_FACTOR_SETUP_PATH) redirect(`${TWO_FACTOR_SETUP_PATH}?twoFactor=required`);
  }
  if (ctx.support) await logSupportView(ctx.tenant.id, ctx.user.id);
  return ctx;
}

/** During support access, every page the platform owner opens is recorded (once per request). */
const logSupportView = cache(async (tenantId: string, userId: string) => {
  const path = (await headers()).get(PATH_HEADER) ?? null;
  await auditEvent(tenantId, {
    actorUserId: userId,
    action: "support.view",
    entityType: "page",
    entityId: path,
    metadata: { path },
  });
});

/** Use at the top of a page that needs a specific permission. */
export async function requirePermission(permission: Permission): Promise<StaffContext> {
  const ctx = await requireStaff();
  if (!can(ctx.roles, permission)) redirect("/forbidden");
  return ctx;
}
