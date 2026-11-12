/**
 * Each clinic's own WhatsApp number: the platform owner connects it (token stored encrypted,
 * audited without the token), messages go out from THAT number, incoming events are grouped by
 * number, and a demo clinic can never send real WhatsApp.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import { auditLogs, tenants } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { PermissionError } from "@/lib/auth/permissions";
import { createClinic } from "@/lib/platform/clinics";
import { setClinicWhatsApp, testClinicWhatsApp, WhatsAppConnectError } from "@/lib/platform/whatsapp";
import { openSecret, sealSecret } from "@/lib/security/secret-box";
import { clinicLiveConfig, whatsappMode, WHATSAPP_TOKEN_PURPOSE } from "@/lib/whatsapp/config";
import { parseMetaWebhookByNumber } from "@/lib/whatsapp/webhook";

afterAll(closeDb);

const OWNER = { userId: "usr_platform-owner", roles: ["platform_owner"] as const };
const NOT_OWNER = { userId: "usr_platform-owner", roles: ["clinic_admin"] as const };
const stamp = Date.now().toString(36);
const ENV = {
  BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-123",
  WHATSAPP_APP_SECRET: "app-secret",
  WHATSAPP_VERIFY_TOKEN: "verify",
};

async function newClinic(tag: string, isDemo: boolean) {
  const slug = `wa-${tag}-${stamp}`;
  return createClinic(OWNER, {
    slug,
    nameAr: "عيادة واتساب",
    nameEn: "WhatsApp Clinic",
    brandColor: "#28817a",
    isDemo,
    branch: { nameAr: "الفرع", nameEn: "Main", cityAr: "الرياض", cityEn: "Riyadh" },
    department: { nameAr: "الجلدية", nameEn: "Dermatology" },
    admin: { nameAr: "مدير", email: `admin-${slug}@t.demo` },
  });
}
const row = async (id: string) => (await getDb().select().from(tenants).where(eq(tenants.id, id)))[0]!;

describe("secret box", () => {
  it("round-trips, and refuses another purpose or a changed value", () => {
    const sealed = sealSecret("EAAG-token", "whatsapp-token", ENV);
    expect(sealed).not.toContain("EAAG");
    expect(openSecret(sealed, "whatsapp-token", ENV)).toBe("EAAG-token");
    expect(openSecret(sealed, "other", ENV)).toBeNull();
    expect(openSecret(`${sealed.slice(0, -4)}AAAA`, "whatsapp-token", ENV)).toBeNull();
    expect(openSecret("plain", "whatsapp-token", ENV)).toBeNull();
  });
});

describe("which number a clinic sends from", () => {
  const base = { isDemo: false, slug: "x", status: "active" as const, whatsappPhoneNumberId: "111" };

  it("uses the clinic's own number and token once switched live", () => {
    const enc = sealSecret("clinic-token", WHATSAPP_TOKEN_PURPOSE, ENV);
    const r = clinicLiveConfig({ ...base, whatsappLive: true, whatsappTokenEnc: enc }, ENV);
    expect(r.config).toMatchObject({ phoneNumberId: "111", accessToken: "clinic-token", provider: "meta" });
    expect(whatsappMode({ ...base, whatsappLive: true, whatsappTokenEnc: enc }, ENV)).toBe("live");
  });

  it("falls back to the platform token; says what is missing", () => {
    const withPlatform = { ...ENV, WHATSAPP_ACCESS_TOKEN: "platform-token" };
    expect(clinicLiveConfig({ ...base, whatsappLive: true }, withPlatform).config?.accessToken).toBe(
      "platform-token",
    );
    const notLive = clinicLiveConfig({ ...base, whatsappLive: false }, withPlatform);
    expect(notLive.config).toBeNull();
    expect(notLive.missing).toContain("switched live");
    expect(clinicLiveConfig({ ...base, whatsappLive: true }, {}).missing).toEqual(
      expect.arrayContaining(["WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"]),
    );
  });

  it("a demo clinic never goes live (simulator in demo mode, otherwise off)", () => {
    const demo = { ...base, isDemo: true, whatsappLive: true, whatsappTokenEnc: null };
    const env = { ...ENV, WHATSAPP_ACCESS_TOKEN: "t" };
    expect(whatsappMode(demo, env)).toBe("off");
    expect(whatsappMode(demo, { ...env, MESSAGE_DEMO_MODE: "on" })).toBe("demo");
  });

  it("a paused clinic sends nothing", () => {
    const env = { ...ENV, WHATSAPP_ACCESS_TOKEN: "t" };
    expect(whatsappMode({ ...base, whatsappLive: true, status: "read_only" }, env)).toBe("off");
  });
});

describe("incoming events are grouped by the clinic number they reached", () => {
  it("groups per phone_number_id", () => {
    const change = (numberId: string, msgId: string) => ({
      value: {
        metadata: { phone_number_id: numberId },
        messages: [{ id: msgId, from: "966501112222", type: "text", text: { body: "hi" } }],
      },
    });
    const grouped = parseMetaWebhookByNumber({
      entry: [{ changes: [change("111", "m1"), change("222", "m2"), change("111", "m3")] }],
    });
    expect([...grouped.keys()].sort()).toEqual(["111", "222"]);
    expect(grouped.get("111")!.map((e) => e.eventId)).toEqual(["m1", "m3"]);
  });
});

describe("connecting a clinic (platform owner)", () => {
  it("stores the token encrypted, audits without it, and goes live", async () => {
    const c = await newClinic("live", false);
    const numberId = `9${Date.now()}`;
    await setClinicWhatsApp(
      OWNER,
      c.tenantId,
      {
        phoneNumberId: numberId,
        businessAccountId: "555",
        displayPhone: "+966 50 111 2222",
        accessToken: "EAAG-secret-token",
        live: true,
      },
      ENV,
    );
    const t = await row(c.tenantId);
    expect(t).toMatchObject({ whatsappPhoneNumberId: numberId, whatsappLive: true });
    expect(t.whatsappTokenEnc).not.toContain("EAAG");
    expect(openSecret(t.whatsappTokenEnc, WHATSAPP_TOKEN_PURPOSE, ENV)).toBe("EAAG-secret-token");
    const logs = await withTenant(c.tenantId, (tx) =>
      tx.select().from(auditLogs).where(eq(auditLogs.action, "clinic.whatsapp")),
    );
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs[0]!.metadata)).not.toContain("EAAG");
    expect(whatsappMode(t, ENV)).toBe("live");

    // Saving again without a token keeps the stored one.
    await setClinicWhatsApp(
      OWNER,
      c.tenantId,
      { phoneNumberId: numberId, businessAccountId: "555", displayPhone: "+966 50 111 2222", live: true },
      ENV,
    );
    expect((await row(c.tenantId)).whatsappTokenEnc).toBe(t.whatsappTokenEnc);

    // The same number can't be connected to a second clinic.
    const other = await newClinic("other", false);
    await expect(
      setClinicWhatsApp(
        OWNER,
        other.tenantId,
        { phoneNumberId: numberId, businessAccountId: "", displayPhone: "", live: false },
        ENV,
      ),
    ).rejects.toThrow(WhatsAppConnectError);
  });

  it("sends the test message from the clinic's own number with its token", async () => {
    const c = await newClinic("test", false);
    const numberId = `8${Date.now()}`;
    await setClinicWhatsApp(
      OWNER,
      c.tenantId,
      { phoneNumberId: numberId, businessAccountId: "", displayPhone: "", accessToken: "tok-123", live: false },
      ENV,
    );
    const realFetch = globalThis.fetch;
    const calls: { url: string; auth: string | null }[] = [];
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const r = await testClinicWhatsApp(OWNER, c.tenantId, "0501112222", ENV);
      expect(r.ok).toBe(true);
      expect(calls[0]!.url).toContain(`/${numberId}/messages`);
      expect(calls[0]!.auth).toBe("Bearer tok-123");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("refuses a demo clinic going live, and anyone but the platform owner", async () => {
    const demo = await newClinic("demo", true);
    await expect(
      setClinicWhatsApp(
        OWNER,
        demo.tenantId,
        { phoneNumberId: `7${Date.now()}`, businessAccountId: "", displayPhone: "", live: true },
        ENV,
      ),
    ).rejects.toMatchObject({ code: "demo_clinic" });
    await expect(
      setClinicWhatsApp(
        NOT_OWNER,
        demo.tenantId,
        { phoneNumberId: "", businessAccountId: "", displayPhone: "", live: false },
        ENV,
      ),
    ).rejects.toThrow(PermissionError);
  });
});
