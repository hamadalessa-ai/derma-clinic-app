import "server-only";
/**
 * The platform owner's view of each clinic: status and a setup checklist — COUNTS ONLY, never a
 * patient's name or record. Read inside each clinic's own context (RLS), one clinic at a time.
 */
import { and, asc, count, eq, gte, isNotNull, isNull, max, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  accounts,
  appointments,
  auditLogs,
  branches,
  consentTemplates,
  files,
  messages,
  services,
  staffSchedules,
  tenantMembers,
  tenantSettings,
  tenants,
  users,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { whatsappMode } from "@/lib/whatsapp/config";
import { statementsOf, type StatementView } from "./billing";
import {
  aiUsedThisMonth,
  effectiveLimits,
  monthStart,
  WARN_AT,
  whatsappSentThisMonth,
} from "./limits";

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

export interface ClinicUsage {
  staff: number;
  doctors: number;
  branches: number;
  appointmentsThisMonth: number;
  whatsappThisMonth: number;
  aiRepliesThisMonth: number;
  aiScribeThisMonth: number;
  files: number;
  lastSignInAt: Date | null;
  limits: { aiMonthly: number | null; whatsappMonthly: number | null };
}

export interface ClinicOverview {
  tenant: Tenant;
  setup: Record<SetupStep, boolean>;
  usage: ClinicUsage;
  statements: StatementView[];
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

/** This month's usage (Riyadh calendar month): counts only. */
export async function usageOf(tenant: Tenant, now: Date = new Date()): Promise<ClinicUsage> {
  const from = monthStart(now);
  return withTenant(tenant.id, async (tx) => {
    const active = isNull(tenantMembers.deactivatedAt);
    const [lastLogin] = await tx
      .select({ at: max(auditLogs.createdAt) })
      .from(auditLogs)
      // The clinic's own staff (the platform owner's visits don't count).
      .innerJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(and(eq(auditLogs.action, "auth.login"), eq(users.isPlatformOwner, false)));
    return {
      staff: await one(tx.select({ n: count() }).from(tenantMembers).where(active)),
      doctors: await one(
        tx
          .select({ n: count() })
          .from(tenantMembers)
          .where(and(active, sql`'practitioner' = any(${tenantMembers.roles})`)),
      ),
      branches: await one(tx.select({ n: count() }).from(branches)),
      appointmentsThisMonth: await one(
        tx.select({ n: count() }).from(appointments).where(gte(appointments.startsAt, from)),
      ),
      whatsappThisMonth: await one(
        tx
          .select({ n: count() })
          .from(messages)
          .where(and(eq(messages.direction, "out"), gte(messages.createdAt, from))),
      ),
      aiRepliesThisMonth: await one(
        tx
          .select({ n: count() })
          .from(messages)
          .where(and(eq(messages.kind, "ai_reply"), gte(messages.createdAt, from))),
      ),
      aiScribeThisMonth: await one(
        tx
          .select({ n: count() })
          .from(auditLogs)
          .where(and(eq(auditLogs.action, "note.ai_draft"), gte(auditLogs.createdAt, from))),
      ),
      files: await one(tx.select({ n: count() }).from(files)),
      lastSignInAt: lastLogin?.at ?? null,
      limits: effectiveLimits(tenant),
    };
  });
}

/** Every clinic on the platform, oldest first, with its setup checklist and usage. */
export async function platformOverview(now: Date = new Date()): Promise<ClinicOverview[]> {
  const rows = await getDb().select().from(tenants).orderBy(asc(tenants.createdAt));
  const out: ClinicOverview[] = [];
  for (const tenant of rows) {
    out.push({
      tenant,
      setup: await setupOf(tenant),
      usage: await usageOf(tenant, now),
      statements: await statementsOf(tenant.id),
    });
  }
  return out;
}

/** For the clinic admin's screens: limits at 80 % or more this month (empty when none). */
export async function limitWarnings(tenant: Tenant, now: Date = new Date()) {
  const limits = effectiveLimits(tenant);
  if (limits.aiMonthly === null && limits.whatsappMonthly === null) return [];
  return withTenant(tenant.id, async (tx) => {
    const out: { kind: "ai" | "whatsapp"; used: number; limit: number }[] = [];
    if (limits.aiMonthly !== null) {
      const used = await aiUsedThisMonth(tx, now);
      if (used >= limits.aiMonthly * WARN_AT)
        out.push({ kind: "ai", used, limit: limits.aiMonthly });
    }
    if (limits.whatsappMonthly !== null) {
      const used = await whatsappSentThisMonth(tx, now);
      if (used >= limits.whatsappMonthly * WARN_AT)
        out.push({ kind: "whatsapp", used, limit: limits.whatsappMonthly });
    }
    return out;
  });
}
