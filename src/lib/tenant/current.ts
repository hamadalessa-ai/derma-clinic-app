import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { tenants } from "@/db/schema";
import { CLINIC_HEADER, clinicSlugFromEnv } from "./host";

export type Tenant = typeof tenants.$inferSelect;

export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const [tenant] = await getDb().select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  return tenant ?? null;
}

/** The clinic for the current request (from the proxy header, or the Host as a fallback). */
export const getCurrentTenant = cache(async (): Promise<Tenant | null> => {
  const h = await headers();
  const slug = h.get(CLINIC_HEADER) ?? clinicSlugFromEnv(h.get("host"));
  return slug ? getTenantBySlug(slug) : null;
});
