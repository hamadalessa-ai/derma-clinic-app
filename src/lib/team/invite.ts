/**
 * Invitation links for new staff: /invite/<userId>.<expiry>.<signature>. Signed with the server
 * secret and bound to one clinic, valid for 7 days. The person opens it and sets their own
 * password; nobody else ever types or sees it.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

type Env = Record<string, string | undefined>;
export const INVITE_DAYS = 7;

function secret(env: Env) {
  const s = env.VERIFICATION_SECRET || env.BETTER_AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("VERIFICATION_SECRET / BETTER_AUTH_SECRET is not set");
  return s;
}

const sign = (tenantId: string, userId: string, exp: number, env: Env) =>
  createHmac("sha256", secret(env))
    .update(`staff-invite:${tenantId}:${userId}:${exp}`)
    .digest("base64url")
    .slice(0, 27);

export function inviteToken(
  tenantId: string,
  userId: string,
  now = new Date(),
  env: Env = process.env,
) {
  const exp = Math.floor(now.getTime() / 1000) + INVITE_DAYS * 24 * 3600;
  return `${userId}.${exp}.${sign(tenantId, userId, exp, env)}`;
}

/** The invited user's id, or null when the link is malformed, edited or expired. */
export function parseInviteToken(
  tenantId: string,
  token: string,
  now = new Date(),
  env: Env = process.env,
): string | null {
  const m = /^([A-Za-z0-9_-]{4,80})\.(\d{9,11})\.([A-Za-z0-9_-]{27})$/.exec(token.trim());
  if (!m) return null;
  const exp = Number(m[2]);
  if (exp * 1000 < now.getTime()) return null;
  const expected = Buffer.from(sign(tenantId, m[1], exp, env));
  const given = Buffer.from(m[3]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return m[1];
}
