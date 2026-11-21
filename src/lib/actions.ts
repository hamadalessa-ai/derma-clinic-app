import "server-only";
import { BookingError } from "@/lib/booking/engine";
import { ConsentError } from "@/lib/consents/consents";
import { NoteError } from "@/lib/notes/notes";
import { ScribeError } from "@/lib/ai/scribe";
import { VideoVisitError } from "@/lib/video/visit";
import { VisitError } from "@/lib/visits/visit";
import { DentalError } from "@/lib/dental/chart";
import { HoursError } from "@/lib/booking/working-hours";
import { MembershipError } from "@/lib/memberships/memberships";
import { PackageError } from "@/lib/packages/packages";
import { can, PermissionError, type Permission } from "@/lib/auth/permissions";
import { actorOf, getStaffContext, type StaffContext } from "@/lib/auth/session";
import type { Actor } from "@/lib/auth/db";
import { getCurrentTenant, type Tenant } from "@/lib/tenant/current";
import { VerifyError } from "@/lib/verify/codes";
import { TemplateError } from "@/lib/whatsapp/admin";
import { WhatsAppError } from "@/lib/whatsapp/staff";
import { ConcernError } from "@/lib/whatsapp/concern-actions";
import { TeamError } from "@/lib/team/team";
import { auditEvent } from "@/lib/audit";
import { ClinicError } from "@/lib/platform/clinics";
import { BillingError } from "@/lib/platform/billing";
import { SupportError } from "@/lib/support/grants";
import { SetupError } from "@/lib/setup/admin";
import { WhatsAppConnectError } from "@/lib/platform/whatsapp";
import { CareTeamError } from "@/lib/care-team/care-team";
import { clinicIsActive, publicPagesOpen } from "@/lib/tenant/status";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Every screen action goes through here: signed in? allowed? Then run, and turn known
 * problems (slot taken, outside hours, …) into an error code the screen translates.
 */
/** Options for actions that only LOOK (search, free times…) or touch one's own account. */
export interface ActionOptions {
  /** Still allowed while the clinic is read-only or closed (see src/lib/tenant/status.ts). */
  whenPaused?: boolean;
}
export const PAUSED_OK: ActionOptions = { whenPaused: true };

export async function staffAction<T>(
  permission: Permission | Permission[] | null,
  fn: (ctx: StaffContext, actor: Actor) => Promise<T>,
  options: ActionOptions = {},
): Promise<ActionResult<T>> {
  const ctx = await getStaffContext();
  if (!ctx) return { ok: false, error: "not_signed_in" };
  // Admins and doctors of real clinics must set up two-step verification before doing anything.
  if (ctx.twoFactorRequired && !ctx.twoFactorEnabled)
    return { ok: false, error: "two_factor_required" };
  const needed = permission === null ? [] : Array.isArray(permission) ? permission : [permission];
  if (needed.length && !needed.some((p) => can(ctx.roles, p)))
    return { ok: false, error: "not_allowed" };
  // A paused clinic (read-only / closed) can't change anything; the platform's own work goes on.
  const platformWork = needed.length > 0 && needed.every((p) => p.startsWith("platform:"));
  if (!platformWork && !options.whenPaused && !clinicIsActive(ctx.tenant))
    return { ok: false, error: "clinic_paused" };
  // Support access: view only unless the clinic allowed changes; every change is recorded.
  if (ctx.support && !platformWork && !options.whenPaused) {
    if (!ctx.support.allowChanges) return { ok: false, error: "support_view_only" };
    await auditEvent(ctx.tenant.id, {
      actorUserId: ctx.user.id,
      action: "support.change",
      entityType: "action",
      entityId: needed.join(",") || null,
      metadata: { permissions: needed },
    });
  }
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
    if (
      err instanceof WhatsAppError ||
      err instanceof TemplateError ||
      err instanceof ConcernError
    ) {
      return { ok: false, error: err.code };
    }
    if (err instanceof ScribeError) return { ok: false, error: `scribe_${err.code}` };
    if (err instanceof VideoVisitError) return { ok: false, error: `video_${err.code}` };
    if (err instanceof VisitError) return { ok: false, error: `visit_${err.code}` };
    if (err instanceof DentalError) return { ok: false, error: `dental_${err.code}` };
    if (err instanceof MembershipError) return { ok: false, error: `membership_${err.code}` };
    if (err instanceof HoursError) return { ok: false, error: `hours_${err.code}` };
    if (err instanceof TeamError) return { ok: false, error: `team_${err.code}` };
    if (err instanceof ClinicError) return { ok: false, error: `clinic_${err.code}` };
    if (err instanceof BillingError) return { ok: false, error: `billing_${err.code}` };
    if (err instanceof SupportError) return { ok: false, error: `support_${err.code}` };
    if (err instanceof SetupError) return { ok: false, error: `setup_${err.code}` };
    if (err instanceof WhatsAppConnectError) return { ok: false, error: `wa_connect_${err.code}` };
    if (err instanceof CareTeamError) return { ok: false, error: `care_team_${err.code}` };
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
  options: ActionOptions = {},
): Promise<ActionResult<T>> {
  const tenant = await getCurrentTenant();
  if (!tenant) return { ok: false, error: "not_found" };
  if (!publicPagesOpen(tenant)) return { ok: false, error: "clinic_unavailable" };
  if (!options.whenPaused && !clinicIsActive(tenant)) return { ok: false, error: "clinic_paused" };
  try {
    return { ok: true, data: await fn(tenant) };
  } catch (err) {
    if (err instanceof BookingError || err instanceof VerifyError || err instanceof ConsentError) {
      return { ok: false, error: err.code };
    }
    if (err instanceof PublicError) return { ok: false, error: err.code };
    if (err instanceof TeamError) return { ok: false, error: `team_${err.code}` };
    if (err instanceof VideoVisitError) return { ok: false, error: `video_${err.code}` };
    if (err instanceof VisitError) return { ok: false, error: `visit_${err.code}` };
    if (err instanceof DentalError) return { ok: false, error: `dental_${err.code}` };
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
