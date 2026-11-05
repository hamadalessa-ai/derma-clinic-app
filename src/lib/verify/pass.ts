/**
 * "This mobile is verified" for online booking: after the patient enters the code (step 1 of
 * booking), a signed, short-lived pass is kept in an httpOnly cookie, so they can choose the
 * service and time without a second code. Bound to the clinic and the number; 30 minutes.
 *   format: <phone>.<expires unix seconds>.<signature>
 */
import { createHmac, timingSafeEqual } from "node:crypto";

type Env = Record<string, string | undefined>;

export const BOOKING_PASS_COOKIE = "booking_pass";
export const BOOKING_PASS_MINUTES = 30;

function secret(env: Env) {
  const s = env.VERIFICATION_SECRET || env.BETTER_AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("VERIFICATION_SECRET / BETTER_AUTH_SECRET is not set");
  return s;
}

const sign = (tenantId: string, phone: string, exp: number, env: Env) =>
  createHmac("sha256", secret(env))
    .update(`booking-pass:${tenantId}:${phone}:${exp}`)
    .digest("base64url")
    .slice(0, 32);

export function phonePass(
  tenantId: string,
  phone: string,
  now = new Date(),
  env: Env = process.env,
) {
  const exp = Math.floor(now.getTime() / 1000) + BOOKING_PASS_MINUTES * 60;
  return `${phone}.${exp}.${sign(tenantId, phone, exp, env)}`;
}

/** The verified mobile in a pass, or null (missing, edited, other clinic, expired). */
export function checkPhonePass(
  tenantId: string,
  token: string | null | undefined,
  now = new Date(),
  env: Env = process.env,
): string | null {
  const m = /^(\+?\d{8,15})\.(\d{9,11})\.([A-Za-z0-9_-]{32})$/.exec(token ?? "");
  if (!m) return null;
  const exp = Number(m[2]);
  if (exp * 1000 < now.getTime()) return null;
  const a = Buffer.from(sign(tenantId, m[1], exp, env));
  const b = Buffer.from(m[3]);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return m[1];
}
