import "server-only";
/**
 * The platform owner's view of each clinic: status and a setup checklist — COUNTS ONLY, never a
 * patient's name or record. Read inside each clinic's own context (RLS), one clinic at a time.
 */
import { and, asc, count, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  accounts,
  appointments,
  consentTemplates,
  services,
  staffSchedules,
  tenantMembers,
  tenantSettings,
  tenants,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { whatsappMode } from "@/lib/whatsapp/config";

export const SETUP_STEPS = [
  "admin",
  "services",
  "hours",
  "consents",
  "website",
  "whatsapp",
  "booking",
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export type Tenant = typeof tenants.$inferSelect;

export interface ClinicOverview {
  tenant: Tenant;
  setup: Record<SetupStep, boolean>;
}

async function one(q: Promise<{ n: number }[]>) {
  const [r] = await q;
  return Number(r?.n ?? 0);
}

export async function setupOf(tenant: Tenant): Promise<Record<SetupStep, boolean>> {
  return withTenant(tenant.id, async (tx) => {
    const admins = await one(
      tx
        .select({ n: count() })
        .from(tenantMembers)
        .innerJoin(
          accounts,
          and(eq(accounts.userId, tenantMembers.userId), isNotNull(accounts.password)),
        )
        .where(
          and(
            isNull(tenantMembers.deactivatedAt),
            sql`'clinic_admin' = any(${tenantMembers.roles})`,
          ),
        ),
    );
    const [settings] = await tx.select({ site: tenantSettings.site }).from(tenantSettings).limit(1);
    return {
      admin: admins > 0,
      services:
        (await one(tx.select({ n: count() }).from(services).where(eq(services.isActive, true)))) >
        0,
      hours: (await one(tx.select({ n: count() }).from(staffSchedules))) > 0,
      consents: (await one(tx.select({ n: count() }).from(consentTemplates))) > 0,
      website: Object.keys(settings?.site ?? {}).length > 0,
      // Configured (demo or live), whatever the current status.
      whatsapp: whatsappMode({ isDemo: tenant.isDemo, slug: tenant.slug }) !== "off",
      booking: (await one(tx.select({ n: count() }).from(appointments))) > 0,
    };
  });
}

/** Every clinic on the platform, oldest first, with its setup checklist. */
export async function platformOverview(): Promise<ClinicOverview[]> {
  const rows = await getDb().select().from(tenants).orderBy(asc(tenants.createdAt));
  const out: ClinicOverview[] = [];
  for (const tenant of rows) out.push({ tenant, setup: await setupOf(tenant) });
  return out;
}
