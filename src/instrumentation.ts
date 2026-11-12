import { errorName, opsAlert } from "@/lib/ops/alert";

/**
 * Next.js calls this for every unexpected server error (pages, server actions, API routes).
 * The alert names the route TEMPLATE (e.g. "/sign/[token]"), never the real address — which can
 * carry a signed link — and the error's name, never its message (it can contain patient data).
 */
export async function onRequestError(
  err: unknown,
  request: { method?: string },
  context: { routePath?: string; routeType?: string; routerKind?: string },
) {
  await opsAlert("server_error", {
    route: context.routePath ?? "unknown",
    type: context.routeType,
    method: request.method,
    error: errorName(err),
    digest: (err as { digest?: string } | null)?.digest,
  });
}
