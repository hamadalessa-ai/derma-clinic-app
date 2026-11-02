import { eq, inArray } from "drizzle-orm";
import { tenantMembers, users } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";

/** Doctors' display names (public: they're on the booking page too). */
export async function doctorNames(tx: TenantTx, memberIds: string[]) {
  const ids = [...new Set(memberIds)];
  if (!ids.length) return new Map<string, { nameAr: string; nameEn: string | null }>();
  const rows = await tx
    .select({ id: tenantMembers.id, nameAr: users.name, nameEn: users.nameEn })
    .from(tenantMembers)
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(inArray(tenantMembers.id, ids));
  return new Map(rows.map((r) => [r.id, { nameAr: r.nameAr, nameEn: r.nameEn }]));
}
