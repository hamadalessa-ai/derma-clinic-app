"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuth } from "@/lib/auth/auth";
import { canSignInToClinic } from "@/lib/auth/access";
import { auditEvent } from "@/lib/audit";
import { takeGlobalLimit } from "@/lib/security/global-limit";
import { getCurrentTenant } from "@/lib/tenant/current";

const credentials = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1).max(200),
});

export type SignInResult =
  | { ok: false; error: "invalid" | "locked" | "code_invalid" }
  | { ok: false; step: "code" };

/**
 * Sign-in limits, counted across ALL clinics and server instances (in the database):
 * per email (a person's account) and per network address. After that: wait 15 minutes.
 */
const LOGIN_LIMITS = { perEmail: 10, perIp: 40, windowMinutes: 15 };
/** Demo clinics are shown and tested a lot with the same few accounts: more room, same protection. */
const DEMO_PER_EMAIL = 40;

function clientIp(h: Headers) {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

export async function signIn(input: z.input<typeof credentials>): Promise<SignInResult> {
  const parsed = credentials.safeParse(input);
  const tenant = await getCurrentTenant();
  if (!parsed.success || !tenant) return { ok: false, error: "invalid" };
  const { email, password } = parsed.data;
  const h = await headers();
  const ip = clientIp(h);

  const allowed = await takeGlobalLimit([
    {
      key: `login:email:${email}`,
      limit: tenant.isDemo ? DEMO_PER_EMAIL : LOGIN_LIMITS.perEmail,
      windowMinutes: LOGIN_LIMITS.windowMinutes,
    },
    ...(ip
      ? [{ key: `login:ip:${ip}`, limit: LOGIN_LIMITS.perIp, windowMinutes: LOGIN_LIMITS.windowMinutes }]
      : []),
  ]);
  if (!allowed) {
    await auditEvent(tenant.id, {
      actorUserId: null,
      action: "auth.login_blocked",
      entityType: "user",
      metadata: { email, reason: "too_many_attempts" },
      ipAddress: ip,
    });
    return { ok: false, error: "locked" };
  }

  // Only members of THIS clinic (or the platform owner) may sign in here.
  // The error message is the same either way, so it doesn't reveal who works where.
  if (!(await canSignInToClinic(tenant.id, email))) {
    await auditEvent(tenant.id, {
      actorUserId: null,
      action: "auth.login_failed",
      entityType: "user",
      metadata: { email, reason: "not_member" },
      ipAddress: ip,
    });
    return { ok: false, error: "invalid" };
  }

  let userId: string;
  try {
    const res = (await getAuth().api.signInEmail({ body: { email, password }, headers: h })) as {
      user?: { id: string };
      twoFactorRedirect?: boolean;
    };
    // Two-step verification is on: the password was right, now the authenticator code.
    if (res.twoFactorRedirect) return { ok: false, step: "code" };
    if (!res.user) throw new Error("no user");
    userId = res.user.id;
  } catch {
    await auditEvent(tenant.id, {
      actorUserId: null,
      action: "auth.login_failed",
      entityType: "user",
      metadata: { email, reason: "bad_password" },
      ipAddress: ip,
    });
    return { ok: false, error: "invalid" };
  }

  await auditEvent(tenant.id, {
    actorUserId: userId,
    action: "auth.login",
    entityType: "user",
    entityId: userId,
    ipAddress: ip,
  });
  redirect("/home");
}

const secondStep = z.object({
  code: z
    .string()
    .trim()
    .min(6)
    .max(40)
    .transform((c) => c.replace(/\s/g, "")),
  remember: z.boolean().default(false),
});

/** Second step: the 6-digit code from the authenticator app, or one of the backup codes. */
export async function verifySignInCode(input: z.input<typeof secondStep>): Promise<SignInResult> {
  const parsed = secondStep.safeParse(input);
  const tenant = await getCurrentTenant();
  if (!parsed.success || !tenant) return { ok: false, error: "code_invalid" };
  const h = await headers();
  const ip = clientIp(h);
  if (
    ip &&
    !(await takeGlobalLimit([
      { key: `login:ip:${ip}`, limit: LOGIN_LIMITS.perIp, windowMinutes: LOGIN_LIMITS.windowMinutes },
    ]))
  ) {
    return { ok: false, error: "locked" };
  }
  const { code, remember } = parsed.data;
  let userId: string;
  try {
    const body = { code, trustDevice: remember };
    const res = (
      /^\d{6}$/.test(code)
        ? await getAuth().api.verifyTOTP({ body, headers: h })
        : await getAuth().api.verifyBackupCode({ body, headers: h })
    ) as { user: { id: string } };
    userId = res.user.id;
  } catch {
    await auditEvent(tenant.id, {
      actorUserId: null,
      action: "auth.login_failed",
      entityType: "user",
      metadata: { reason: "bad_code" },
      ipAddress: ip,
    });
    return { ok: false, error: "code_invalid" };
  }
  await auditEvent(tenant.id, {
    actorUserId: userId,
    action: "auth.login",
    entityType: "user",
    entityId: userId,
    metadata: { twoFactor: /^\d{6}$/.test(code) ? "app" : "backup_code" },
    ipAddress: ip,
  });
  redirect("/home");
}

export async function signOut() {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/login");
}
