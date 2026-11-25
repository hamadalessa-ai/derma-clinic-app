/**
 * Reply-button payloads. When the patient taps a button, WhatsApp sends us back the button's id.
 * The id is SIGNED (HMAC with the server secret, bound to the clinic), so a forged or edited
 * payload can't confirm/cancel/move anything. The handler also checks that the appointment
 * belongs to the patient (or their family) who owns the phone number.
 *   format: v1.<action>.<appointmentId or ->.<extra or ->.<signature>
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ButtonAction } from "./catalog";

type Env = Record<string, string | undefined>;

function secret(env: Env) {
  const s = env.VERIFICATION_SECRET || env.BETTER_AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("VERIFICATION_SECRET / BETTER_AUTH_SECRET is not set");
  return s;
}

function sign(tenantId: string, parts: string[], env: Env) {
  return createHmac("sha256", secret(env))
    .update(`wa-button:${tenantId}:${parts.join(":")}`)
    .digest("base64url")
    .slice(0, 22);
}

export function buttonPayload(
  tenantId: string,
  action: ButtonAction,
  appointmentId: string | null,
  extra: string | null = null,
  env: Env = process.env,
) {
  const parts = [action, appointmentId ?? "-", extra ?? "-"];
  return `v1.${parts.join(".")}.${sign(tenantId, parts, env)}`;
}

export interface ParsedButton {
  action: ButtonAction;
  appointmentId: string | null;
  extra: string | null;
}

const ACTIONS: readonly string[] = [
  "confirm",
  "reschedule",
  "cancel",
  "all_good",
  "concern",
  "arrived",
  "slot",
  "my_page",
];

/** The button's meaning, or null when the payload is unknown or the signature is wrong. */
export function parseButtonPayload(
  tenantId: string,
  payload: string,
  env: Env = process.env,
): ParsedButton | null {
  const m = /^v1\.([a-z_]+)\.([0-9a-f-]{36}|-)\.([A-Za-z0-9_-]{1,60}|-)\.([A-Za-z0-9_-]{22})$/.exec(
    payload.trim(),
  );
  if (!m || !ACTIONS.includes(m[1])) return null;
  const expected = sign(tenantId, [m[1], m[2], m[3]], env);
  const a = Buffer.from(expected);
  const b = Buffer.from(m[4]);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return {
    action: m[1] as ButtonAction,
    appointmentId: m[2] === "-" ? null : m[2],
    extra: m[3] === "-" ? null : m[3],
  };
}
