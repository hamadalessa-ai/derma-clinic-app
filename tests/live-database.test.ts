/**
 * The LIVE database (real clinics): built empty, then only ever UPGRADED (never reset).
 *  - the live build has every table and security rule but no demo data, only the owner;
 *  - upgrading an older database gives exactly the schema of a fresh build and keeps the data;
 *  - upgrading twice changes nothing; the demo tools refuse the live database and vice versa.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { transactionBody } from "@/db/demo-update";
import {
  buildLiveUpgradeSql,
  checkLiveSecrets,
  liveState,
  pendingMigrations,
  runLiveUpgrade,
  splitEnumAdditions,
} from "@/db/live-upgrade";
import { createLocalDatabase, LOCAL_APP_PASSWORD } from "@/db/local-setup";
import {
  APP_PASSWORD_PLACEHOLDER,
  buildLiveSetupSql,
  DEMO_PASSWORD_PLACEHOLDER,
  LIVE_OWNER_EMAIL_PLACEHOLDER,
  LIVE_OWNER_PASSWORD_PLACEHOLDER,
  migrationFiles,
} from "@/db/setup-sql";
import { statusChecks } from "@/lib/platform/system-status";

const superUrl =
  process.env.DATABASE_URL_ADMIN ?? "postgresql://postgres:localdev@127.0.0.1:5432/postgres";
const OWNER_PASSWORD = "Owner-Password-2026!";
const created: string[] = [];

afterAll(async () => {
  const su = postgres(superUrl, { max: 1, onnotice: () => {} });
  for (const db of created) await su.unsafe(`drop database if exists ${db} with (force)`);
  await su.end();
});

function liveSetupSql() {
  return buildLiveSetupSql()
    .replace(LIVE_OWNER_EMAIL_PLACEHOLDER, "Owner@Example.com")
    .replace(LIVE_OWNER_PASSWORD_PLACEHOLDER, OWNER_PASSWORD);
}
async function freshLive(dbName: string) {
  created.push(dbName);
  return createLocalDatabase({
    adminUrl: superUrl,
    dbName,
    demoPassword: "unused-here",
    setupSql: liveSetupSql(),
  });
}
/** The newest released DEMO setup, standing in for an older live database. */
async function olderDatabase(dbName: string) {
  created.push(dbName);
  const old = readFileSync(
    path.resolve(__dirname, "released-setup/phase-2b-concerns.sql"),
    "utf8",
  ).replace(DEMO_PASSWORD_PLACEHOLDER, "Old-Demo-123");
  const urls = await createLocalDatabase({
    adminUrl: superUrl,
    dbName,
    demoPassword: "Old-Demo-123",
    setupSql: old.replace(APP_PASSWORD_PLACEHOLDER, LOCAL_APP_PASSWORD),
  });
  // Which migration files that release was built from: its "-- 00xx_name.sql" markers.
  const applied = [...old.matchAll(/^-- (\d{4}_[a-z0-9_]+\.sql)$/gm)].map((m) => m[1]);
  return { ...urls, applied };
}
async function withDb<T>(url: string, fn: (db: postgres.Sql) => Promise<T>) {
  const db = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}
/** Marks a database as live, as the live setup does (for the older-database test). */
const OPS_SQL = (applied: string[]) => `
  create schema ops;
  create table ops.schema_upgrades (name text primary key, applied_at timestamptz not null default now());
  create table ops.backup_runs (
    id bigint generated always as identity primary key,
    finished_at timestamptz not null default now(),
    size_bytes bigint not null, tables int not null, rows bigint not null);
  insert into ops.schema_upgrades (name) values ${applied.map((a) => `('${a}')`).join(", ")};`;

/** Everything about the schema that matters, as sorted text (not the data). */
async function fingerprint(url: string) {
  return withDb(url, async (db) => {
    const parts = await Promise.all([
      db`select table_schema, table_name, column_name, data_type, udt_name, is_nullable,
                coalesce(column_default, '') as d
           from information_schema.columns where table_schema in ('public', 'ops')`,
      db`select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as def
           from pg_constraint where connamespace in ('public'::regnamespace, 'ops'::regnamespace)`,
      db`select indexdef from pg_indexes where schemaname in ('public', 'ops')`,
      db`select tablename, policyname, permissive, roles::text, cmd, coalesce(qual, '') q,
                coalesce(with_check, '') w from pg_policies where schemaname = 'public'`,
      db`select pg_get_triggerdef(t.oid) as def from pg_trigger t
           join pg_class c on c.oid = t.tgrelid
          where c.relnamespace = 'public'::regnamespace and not t.tgisinternal`,
      db`select proname, pg_get_function_identity_arguments(oid) as args, md5(prosrc) as src,
                prosecdef from pg_proc where pronamespace = 'public'::regnamespace`,
      db`select t.typname, array_agg(e.enumlabel order by e.enumsortorder)::text as labels
           from pg_type t join pg_enum e on e.enumtypid = t.oid
          where t.typnamespace = 'public'::regnamespace group by t.typname`,
      db`select relname, relrowsecurity, relforcerowsecurity from pg_class
          where relnamespace = 'public'::regnamespace and relkind = 'r'`,
      db`select table_schema, table_name, privilege_type from information_schema.role_table_grants
          where grantee = 'clinic_app'`,
    ]);
    return parts.map((rows) => rows.map((r) => JSON.stringify(r)).sort());
  });
}
const count = (url: string, table: string) =>
  withDb(url, async (db) => {
    await db.unsafe(`alter table public.${table} no force row level security`);
    const [{ n }] = await db.unsafe(`select count(*)::int as n from public.${table}`);
    await db.unsafe(`alter table public.${table} force row level security`);
    return n as number;
  });

