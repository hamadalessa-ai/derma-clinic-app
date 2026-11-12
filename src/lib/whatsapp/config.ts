/**
 * Which way WhatsApp messages go for a clinic — decided ONLY by settings (Vercel environment):
 *
 *   demo  MESSAGE_DEMO_MODE=on and the clinic is a demo clinic → the in-app WhatsApp simulator.
 *         Nothing is sent. (A real clinic never uses the simulator.)
 *   live  the platform owner connected this clinic's own number (tenants.whatsapp_* columns,
 *         switched live) and the platform's Meta app settings exist (WHATSAPP_APP_SECRET,
 *         WHATSAPP_VERIFY_TOKEN; token: the clinic's own, encrypted, or WHATSAPP_ACCESS_TOKEN)
 *         → real WhatsApp from THAT clinic's number.
 *         (Older single-clinic setting, still honoured: WHATSAPP_PROVIDER + all its settings +
 *         WHATSAPP_CLINIC naming this clinic.)
 *   off   neither: messages are not sent (codes fail safely with "messaging_unavailable").
 */
import { openSecret } from "@/lib/security/secret-box";
import { clinicIsActive, type ClinicStatus } from "@/lib/tenant/status";

type Env = Record<string, string | undefined>;

export type WhatsAppMode = "demo" | "live" | "off";

/** Settings per provider. `secret: true` = keep it secret (Vercel "Sensitive"). */
export const PROVIDER_SETTINGS = {
  meta: [
    { name: "WHATSAPP_PHONE_NUMBER_ID", secret: false },
    { name: "WHATSAPP_BUSINESS_ACCOUNT_ID", secret: false },
    { name: "WHATSAPP_ACCESS_TOKEN", secret: true },
    { name: "WHATSAPP_APP_SECRET", secret: true },
    { name: "WHATSAPP_VERIFY_TOKEN", secret: true },
  ],
} as const;
export type ProviderName = keyof typeof PROVIDER_SETTINGS;

export function demoMessagingAllowed(tenant: { isDemo: boolean }, env: Env = process.env) {
  return tenant.isDemo === true && env.MESSAGE_DEMO_MODE === "on";
}

export interface LiveConfig {
  provider: ProviderName;
  clinic: string;
  phoneNumberId: string;
  businessAccountId: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
  apiVersion: string;
}

/** The live settings, or null with the names of what's missing (shown on the status page). */
export function liveConfig(env: Env = process.env): {
  config: LiveConfig | null;
  missing: string[];
  provider: string | null;
} {
  const provider = env.WHATSAPP_PROVIDER?.trim().toLowerCase() || null;
  if (!provider) return { config: null, missing: ["WHATSAPP_PROVIDER"], provider };
  if (!(provider in PROVIDER_SETTINGS)) {
    return { config: null, missing: [`WHATSAPP_PROVIDER (unknown: ${provider})`], provider };
  }
  const names = [
    ...PROVIDER_SETTINGS[provider as ProviderName].map((s) => s.name),
    "WHATSAPP_CLINIC",
  ];
  const missing = names.filter((n) => !env[n]?.trim());
  if (missing.length) return { config: null, missing, provider };
  return {
    provider,
    missing: [],
    config: {
      provider: provider as ProviderName,
      clinic: env.WHATSAPP_CLINIC!.trim(),
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID!.trim(),
      businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID!.trim(),
      accessToken: env.WHATSAPP_ACCESS_TOKEN!.trim(),
      appSecret: env.WHATSAPP_APP_SECRET!.trim(),
      verifyToken: env.WHATSAPP_VERIFY_TOKEN!.trim(),
      apiVersion: env.WHATSAPP_API_VERSION?.trim() || "v22.0",
    },
  };
}

/** A clinic as far as WhatsApp is concerned (a full tenants row fits). */
export interface WaTenant {
  isDemo: boolean;
  slug?: string;
  status?: ClinicStatus | null;
  whatsappLive?: boolean | null;
  whatsappPhoneNumberId?: string | null;
  whatsappBusinessAccountId?: string | null;
  whatsappTokenEnc?: string | null;
}

export const WHATSAPP_TOKEN_PURPOSE = "whatsapp-token";

/** The platform's ONE Meta app, shared by every clinic's number (webhook + signatures). */
export function platformApp(env: Env = process.env) {
  const appSecret = env.WHATSAPP_APP_SECRET?.trim() || null;
  const verifyToken = env.WHATSAPP_VERIFY_TOKEN?.trim() || null;
  return {
    appSecret,
    verifyToken,
    accessToken: env.WHATSAPP_ACCESS_TOKEN?.trim() || null,
    apiVersion: env.WHATSAPP_API_VERSION?.trim() || "v22.0",
    missing: [
      ...(appSecret ? [] : ["WHATSAPP_APP_SECRET"]),
      ...(verifyToken ? [] : ["WHATSAPP_VERIFY_TOKEN"]),
    ],
  };
}

/**
 * This clinic's live settings: its own connected number first, else the older single-clinic
 * environment settings when they name this clinic. `missing` says what stops it (status pages).
 */
export function clinicLiveConfig(
  tenant: WaTenant,
  env: Env = process.env,
): { config: LiveConfig | null; missing: string[]; source: "clinic" | "env" | null } {
  if (tenant.whatsappPhoneNumberId) {
    const app = platformApp(env);
    const own = openSecret(tenant.whatsappTokenEnc, WHATSAPP_TOKEN_PURPOSE, env);
    const token = own ?? app.accessToken;
    const missing = [
      ...app.missing,
      ...(token ? [] : ["access token (clinic or WHATSAPP_ACCESS_TOKEN)"]),
      ...(tenant.whatsappLive ? [] : ["switched live"]),
    ];
    if (missing.length || !token || !app.appSecret || !app.verifyToken) {
      return { config: null, missing, source: "clinic" };
    }
    return {
      source: "clinic",
      missing: [],
      config: {
        provider: "meta",
        clinic: tenant.slug ?? "",
        phoneNumberId: tenant.whatsappPhoneNumberId,
        businessAccountId: tenant.whatsappBusinessAccountId ?? "",
        accessToken: token,
        appSecret: app.appSecret,
        verifyToken: app.verifyToken,
        apiVersion: app.apiVersion,
      },
    };
  }
  const legacy = liveConfig(env);
  if (legacy.config && tenant.slug && legacy.config.clinic === tenant.slug) {
    return { config: legacy.config, missing: [], source: "env" };
  }
  return {
    config: null,
    missing: legacy.config ? ["not connected"] : legacy.missing,
    source: null,
  };
}

export function whatsappMode(tenant: WaTenant, env: Env = process.env): WhatsAppMode {
  // A paused clinic (read-only, suspended, closed) sends nothing: no reminders, no replies.
  if (!clinicIsActive(tenant)) return "off";
  if (demoMessagingAllowed(tenant, env)) return "demo";
  // A clinic's own connection never sends for a demo clinic (made-up numbers may be real people's).
  if (tenant.isDemo && tenant.whatsappPhoneNumberId) return "off";
  return clinicLiveConfig(tenant, env).config ? "live" : "off";
}

/** Public address of the app, for links in messages (no request needed, works in the scheduler). */
export function appBaseUrl(tenant: { slug: string }, env: Env = process.env): string {
  const explicit = env.APP_PUBLIC_URL?.replace(/\/+$/, "");
  if (explicit) return explicit;
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  const root = env.APP_ROOT_DOMAIN || "localhost";
  return root === "localhost"
    ? `http://${tenant.slug}.localhost:3000`
    : `https://${tenant.slug}.${root}`;
}
