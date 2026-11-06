/**
 * Monthly usage and limits for one clinic (Riyadh calendar month). Counted from what the app
 * already records — no extra tracking, and never any message or note text:
 *   AI       = AI receptionist replies (messages.kind "ai_reply") + AI scribe drafts (audit "note.ai_draft")
 *   WhatsApp = messages sent to patients (messages.direction "out")
 * Limits are set by the platform owner (tenants.limits). Essential messages (sign-in codes, replies
 * to a patient's tap) are never blocked by a limit; reminders and other extras are.
 */
import { and, count, eq, gte } from "drizzle-orm";
import { auditLogs, messages, type ClinicLimits } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { atRiyadh, riyadhDay } from "@/lib/booking/time";
import { planOf, type PlanTier } from "./plans";

/** At this share of a limit, the owner and the clinic admin are warned. */
export const WARN_AT = 0.8;

export function monthStart(now: Date = new Date()) {
  return atRiyadh(`${riyadhDay(now).slice(0, 8)}01`, "00:00");
}

/**
 * The clinic's limits: its own (set by the platform owner) where given, else its plan's defaults.
 * null = no limit.
 */
export function effectiveLimits(t: { limits?: ClinicLimits | null; plan?: PlanTier | null }) {
  const own = (v: number | null | undefined) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined;
  const plan = t.plan === undefined ? null : planOf(t).limits;
  return {
    aiMonthly: own(t.limits?.aiMonthly) ?? plan?.aiMonthly ?? null,
    whatsappMonthly: own(t.limits?.whatsappMonthly) ?? plan?.whatsappMonthly ?? null,
  };
}

export async function aiUsedThisMonth(tx: TenantTx, now: Date = new Date()) {
  const from = monthStart(now);
  const [a] = await tx
    .select({ n: count() })
    .from(messages)
    .where(and(eq(messages.kind, "ai_reply"), gte(messages.createdAt, from)));
  const [b] = await tx
    .select({ n: count() })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, "note.ai_draft"), gte(auditLogs.createdAt, from)));
  return Number(a?.n ?? 0) + Number(b?.n ?? 0);
}

export async function whatsappSentThisMonth(tx: TenantTx, now: Date = new Date()) {
  const [r] = await tx
    .select({ n: count() })
    .from(messages)
    .where(and(eq(messages.direction, "out"), gte(messages.createdAt, monthStart(now))));
  return Number(r?.n ?? 0);
}

/** 0..1+ share of a limit (null = no limit). */
export const share = (used: number, limit: number | null) =>
  limit === null ? null : limit === 0 ? 1 : used / limit;
