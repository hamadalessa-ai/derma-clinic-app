import "server-only";
import { BookingError } from "@/lib/booking/engine";
import { ConsentError } from "@/lib/consents/consents";
import { NoteError } from "@/lib/notes/notes";
import { PackageError } from "@/lib/packages/packages";
import { can, PermissionError, type Permission } from "@/lib/auth/permissions";
import { actorOf, getStaffContext, type StaffContext } from "@/lib/auth/session";
import type { Actor } from "@/lib/auth/db";
import { getCurrentTenant, type Tenant } from "@/lib/tenant/current";
import { VerifyError } from "@/lib/verify/codes";
import { TemplateError } from "@/lib/whatsapp/admin";
import { WhatsAppError } from "@/lib/whatsapp/staff";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Every screen action goes through here: signed in? allowed? Then run, and turn known
 * problems (slot taken, outside hours, …) into an error code the screen translates.
 */
export async function staffAction<T>(
  permission: Permission | Permission[] | null,
  fn: (ctx: StaffContext, actor: Actor) => Promise<T>,
): Promise<ActionResult<T>> {
  const ctx = await getStaffContext();
  if (!ctx) return { ok: false, error: "not_signed_in" };
  const needed = permission === null ? [] : Array.isArray(permission) ? permission : [permission];
  if (needed.length && !needed.some((p) => can(ctx.roles, p)))
    return { ok: false, error: "not_allowed" };
  try {
    return { ok: true, data: await fn(ctx, actorOf(ctx)) };
  } catch (err) {
    if (
      err instanceof BookingError ||
      err instanceof PackageError ||
      err instanceof ConsentError ||
      err instanceof NoteError
    ) {
      return { ok: false, error: err.code };
    }
    if (err instanceof WhatsAppError || err instanceof TemplateError) {
      return { ok: false, error: err.code };
    }
    if (err instanceof PermissionError) return { ok: false, error: "not_allowed" };
    if (err instanceof ValidationError) return { ok: false, error: "invalid" };
    console.error("action failed", err);
    return { ok: false, error: "unexpected" };
  }
}

export class ValidationError extends Error {}

/** Parses input with a zod-like schema, or throws ValidationError. */
export function parse<T>(
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
  value: unknown,
): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new ValidationError("invalid input");
  return r.data;
}

/**
 * Actions on the PUBLIC pages (online booking /book, patient page /my): no staff login.
 * The clinic comes from the address; known problems become error codes the page translates.
 * What the visitor may do is decided inside each action (verified code, patient session).
 */
export async function publicAction<T>(
  fn: (tenant: Tenant) => Promise<T>,
): Promise<ActionResult<T>> {
  const tenant = await getCurrentTenant();
  if (!tenant) return { ok: false, error: "not_found" };
  try {
    return { ok: true, data: await fn(tenant) };
  } catch (err) {
    if (err instanceof BookingError || err instanceof VerifyError || err instanceof ConsentError) {
      return { ok: false, error: err.code };
    }
    if (err instanceof PublicError) return { ok: false, error: err.code };
    if (err instanceof ValidationError) return { ok: false, error: "invalid" };
    console.error("public action failed", err);
    return { ok: false, error: "unexpected" };
  }
}

/** A refusal on a public page with a translated message (e.g. "patient_signed_out"). */
export class PublicError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = "PublicError";
  }
}
