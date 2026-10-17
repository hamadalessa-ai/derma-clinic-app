import { NextResponse, type NextRequest } from "next/server";
import { CLINIC_HEADER, clinicSlugFromEnv } from "@/lib/tenant/host";

/**
 * Resolves the clinic from the subdomain and passes it to the app as a request header.
 * Only decides WHICH clinic; access control happens on the server (session + membership + RLS).
 */
export function proxy(request: NextRequest) {
  const slug = clinicSlugFromEnv(request.headers.get("host"));
  const headers = new Headers(request.headers);
  headers.delete(CLINIC_HEADER); // never trust a value sent by the browser
  if (slug) headers.set(CLINIC_HEADER, slug);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|webp)$).*)"],
};
