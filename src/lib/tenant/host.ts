/** Header the proxy sets with the clinic slug. Any value sent by the browser is overwritten. */
export const CLINIC_HEADER = "x-clinic-slug";
/** Header the proxy sets with the requested path (used to log support-access page views). */
export const PATH_HEADER = "x-request-path";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const RESERVED = new Set(["www", "app", "api", "admin"]);

/**
 * Works out which clinic a request is for, from the Host header.
 *
 *   derma.localhost:3000              → "derma"   (subdomain of APP_ROOT_DOMAIN)
 *   derma.clinicapp.sa                → "derma"   (when APP_ROOT_DOMAIN=clinicapp.sa)
 *   localhost:3000, www.clinicapp.sa  → defaultSlug
 *   derma-clinic-app.vercel.app       → defaultSlug (not under APP_ROOT_DOMAIN)
 *
 * Returns null only if no clinic can be determined at all.
 */
export function clinicSlugFromHost(
  host: string | null | undefined,
  rootDomain: string,
  defaultSlug: string | null | undefined,
): string | null {
  const fallback = defaultSlug && SLUG_RE.test(defaultSlug) ? defaultSlug : null;
  if (!host) return fallback;

  const hostname = host.trim().toLowerCase().replace(/:\d+$/, "");
  const root = rootDomain.trim().toLowerCase();
  if (!root || !hostname.endsWith(`.${root}`)) return fallback;

  const sub = hostname.slice(0, -(root.length + 1));
  if (sub.includes(".") || RESERVED.has(sub) || !SLUG_RE.test(sub)) return fallback;
  return sub;
}

export function clinicSlugFromEnv(host: string | null | undefined) {
  return clinicSlugFromHost(
    host,
    process.env.APP_ROOT_DOMAIN ?? "localhost",
    process.env.DEMO_DEFAULT_CLINIC ?? null,
  );
}
