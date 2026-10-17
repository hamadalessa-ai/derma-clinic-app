import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentTenant, type Tenant } from "@/lib/tenant/current";
import { getAuth } from "./auth";
import { getStaffAccess, type Branch, type StaffAccess } from "./access";
import { can, type Permission } from "./permissions";

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
}

/** The signed-in staff member for this clinic, or null. Cached for one request. */
export const getStaffContext = cache(async (): Promise<StaffContext | null> => {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;

  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;

  const extra = session.user as { isPlatformOwner?: boolean | null; nameEn?: string | null };
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

  return { ...access, tenant, user, activeBranch };
});

/** Use at the top of every protected page. Sends visitors to the login page. */
export async function requireStaff(): Promise<StaffContext> {
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/clinic-not-found");
  const ctx = await getStaffContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/** Use at the top of a page that needs a specific permission. */
export async function requirePermission(permission: Permission): Promise<StaffContext> {
  const ctx = await requireStaff();
  if (!can(ctx.role, permission)) redirect("/forbidden");
  return ctx;
}
