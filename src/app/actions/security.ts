"use server";

import { headers } from "next/headers";
import QRCode from "qrcode";
import { z } from "zod";
import { getAuth } from "@/lib/auth/auth";
import { getStaffContext } from "@/lib/auth/session";
import { auditEvent } from "@/lib/audit";

/**
 * My account → two-step verification (authenticator app). Works even while it is still required
 * and not yet set up (staffAction would refuse then). Each step needs the person's own session;
 * turning it on or off also needs their password.
 */
type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const passwordInput = z.object({ password: z.string().min(1).max(200) });

export async function startTwoFactorSetupAction(
  input: z.input<typeof passwordInput>,
): Promise<Result<{ qr: string; key: string; backupCodes: string[] }>> {
  const ctx = await getStaffContext();
  const parsed = passwordInput.safeParse(input);
  if (!ctx || !parsed.success) return { ok: false, error: "not_signed_in" };
  if (ctx.twoFactorEnabled) return { ok: false, error: "two_factor_already_on" };
  try {
    const res = await getAuth().api.enableTwoFactor({
      body: { password: parsed.data.password },
      headers: await headers(),
    });
    const { totpURI, backupCodes } = res as { totpURI: string; backupCodes: string[] };
    const key = new URL(totpURI).searchParams.get("secret") ?? "";
    // The QR code is drawn here on our server: the secret never goes to an outside service.
    const qr = await QRCode.toDataURL(totpURI, { width: 360, margin: 2 });
    return { ok: true, data: { qr, key, backupCodes } };
  } catch {
    return { ok: false, error: "wrong_password" };
  }
}

const codeInput = z.object({ code: z.string().trim().regex(/^\d{6}$/) });

export async function confirmTwoFactorAction(input: z.input<typeof codeInput>): Promise<Result<null>> {
  const ctx = await getStaffContext();
  const parsed = codeInput.safeParse(input);
  if (!ctx) return { ok: false, error: "not_signed_in" };
  if (!parsed.success) return { ok: false, error: "code_invalid" };
  try {
    await getAuth().api.verifyTOTP({ body: { code: parsed.data.code }, headers: await headers() });
  } catch {
    return { ok: false, error: "code_invalid" };
  }
  await auditEvent(ctx.tenant.id, {
    actorUserId: ctx.user.id,
    action: "auth.two_factor_on",
    entityType: "user",
    entityId: ctx.user.id,
  });
  return { ok: true, data: null };
}

export async function disableTwoFactorAction(input: z.input<typeof passwordInput>): Promise<Result<null>> {
  const ctx = await getStaffContext();
  const parsed = passwordInput.safeParse(input);
  if (!ctx || !parsed.success) return { ok: false, error: "not_signed_in" };
  // Required for this person: it can't be switched off (only replaced by setting it up again).
  if (ctx.twoFactorRequired) return { ok: false, error: "two_factor_required" };
  try {
    await getAuth().api.disableTwoFactor({
      body: { password: parsed.data.password },
      headers: await headers(),
    });
  } catch {
    return { ok: false, error: "wrong_password" };
  }
  await auditEvent(ctx.tenant.id, {
    actorUserId: ctx.user.id,
    action: "auth.two_factor_off",
    entityType: "user",
    entityId: ctx.user.id,
  });
  return { ok: true, data: null };
}
