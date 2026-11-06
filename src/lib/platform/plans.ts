/**
 * Subscription plans: which features a clinic gets and its default monthly limits. The price is
 * set per clinic by the platform owner (tenants.monthly_price_halalas). A clinic's own limits
 * (tenants.limits, set by the owner) override the plan's defaults.
 */
import type { ClinicLimits } from "@/db/schema";

export const PLAN_TIERS = ["basic", "pro", "enterprise"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const FEATURES = ["aiReceptionist", "aiScribe", "video"] as const;
export type Feature = (typeof FEATURES)[number];

export interface Plan {
  features: Record<Feature, boolean>;
  /** Default monthly limits (null = no limit). */
  limits: { aiMonthly: number | null; whatsappMonthly: number | null };
}

export const PLANS: Record<PlanTier, Plan> = {
  basic: {
    features: { aiReceptionist: false, aiScribe: false, video: false },
    limits: { aiMonthly: 0, whatsappMonthly: 1500 },
  },
  pro: {
    features: { aiReceptionist: true, aiScribe: true, video: true },
    limits: { aiMonthly: 3000, whatsappMonthly: 6000 },
  },
  enterprise: {
    features: { aiReceptionist: true, aiScribe: true, video: true },
    limits: { aiMonthly: null, whatsappMonthly: null },
  },
};

type WithPlan = { plan?: PlanTier | null };

export const planOf = (t: WithPlan): Plan => PLANS[t.plan ?? "pro"] ?? PLANS.pro;

/** Is this feature part of the clinic's plan? */
export const planAllows = (t: WithPlan, feature: Feature) => planOf(t).features[feature];

/** VAT in Saudi Arabia: 15 %. */
export const VAT_RATE = 0.15;
export const vatOf = (halalas: number) => Math.round(halalas * VAT_RATE);

export type { ClinicLimits };
