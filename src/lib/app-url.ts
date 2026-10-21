import "server-only";
import { headers } from "next/headers";

/**
 * The ONE public address of the app, e.g. https://derma-clinic-app.vercel.app.
 * Never a per-deployment snapshot link (those look like derma-clinic-app-abc123-team.vercel.app).
 * Order: APP_PUBLIC_URL (set by hand) → Vercel's production address → the current request.
 */
export async function mainAppUrl(): Promise<string> {
  const explicit = process.env.APP_PUBLIC_URL?.replace(/\/+$/, "");
  if (explicit) return explicit;
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) return `https://${prod}`;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
