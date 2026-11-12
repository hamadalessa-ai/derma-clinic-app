import { after, NextResponse, type NextRequest } from "next/server";
import { eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { tenants, tenantSettings } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { getTenantBySlug, type Tenant } from "@/lib/tenant/current";
import { errorName, opsAlert } from "@/lib/ops/alert";
import { liveConfig, platformApp } from "@/lib/whatsapp/config";
import { handleInbound, type InboundEvent } from "@/lib/whatsapp/inbound";
import { parseMetaWebhookByNumber, validSignature } from "@/lib/whatsapp/webhook";

/** The AI receptionist may take several seconds (a few model calls) to answer a message. */
export const maxDuration = 60;

/**
 * Meta WhatsApp webhook — ONE address for every clinic (our one Meta app).
 * GET = Meta's verification challenge; POST = messages and statuses, routed to the clinic whose
 * number received them (tenants.whatsapp_phone_number_id). The older single-clinic setting
 * (WHATSAPP_CLINIC) still receives events for numbers no clinic has claimed.
 * Signatures are checked with the app secret; we answer 200 at once and work after the response.
 */
function appSettings() {
  const app = platformApp();
  const legacy = liveConfig().config;
  return {
    appSecret: app.appSecret ?? legacy?.appSecret ?? null,
    verifyToken: app.verifyToken ?? legacy?.verifyToken ?? null,
    legacyClinic: legacy?.clinic ?? null,
  };
}

export async function GET(request: NextRequest) {
  const { verifyToken, legacyClinic } = appSettings();
  const p = request.nextUrl.searchParams;
  if (
    !verifyToken ||
    p.get("hub.mode") !== "subscribe" ||
    !p.get("hub.verify_token") ||
    p.get("hub.verify_token") !== verifyToken
  ) {
    return new NextResponse("forbidden", { status: 403 });
  }
  // Mark the webhook as verified for every clinic it serves (shown on their status page).
  const connected = await getDb()
    .select({ id: tenants.id })
    .from(tenants)
    .where(isNotNull(tenants.whatsappPhoneNumberId));
  const legacy = legacyClinic ? await getTenantBySlug(legacyClinic) : null;
  for (const id of new Set([...connected.map((c) => c.id), ...(legacy ? [legacy.id] : [])])) {
    await withTenant(id, (tx) =>
      tx
        .update(tenantSettings)
        .set({ whatsappWebhookVerifiedAt: sql`now()` })
        .where(eq(tenantSettings.tenantId, id)),
    );
  }
  return new NextResponse(p.get("hub.challenge") ?? "", {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

export async function POST(request: NextRequest) {
  const { appSecret, legacyClinic } = appSettings();
  if (!appSecret) return NextResponse.json({ error: "not_configured" }, { status: 404 });
  const raw = await request.text();
  if (!validSignature(raw, request.headers.get("x-hub-signature-256"), appSecret)) {
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true }); // nothing we can use; don't make Meta retry
  }
  const work: { tenant: Tenant; events: InboundEvent[] }[] = [];
  let received = 0;
  for (const [numberId, events] of parseMetaWebhookByNumber(body)) {
    if (!events.length) continue;
    const [owner] = numberId
      ? await getDb()
          .select()
          .from(tenants)
          .where(eq(tenants.whatsappPhoneNumberId, numberId))
          .limit(1)
      : [];
    const tenant = owner ?? (legacyClinic ? await getTenantBySlug(legacyClinic) : null);
    if (!tenant) {
      await opsAlert("whatsapp_unknown_number", {
        number: numberId || "none",
        events: events.length,
      });
      continue;
    }
    work.push({ tenant, events });
    received += events.length;
  }
  after(async () => {
    for (const { tenant, events } of work) {
      await handleInbound(tenant, events).catch(async (err) => {
        console.warn("whatsapp webhook failed", err);
        await opsAlert("whatsapp_webhook_failed", { clinic: tenant.slug, error: errorName(err) });
      });
    }
  });
  return NextResponse.json({ ok: true, received });
}
