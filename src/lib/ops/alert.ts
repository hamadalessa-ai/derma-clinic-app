/**
 * Operational alerts: something went wrong that a person should look at (a clinic's scheduled
 * messages failed to run, messages got stuck, a server error, the WhatsApp webhook failed).
 *
 * Always written to the server log as one JSON line (Vercel → Logs, search "ops_alert").
 * When OPS_ALERT_WEBHOOK_URL is set (Vercel → Environment Variables; e.g. a Slack, Microsoft Teams,
 * Google Chat or Discord "incoming webhook"), the same short text is posted there too.
 *
 * NEVER put patient data in an alert: only what happened, where (clinic slug, page path), counts,
 * and error NAMES — not error messages, which can contain names or numbers.
 */
type Details = Record<string, string | number | boolean | null | undefined>;

const recent = new Map<string, number>();
/** The same alert at most once per 10 minutes per server instance (no floods). */
const QUIET_MS = 10 * 60_000;

export function errorName(err: unknown): string {
  if (err instanceof Error) return err.name || "Error";
  return typeof err;
}

export async function opsAlert(
  event: string,
  details: Details = {},
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const key = `${event}:${details.clinic ?? ""}:${details.route ?? ""}`;
  const now = Date.now();
  if ((recent.get(key) ?? 0) > now - QUIET_MS) return;
  recent.set(key, now);

  const line = { ops_alert: event, at: new Date(now).toISOString(), ...details };
  console.error(JSON.stringify(line));

  const url = env.OPS_ALERT_WEBHOOK_URL?.trim();
  if (!url) return;
  const text =
    `⚠️ Clinic platform: ${event}` +
    Object.entries(details)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `\n• ${k}: ${v}`)
      .join("");
  try {
    // "text" works for Slack, Google Chat and Teams workflows; "content" for Discord.
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // An alert that can't be delivered must never break the work that raised it.
  }
}

/** For tests. */
export function resetOpsAlerts() {
  recent.clear();
}
