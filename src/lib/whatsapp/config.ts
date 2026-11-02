/**
 * Which way WhatsApp messages go for a clinic — decided ONLY by settings (Vercel environment):
 *
 *   demo  MESSAGE_DEMO_MODE=on and the clinic is a demo clinic → the in-app WhatsApp simulator.
 *         Nothing is sent. (A real clinic never uses the simulator.)
 *   live  WHATSAPP_PROVIDER is set (e.g. "meta"), all its settings are present and
 *         WHATSAPP_CLINIC names this clinic → real WhatsApp.
 *   off   neither: messages are not sent (codes fail safely with "messaging_unavailable").
 */
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

export function whatsappMode(
  tenant: { isDemo: boolean; slug?: string },
  env: Env = process.env,
): WhatsAppMode {
  if (demoMessagingAllowed(tenant, env)) return "demo";
  const { config } = liveConfig(env);
  if (config && tenant.slug && config.clinic === tenant.slug) return "live";
  return "off";
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
