/**
 * Platform → System status: is this installation ready for real clinics? Read-only, settings
 * and the "ops" records only (never clinic or patient data): which database this is (live or
 * demo), the last update and backup, and the settings a live system needs.
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

export type CheckState = "ok" | "warn" | "bad" | "info";
export interface StatusCheck {
  key: string;
  state: CheckState;
  /** Values for the message (dates, counts, hours). */
  values?: Record<string, string | number>;
}

/** A backup older than this is a warning (it runs every night). */
export const BACKUP_MAX_AGE_HOURS = 30;

export interface OpsRecords {
  live: boolean;
  upgrades: number;
  lastUpgradeAt: Date | null;
  lastBackupAt: Date | null;
  lastBackupBytes: number | null;
}

export async function opsRecords(): Promise<OpsRecords> {
  const db = getDb();
  const [{ live }] = (await db.execute(
    sql`select to_regclass('ops.schema_upgrades') is not null as live`,
  )) as unknown as { live: boolean }[];
  if (!live) {
    return { live, upgrades: 0, lastUpgradeAt: null, lastBackupAt: null, lastBackupBytes: null };
  }
  const [u] = (await db.execute(
    sql`select count(*)::int as n, max(applied_at) as at from ops.schema_upgrades`,
  )) as unknown as { n: number; at: string | Date | null }[];
  const [b] = (await db.execute(
    sql`select finished_at as at, size_bytes as bytes from ops.backup_runs order by finished_at desc limit 1`,
  )) as unknown as { at: string | Date; bytes: string | number }[];
  return {
    live,
    upgrades: u?.n ?? 0,
    lastUpgradeAt: u?.at ? new Date(u.at) : null,
    lastBackupAt: b ? new Date(b.at) : null,
    lastBackupBytes: b ? Number(b.bytes) : null,
  };
}

const has = (v: string | undefined) => !!v && v.trim().length > 0;

/** Pure: the checks for these records + settings (tested without a database). */
export function statusChecks(
  ops: OpsRecords,
  demoClinics: number,
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): StatusCheck[] {
  const checks: StatusCheck[] = [];
  checks.push({ key: ops.live ? "dbLive" : "dbDemo", state: "info" });

  if (ops.live) {
    checks.push({
      key: "upgrades",
      state: "ok",
      values: {
        count: ops.upgrades,
        at: ops.lastUpgradeAt
          ? ops.lastUpgradeAt.toISOString().slice(0, 16).replace("T", " ")
          : "—",
      },
    });
    if (!ops.lastBackupAt) checks.push({ key: "backupNever", state: "bad" });
    else {
      const hours = Math.floor((now.getTime() - ops.lastBackupAt.getTime()) / 3_600_000);
      checks.push({
        key: "backup",
        state: hours <= BACKUP_MAX_AGE_HOURS ? "ok" : "bad",
        values: { hours, mb: ((ops.lastBackupBytes ?? 0) / 1_048_576).toFixed(1) },
      });
    }
    checks.push({
      key: "demoClinics",
      state: demoClinics > 0 ? "warn" : "ok",
      values: { count: demoClinics },
    });
    checks.push({
      key: "messageDemoMode",
      state: env.MESSAGE_DEMO_MODE === "on" ? "bad" : "ok",
    });
  }

  const required: [string, boolean][] = [
    ["BETTER_AUTH_SECRET", has(env.BETTER_AUTH_SECRET)],
    ["CRON_SECRET", has(env.CRON_SECRET)],
    ["APP_ROOT_DOMAIN", has(env.APP_ROOT_DOMAIN)],
  ];
  const missing = required.filter(([, ok]) => !ok).map(([k]) => k);
  checks.push({
    key: missing.length ? "settingsMissing" : "settingsOk",
    state: missing.length ? (ops.live ? "bad" : "warn") : "ok",
    values: { names: missing.join(", ") },
  });

  const optional: [string, boolean][] = [
    ["WhatsApp", has(env.WHATSAPP_APP_SECRET) && has(env.WHATSAPP_VERIFY_TOKEN)],
    ["AI", has(env.ANTHROPIC_API_KEY)],
    ["Video", has(env.DAILY_API_KEY)],
    ["Push", has(env.VAPID_PUBLIC_KEY) && has(env.VAPID_PRIVATE_KEY)],
    ["Alerts", has(env.OPS_ALERT_WEBHOOK_URL)],
  ];
  for (const [name, ok] of optional) {
    checks.push({
      key: ok ? "featureOn" : "featureOff",
      state: ok ? "ok" : "warn",
      values: { name },
    });
  }
  return checks;
}
