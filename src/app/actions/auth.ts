"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuth } from "@/lib/auth/auth";
import { canSignInToClinic } from "@/lib/auth/access";
import { auditEvent } from "@/lib/audit";
import { getCurrentTenant } from "@/lib/tenant/current";

const credentials = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1).max(200),
});

export type SignInResult = { ok: false; error: "invalid" };

export async function signIn(input: z.input<typeof credentials>): Promise<SignInResult> {
  const parsed = credentials.safeParse(input);
  const tenant = await getCurrentTenant();
  if (!parsed.success || !tenant) return { ok: false, error: "invalid" };
  const { email, password } = parsed.data;
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

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
    const res = await getAuth().api.signInEmail({ body: { email, password }, headers: h });
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
  redirect("/");
}

export async function signOut() {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/login");
}
