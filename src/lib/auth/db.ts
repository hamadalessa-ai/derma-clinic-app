import { withTenant, type DbContext, type TenantTx } from "@/db/tenant";
import type { Role } from "./permissions";

/** The minimum a database call needs to know about the signed-in staff member. */
export interface Actor {
  tenantId: string;
  userId: string;
  roles: readonly Role[];
  memberId: string | null;
  /** null = all branches. */
  restrictedBranchId: string | null;
  name?: string;
}

export function dbContextFor(actor: Actor): DbContext {
  return {
    tenantId: actor.tenantId,
    userId: actor.userId,
    roles: actor.roles,
    branchIds: actor.restrictedBranchId ? [actor.restrictedBranchId] : null,
  };
}

/** withTenant() for a signed-in staff member: the database also knows who they are. */
export function withActor<T>(actor: Actor, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return withTenant(dbContextFor(actor), fn);
}