describe("upgrade planning", () => {
  it("runs only the migrations the database doesn't have, and refuses unknown ones", () => {
    const files = ["0000_a.sql", "0001_b.sql", "0002_c.sql"];
    expect(pendingMigrations(["0000_a.sql"], files)).toEqual(["0001_b.sql", "0002_c.sql"]);
    expect(pendingMigrations(files, files)).toEqual([]);
    expect(() => pendingMigrations(["0000_a.sql", "0009_new.sql"], files)).toThrow(/doesn't know/);
  });

  it("moves enum additions to their own first step, safe to repeat", () => {
    const { enums, rest } = splitEnumAdditions([
      `ALTER TYPE "public"."role" ADD VALUE 'assistant';`,
      `ALTER TABLE "x" ADD COLUMN "y" text;`,
    ]);
    expect(enums).toEqual([`ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'assistant';`]);
    expect(rest).toBe(`ALTER TABLE "x" ADD COLUMN "y" text;`);
  });

  it("is one transaction that records what it applied", () => {
    const all = migrationFiles();
    const { sql, pending } = buildLiveUpgradeSql(all.slice(0, -1));
    expect(pending).toEqual([all.at(-1)]);
    const lines = sql.split("\n").map((l) => l.trim().toLowerCase());
    expect(lines.filter((l) => l === "begin;")).toHaveLength(1);
    expect(lines.filter((l) => l === "commit;")).toHaveLength(1);
    expect(sql).toContain(`insert into ops.schema_upgrades (name) values ('${all.at(-1)}')`);
  });

  it("checks the setup secrets before touching anything", () => {
    const ok = { appPassword: "A".repeat(24), ownerEmail: "a@b.co", ownerPassword: "x".repeat(14) };
    expect(() => checkLiveSecrets(ok)).not.toThrow();
    expect(() => checkLiveSecrets({ ...ok, appPassword: "short" })).toThrow(/LIVE_APP_DB_PASSWORD/);
    expect(() => checkLiveSecrets({ ...ok, ownerEmail: "nope" })).toThrow(/LIVE_OWNER_EMAIL/);
    expect(() => checkLiveSecrets({ ...ok, ownerPassword: "short" })).toThrow(
      /LIVE_OWNER_PASSWORD/,
    );
  });
});

describe("the live database", () => {
  let fresh: { adminUrl: string; appUrl: string };

  it("starts empty: no clinics or patients, only the platform owner, security on", async () => {
    fresh = await freshLive("derma_live_fresh");
    await withDb(fresh.adminUrl, async (db) => {
      const [{ tables }] =
        await db`select count(*)::int as tables from pg_tables where schemaname = 'public'`;
      expect(tables).toBeGreaterThanOrEqual(40);
      const [u] = await db`select email, is_platform_owner from public.users`;
      expect(u).toEqual({ email: "owner@example.com", is_platform_owner: true });
      const [{ ok }] = await db`
        select password = extensions.crypt(${OWNER_PASSWORD}, password) as ok from public.accounts`;
      expect(ok).toBe(true);
      const applied = await db`select name from ops.schema_upgrades order by name`;
      expect(applied.map((r) => r.name)).toEqual(migrationFiles());
      const weak = await db`
        select c.relname from pg_class c join pg_attribute a on a.attrelid = c.oid
         where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
           and a.attname = 'tenant_id' and not (c.relrowsecurity and c.relforcerowsecurity)`;
      expect(weak).toEqual([]);
    });
    expect(await count(fresh.adminUrl, "tenants")).toBe(0);
    expect(await count(fresh.adminUrl, "patients")).toBe(0);
    // The app login can read the ops records (System status) but not change them.
    await withDb(fresh.appUrl, async (db) => {
      const [{ n }] = await db`select count(*)::int as n from ops.schema_upgrades`;
      expect(n).toBe(migrationFiles().length);
      await expect(db`delete from ops.schema_upgrades`).rejects.toThrow(/permission denied/);
    });
  }, 180_000);

  it("can't be set up twice, and db/reset.sql refuses it", async () => {
    // Separate connections: a failed transaction leaves its connection unusable.
    await withDb(fresh.adminUrl, (db) =>
      expect(
        db.unsafe(liveSetupSql().replace(APP_PASSWORD_PLACEHOLDER, LOCAL_APP_PASSWORD)).simple(),
      ).rejects.toThrow(/not empty/),
    );
    const reset = readFileSync(path.resolve(__dirname, "../db/reset.sql"), "utf8");
    await withDb(fresh.adminUrl, (db) =>
      expect(
        db.unsafe(`begin;\n${transactionBody(reset, "reset")}\nrollback;`).simple(),
      ).rejects.toThrow(/LIVE database/),
    );
    expect(await count(fresh.adminUrl, "users")).toBe(1);
  }, 60_000);

  it("an upgrade with nothing new changes nothing (security re-applied as it was)", async () => {
    const before = await fingerprint(fresh.adminUrl);
    expect(await runLiveUpgrade({ adminUrl: fresh.adminUrl })).toEqual({ applied: [] });
    expect(await fingerprint(fresh.adminUrl)).toEqual(before);
  }, 120_000);

  it("upgrading an older database gives a fresh build's schema and keeps every record", async () => {
    const older = await olderDatabase("derma_live_older");
    // Not marked live yet: the upgrade refuses (this is how the demo is protected).
    await expect(runLiveUpgrade({ adminUrl: older.adminUrl })).rejects.toThrow(/not the live/);

    expect(older.applied.length).toBeGreaterThan(0);
    await withDb(older.adminUrl, (db) => db.unsafe(OPS_SQL(older.applied)).simple());
    const patients = await count(older.adminUrl, "patients");
    const notes = await count(older.adminUrl, "clinical_notes");
    expect(patients).toBeGreaterThan(0);

    const { applied } = await runLiveUpgrade({ adminUrl: older.adminUrl });
    expect(applied).toEqual(pendingMigrations(older.applied));
    expect((await liveState(older.adminUrl)).applied).toEqual(migrationFiles());
    expect(await count(older.adminUrl, "patients")).toBe(patients);
    expect(await count(older.adminUrl, "clinical_notes")).toBe(notes);

    const want = await fingerprint(fresh.adminUrl);
    const got = await fingerprint(older.adminUrl);
    want.forEach((part, i) => expect(got[i]).toEqual(part));

    // A second run finds nothing to do.
    expect(await runLiveUpgrade({ adminUrl: older.adminUrl })).toEqual({ applied: [] });
    // The app still works on it with tenant isolation: no clinic set → zero patients.
    await withDb(older.appUrl, async (db) => {
      const [{ n }] = await db`select count(*)::int as n from public.patients`;
      expect(n).toBe(0);
    });
  }, 300_000);
});

describe("Platform → System status", () => {
  const ops = {
    live: true,
    upgrades: 26,
    lastUpgradeAt: new Date("2036-06-01T08:00:00Z"),
    lastBackupAt: new Date("2036-06-01T22:10:00Z"),
    lastBackupBytes: 5 * 1_048_576,
  };
  const env = {
    BETTER_AUTH_SECRET: "x",
    DATA_ENCRYPTION_KEY: "x",
    VERIFICATION_SECRET: "x",
    CRON_SECRET: "x",
    APP_ROOT_DOMAIN: "example.sa",
  };
  const state = (checks: ReturnType<typeof statusChecks>, key: string) =>
    checks.find((c) => c.key === key)?.state;

  it("a ready live system is all green", () => {
    const c = statusChecks(ops, 0, env, new Date("2036-06-02T06:00:00Z"));
    expect(state(c, "dbLive")).toBe("info");
    expect(state(c, "backup")).toBe("ok");
    expect(state(c, "settingsOk")).toBe("ok");
    expect(state(c, "messageDemoMode")).toBe("ok");
  });

  it("flags an old backup, demo clinics, demo messaging and missing settings", () => {
    const c = statusChecks(
      ops,
      2,
      { ...env, MESSAGE_DEMO_MODE: "on", CRON_SECRET: "" },
      new Date("2036-06-04T06:00:00Z"),
    );
    expect(state(c, "backup")).toBe("bad");
    expect(state(c, "demoClinics")).toBe("warn");
    expect(state(c, "messageDemoMode")).toBe("bad");
    expect(c.find((x) => x.key === "settingsMissing")?.values?.names).toBe("CRON_SECRET");
  });

  it("the demo database only says so (no backup checks)", () => {
    const c = statusChecks({ ...ops, live: false }, 3, env);
    expect(state(c, "dbDemo")).toBe("info");
    expect(c.some((x) => x.key.startsWith("backup"))).toBe(false);
  });
});

describe("migrations keep live data", () => {
  // The live system starts from this migration; every later one runs on real data.
  const BASELINE = "0025_narrow_darkstar.sql";
  it("a newer migration that drops a table or column says why it is safe", () => {
    const later = migrationFiles().filter((f) => f > BASELINE);
    const risky = later.filter((f) => {
      const text = readFileSync(path.resolve(__dirname, "../db/migrations", f), "utf8");
      return /\bDROP\s+(TABLE|COLUMN)\b/i.test(text) && !/^-- data-safe: .+/m.test(text);
    });
    // Copy the data first (in the same migration), then add a line "-- data-safe: <why>".
    expect(risky).toEqual([]);
    expect(migrationFiles()).toContain(BASELINE);
  });
});
