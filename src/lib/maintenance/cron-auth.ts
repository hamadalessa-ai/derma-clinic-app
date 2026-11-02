import { timingSafeEqual } from "node:crypto";

/**
 * Scheduled jobs (Vercel Cron, GitHub Actions) send "Authorization: Bearer <CRON_SECRET>".
 * Without CRON_SECRET set (or shorter than 16 characters), everything is refused (fails closed).
 */
export function cronAuthorized(authorization: string | null, secret = process.env.CRON_SECRET) {
  const given = authorization ?? "";
  const expected = `Bearer ${secret}`;
  return (
    !!secret &&
    secret.length >= 16 &&
    given.length === expected.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  );
}
