import { after, NextResponse, type NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { tenantSettings } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { getTenantBySlug } from "@/lib/tenant/current";
import { liveConfig } from "@/lib/whatsapp/config";
import { handleInbound } from "@/lib/whatsapp/inbound";
import { parseMetaWebhook, validSignature } from "@/lib/whatsapp/webhook";

/**
 * Meta WhatsApp webhook. GET = Meta's verification challenge; POST = messages and statuses.
 * The clinic is the one WHATSAPP_CLINIC names. Signatures are checked with the app secret;
 * we answer 200 at once and do the work after the response (Meta expects a fast answer).
 */
export async function GET(request: NextRequest) {
  const { config } = liveConfig();
  const p = request.nextUrl.searchParams;
  if (
    !config ||
    p.get("hub.mode") !== "subscribe" ||
    !p.get("hub.verify_token") ||
    p.get("hub.verify_token") !== config.verifyToken
  ) {
    return new NextResponse("forbidden", { status: 403 });
  }
  const tenant = await getTenantBySlug(config.clinic);
  if (tenant) {
    await withTenant(tenant.id, (tx) =>
      tx
        .update(tenantSettings)
        .set({ whatsappWebhookVerifiedAt: sql`now()` })
        .where(eq(tenantSettings.tenantId, tenant.id)),
    );
  }
  return new NextResponse(p.get("hub.challenge") ?? "", {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

export async function POST(request: NextRequest) {
  const { config } = liveConfig();
  if (!config) return NextResponse.json({ error: "not_configured" }, { status: 404 });
  const raw = await request.text();
  if (!validSignature(raw, request.headers.get("x-hub-signature-256"), config.appSecret)) {
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true }); // nothing we can use; don't make Meta retry
  }
  const tenant = await getTenantBySlug(config.clinic);
  if (!tenant) return NextResponse.json({ ok: true });
  const events = parseMetaWebhook(body);
  after(() =>
    handleInbound(tenant, events).catch((err) => console.warn("whatsapp webhook failed", err)),
  );
  return NextResponse.json({ ok: true, received: events.length });
}
