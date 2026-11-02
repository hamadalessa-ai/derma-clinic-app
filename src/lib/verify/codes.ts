/**
 * One-time verification codes sent to a patient's mobile (online booking, patient page sign-in).
 *  - 6 digits, valid 10 minutes, at most 5 tries; only an HMAC of the code is stored.
 *  - Asking for a new code cancels the previous one.
 *  - Rate limits: 3 codes per phone per 15 minutes, 8 per day; 20 per IP per hour.
 *  - DEMO safety (see messaging/sender.ts): the code is returned for showing on screen only by the
 *    demo sender, which exists only for demo clinics with MESSAGE_DEMO_MODE=on. Otherwise, with no
 *    real sender configured, sending fails with "messaging_unavailable" and no code is created.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { verificationCodes } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { getMessageSender, MessagingUnavailableError } from "@/lib/messaging/sender";
import { takeRateLimit, type Limit } from "./rate-limit";

export const CODE_RULES = {
  digits: 6,
  ttlMinutes: 10,
  maxAttempts: 5,
  perPhone15Min: 3,
  perPhoneDay: 8,
  perIpHour: 20,
} as const;

export type CodePurpose = "booking" | "portal";

export type VerifyErrorCode =
  | "rate_limited"
  | "messaging_unavailable"
  | "code_expired" // no valid code (expired, used, or never sent)
  | "wrong_code"
  | "too_many_attempts";

export class VerifyError extends Error {
  constructor(public code: VerifyErrorCode) {
    super(code);
    this.name = "VerifyError";
  }
}

type Env = Record<string, string | undefined>;

function secret(env: Env): string {
  const s = env.VERIFICATION_SECRET || env.BETTER_AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("VERIFICATION_SECRET / BETTER_AUTH_SECRET is not set");
  return s;
}

/** HMAC of the code, bound to clinic + phone + purpose, so a stored hash is useless elsewhere. */
export function hashCode(
  tenantId: string,
  phone: string,
  purpose: CodePurpose,
  code: string,
  env: Env = process.env,
): string {
  return createHmac("sha256", secret(env))
    .update(`${tenantId}:${phone}:${purpose}:${code}`)
    .digest("hex");
}

const BODIES: Record<CodePurpose, string> = {
  booking: "رمز تأكيد الحجز: {code} (صالح 10 دقائق). Booking code: {code}",
  portal: "رمز الدخول لصفحة المريض: {code} (صالح 10 دقائق). Patient page code: {code}",
};

/**
 * Creates and sends a code. Returns the code itself ONLY in demo mode (to show on screen),
 * otherwise null. Throws VerifyError("rate_limited" | "messaging_unavailable").
 */
export async function sendCode(
  tx: TenantTx,
  input: {
    tenant: { id: string; isDemo: boolean; slug?: string };
    phone: string; // normalized 05XXXXXXXX
    purpose: CodePurpose;
    ip: string | null;
    env?: Env;
  },
): Promise<{ demoCode: string | null }> {
  const env = input.env ?? process.env;
  const sender = getMessageSender(input.tenant, env);
  if (!sender) throw new VerifyError("messaging_unavailable");

  const limits: Limit[] = [
    { bucket: `otp:phone:${input.phone}`, limit: CODE_RULES.perPhone15Min, windowMinutes: 15 },
    { bucket: `otp:phone:${input.phone}`, limit: CODE_RULES.perPhoneDay, windowMinutes: 24 * 60 },
  ];
  if (input.ip) {
    limits.push({ bucket: `otp:ip:${input.ip}`, limit: CODE_RULES.perIpHour, windowMinutes: 60 });
  }
  if (!(await takeRateLimit(tx, limits))) throw new VerifyError("rate_limited");

  // Only the newest code works.
  await tx
    .update(verificationCodes)
    .set({ consumedAt: sql`now()` })
    .where(
      and(
        eq(verificationCodes.phone, input.phone),
        eq(verificationCodes.purpose, input.purpose),
        isNull(verificationCodes.consumedAt),
      ),
    );

  const code = String(randomInt(0, 10 ** CODE_RULES.digits)).padStart(CODE_RULES.digits, "0");
  await tx.insert(verificationCodes).values({
    tenantId: input.tenant.id,
    phone: input.phone,
    purpose: input.purpose,
    codeHash: hashCode(input.tenant.id, input.phone, input.purpose, code, env),
    expiresAt: sql`now() + make_interval(mins => ${CODE_RULES.ttlMinutes})`,
    ip: input.ip,
  });
  try {
    await sender.send(tx, {
      to: input.phone,
      template: `${input.purpose}_code`,
      body: BODIES[input.purpose],
      secrets: { code },
    });
  } catch (err) {
    // WhatsApp refused it (e.g. Meta error 131031): no code is kept, the patient sees a clear message.
    if (err instanceof MessagingUnavailableError) throw new VerifyError("messaging_unavailable");
    throw err;
  }
  return { demoCode: sender.showsOnScreen ? code : null };
}

/**
 * Checks a code. Every try counts (also wrong ones), so the caller must COMMIT the transaction
 * even when the result is not ok — which is why this returns a result instead of throwing.
 */
export async function checkCode(
  tx: TenantTx,
  input: {
    tenantId: string;
    phone: string;
    purpose: CodePurpose;
    code: string;
    env?: Env;
  },
): Promise<{ ok: true } | { ok: false; error: VerifyErrorCode }> {
  const [row] = await tx
    .select()
    .from(verificationCodes)
    .where(
      and(
        eq(verificationCodes.phone, input.phone),
        eq(verificationCodes.purpose, input.purpose),
        isNull(verificationCodes.consumedAt),
        gt(verificationCodes.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(verificationCodes.createdAt))
    .limit(1)
    .for("update");
  if (!row) return { ok: false, error: "code_expired" };
  if (row.attempts >= CODE_RULES.maxAttempts) return { ok: false, error: "too_many_attempts" };

  const given = /^\d{6}$/.test(input.code.trim())
    ? hashCode(input.tenantId, input.phone, input.purpose, input.code.trim(), input.env)
    : "";
  const matches =
    given.length === row.codeHash.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(row.codeHash));
  await tx
    .update(verificationCodes)
    .set({
      attempts: sql`${verificationCodes.attempts} + 1`,
      ...(matches ? { consumedAt: sql`now()` } : {}),
    })
    .where(eq(verificationCodes.id, row.id));
  if (matches) return { ok: true };
  return {
    ok: false,
    error: row.attempts + 1 >= CODE_RULES.maxAttempts ? "too_many_attempts" : "wrong_code",
  };
}
