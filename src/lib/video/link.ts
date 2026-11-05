/**
 * The patient's join link for a video consultation: /visit/<appointmentId>.<signature>.
 * The signature (HMAC with the server secret, bound to the clinic) means a link can't be guessed
 * or edited to reach another appointment. The link is sent only to the patient's own WhatsApp.
 * The video room's name is derived the same way, so it never reveals who the patient is.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

type Env = Record<string, string | undefined>;

function secret(env: Env) {
  const s = env.VERIFICATION_SECRET || env.BETTER_AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("VERIFICATION_SECRET / BETTER_AUTH_SECRET is not set");
  return s;
}

const mac = (purpose: string, tenantId: string, appointmentId: string, env: Env) =>
  createHmac("sha256", secret(env)).update(`${purpose}:${tenantId}:${appointmentId}`);

/** The token in the link: "<appointmentId>.<signature>". */
export function videoToken(tenantId: string, appointmentId: string, env: Env = process.env) {
  const sig = mac("video-link", tenantId, appointmentId, env).digest("base64url").slice(0, 22);
  return `${appointmentId}.${sig}`;
}

export function videoJoinUrl(
  baseUrl: string,
  tenantId: string,
  appointmentId: string,
  env: Env = process.env,
) {
  return `${baseUrl}/visit/${videoToken(tenantId, appointmentId, env)}`;
}

/** The appointment a token is for, or null when it is malformed or the signature is wrong. */
export function parseVideoToken(
  tenantId: string,
  token: string,
  env: Env = process.env,
): string | null {
  const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{22})$/.exec(token.trim());
  if (!m) return null;
  const expected = Buffer.from(videoToken(tenantId, m[1], env).split(".")[1]);
  const given = Buffer.from(m[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return m[1];
}

/** The video room's name at the provider: unguessable, no patient details. */
export function videoRoomName(tenantId: string, appointmentId: string, env: Env = process.env) {
  return `vc-${mac("video-room", tenantId, appointmentId, env).digest("hex").slice(0, 24)}`;
}

// ─── Consent links: /sign/<appointmentId>.<signature> ───────────────────────
// Opens the ONE consent this visit needs, ready to sign: no code, no patient page sign-in.

export function consentToken(tenantId: string, appointmentId: string, env: Env = process.env) {
  const sig = mac("consent-link", tenantId, appointmentId, env).digest("base64url").slice(0, 22);
  return `${appointmentId}.${sig}`;
}

export function consentSignUrl(
  baseUrl: string,
  tenantId: string,
  appointmentId: string,
  env: Env = process.env,
) {
  return `${baseUrl}/sign/${consentToken(tenantId, appointmentId, env)}`;
}

export function parseConsentToken(
  tenantId: string,
  token: string,
  env: Env = process.env,
): string | null {
  const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{22})$/.exec(token.trim());
  if (!m) return null;
  const expected = Buffer.from(consentToken(tenantId, m[1], env).split(".")[1]);
  const given = Buffer.from(m[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return m[1];
}
