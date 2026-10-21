import "server-only";
import { BookingError } from "@/lib/booking/engine";
import { ConsentError } from "@/lib/consents/consents";
import { NoteError } from "@/lib/notes/notes";
import { PackageError } from "@/lib/packages/packages";
import { can, PermissionError, type Permission } from "@/lib/auth/permissions";
import { actorOf, getStaffContext, type StaffContext } from "@/lib/auth/session";
import type { Actor } from "@/lib/auth/db";

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
