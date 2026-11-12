/**
 * Platform owner → a clinic's WhatsApp connection. The clinic does nothing: we enter its number's
 * details during go-live (from Meta's WhatsApp Manager), send a test, then switch it live.
 * The clinic's own access token (if any) is stored encrypted; it is never shown again.
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { tenants } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import { assertCan, type Role } from "@/lib/auth/permissions";
import { sealSecret } from "@/lib/security/secret-box";
import { normalizeSaudiMobile } from "@/lib/phone";
import { clinicLiveConfig, platformApp, WHATSAPP_TOKEN_PURPOSE } from "@/lib/whatsapp/config";
import { liveTransport } from "@/lib/whatsapp/transport";

type Owner = { userId: string; roles: readonly Role[] };
type Env = Record<string, string | undefined>;

export class WhatsAppConnectError extends Error {
  constructor(
    public code: "not_found" | "no_number" | "bad_phone" | "number_taken" | "not_ready" | "demo_clinic",
  ) {
    super(code);
    this.name = "WhatsAppConnectError";
  }
}

export interface ClinicWhatsAppInput {
  phoneNumberId: string;
  businessAccountId: string;
  displayPhone: string;
  /** New token to store (encrypted). Empty/undefined = keep the stored one. */
  accessToken?: string | null;
  /** Remove the stored token (use the platform's). */
  clearToken?: boolean;
  live: boolean;
}

async function asOwner<T>(owner: Owner, tenantId: string, fn: (tx: TenantTx) => Promise<T>) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('app.user_id', ${owner.userId}, true),
      set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

export async function setClinicWhatsApp(
  owner: Owner,
  tenantId: string,
  input: ClinicWhatsAppInput,
  env: Env = process.env,
) {
  assertCan(owner.roles, "platform:clinics");
  const phoneNumberId = input.phoneNumberId.trim();
  if (input.live && !phoneNumberId) throw new WhatsAppConnectError("no_number");
  const [clinic] = await getDb()
    .select({ isDemo: tenants.isDemo })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!clinic) throw new WhatsAppConnectError("not_found");
  // A demo clinic never sends real WhatsApp: its made-up patients' numbers may belong to real
  // people. (Test with a separate, non-demo test clinic that holds only your own number.)
  if (input.live && clinic.isDemo) throw new WhatsAppConnectError("demo_clinic");
  if (phoneNumberId) {
    const [other] = await getDb()
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.whatsappPhoneNumberId, phoneNumberId))
      .limit(1);
    if (other && other.id !== tenantId) throw new WhatsAppConnectError("number_taken");
  }
  const token = input.accessToken?.trim();
  const tokenEnc = input.clearToken ? "" : token ? sealSecret(token, WHATSAPP_TOKEN_PURPOSE, env) : null;
  return asOwner(owner, tenantId, async (tx) => {
    await tx.execute(
      sql`select public.app_set_clinic_whatsapp(${tenantId}::uuid, ${phoneNumberId}, ${input.businessAccountId.trim()}, ${input.displayPhone.trim()}, ${tokenEnc}, ${input.live})`,
    );
    await audit(tx, {
      actorUserId: owner.userId,
      action: "clinic.whatsapp",
      entityType: "tenant",
      entityId: tenantId,
      // Never the token itself: only whether one was set or removed.
      metadata: {
        phoneNumberId: phoneNumberId || null,
        live: input.live,
        token: input.clearToken ? "removed" : token ? "replaced" : "kept",
      },
    });
    return { live: input.live };
  });
}

/**
 * Sends Meta's standard "hello_world" test message from the clinic's number to `phone` — works
 * before the clinic is switched live, so the connection can be checked first. Nothing is stored
 * in the clinic's chats (the platform owner has no access to them); the result is audited.
 */
export async function testClinicWhatsApp(
  owner: Owner,
  tenantId: string,
  phone: string,
  env: Env = process.env,
) {
  assertCan(owner.roles, "platform:clinics");
  const to = normalizeSaudiMobile(phone);
  if (!to) throw new WhatsAppConnectError("bad_phone");
  const [tenant] = await getDb().select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new WhatsAppConnectError("not_found");
  const { config, missing } = clinicLiveConfig({ ...tenant, whatsappLive: true }, env);
  if (!config) return { ok: false as const, errorCode: "not_ready", errorText: missing.join(", ") };
  const result = await liveTransport(config).send({
    to,
    language: "en_US",
    body: "hello_world (Meta test template)",
    buttons: [],
    template: { name: "hello_world", params: [] },
    insideWindow: false,
  });
  await asOwner(owner, tenantId, (tx) =>
    audit(tx, {
      actorUserId: owner.userId,
      action: "clinic.whatsapp_test",
      entityType: "tenant",
      entityId: tenantId,
      metadata: { ok: result.ok, error: result.ok ? null : result.errorCode },
    }),
  );
  return result;
}

/** What the platform page shows about a clinic's connection (never the token). */
export function clinicWhatsAppView(
  tenant: typeof tenants.$inferSelect,
  env: Env = process.env,
) {
  const check = clinicLiveConfig({ ...tenant, whatsappLive: true }, env);
  return {
    phoneNumberId: tenant.whatsappPhoneNumberId ?? "",
    businessAccountId: tenant.whatsappBusinessAccountId ?? "",
    displayPhone: tenant.whatsappDisplayPhone ?? "",
    live: tenant.whatsappLive,
    ownToken: Boolean(tenant.whatsappTokenEnc),
    /** What still stops it working (empty = ready to test / live). */
    missing: tenant.whatsappPhoneNumberId ? check.missing : ["phone number id"],
    platformMissing: platformApp(env).missing,
  };
}
