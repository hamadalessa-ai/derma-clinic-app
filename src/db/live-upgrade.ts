/**
 * Updates the LIVE database (real clinics) to today's code WITHOUT losing data.
 * Used by the "Set up live database" and "Release to live" GitHub workflows.
 *
 * The demo is rebuilt from scratch on every change (db/reset.sql + db/setup.sql). The live
 * database never is: it remembers which migration files it already has (ops.schema_upgrades)
 * and only runs the new ones, then re-applies the security layer (db/booking.sql triggers and
 * db/rls.sql policies) so it is exactly what a fresh build would have.
 *
 *  1. A short first transaction only for `alter type … add value` lines (Postgres can't use a
 *     new enum value in the transaction that added it; adding a value alone changes nothing).
 *  2. ONE transaction for everything else: drop the app's policies and triggers, run the new
 *     migrations, record them, re-run booking.sql + rls.sql. It either fully works or changes
 *     nothing.
 *
 * Refuses on a database without ops.schema_upgrades (the demo, or an empty database) and on
 * one that has migrations this code doesn't know (the database is newer than the code).
 */
import postgres from "postgres";
import { transactionBody } from "./demo-update";
import {
  APP_PASSWORD_PLACEHOLDER,
  bookingSql,
  buildLiveSetupSql,
  LIVE_OWNER_EMAIL_PLACEHOLDER,
  LIVE_OWNER_PASSWORD_PLACEHOLDER,
  migrationFiles,
  migrationStatements,
  rlsSql,
} from "./setup-sql";

const ENUM_ADD = /^ALTER TYPE\s+\S+\s+ADD VALUE\b/i;

export class LiveDbError extends Error {}

/** Splits migration statements into enum additions (run first, on their own) and the rest. */
export function splitEnumAdditions(statements: string[]) {
  const enums: string[] = [];
  const rest: string[] = [];
  for (const s of statements) {
    if (ENUM_ADD.test(s)) {
      // Safe to repeat: "add value if not exists".
      enums.push(s.replace(/ADD VALUE\s+(?!IF NOT EXISTS)/i, "ADD VALUE IF NOT EXISTS "));
    } else rest.push(s);
  }
  return { enums, rest: rest.join("\n") };
}

export function pendingMigrations(applied: string[], files: string[] = migrationFiles()) {
  const unknown = applied.filter((a) => !files.includes(a));
  if (unknown.length) {
    throw new LiveDbError(
      `The live database has migrations this code doesn't know (${unknown.join(", ")}). ` +
        "Deploy the newer code first; never run older code against it.",
    );
  }
  return files.filter((f) => !applied.includes(f));
}

/** Drops every policy and every app trigger on the public tables (re-created by the files). */
const DROP_SECURITY = `do $drop$
declare
  r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
  for r in
    select t.tgname, c.relname from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal
  loop
    execute format('drop trigger %I on public.%I', r.tgname, r.relname);
  end loop;
end
$drop$;`;

const LIVE_GUARD = `do $guard$
begin
  if to_regclass('ops.schema_upgrades') is null then
    raise exception 'REFUSED: this is not the live database (no ops.schema_upgrades). The demo is updated by "Update demo database".';
  end if;
end
$guard$;
lock table ops.schema_upgrades in exclusive mode;`;

export function buildLiveUpgradeSql(applied: string[], files: string[] = migrationFiles()) {
  const pending = pendingMigrations(applied, files);
  const enums: string[] = [];
  const parts: string[] = [];
  for (const f of pending) {
    const split = splitEnumAdditions(migrationStatements(f));
    enums.push(...split.enums);
    parts.push(`-- ${f}\n${split.rest}`);
  }
  const enumSql = enums.length ? ["begin;", LIVE_GUARD, ...enums, "commit;"].join("\n") : null;
  const sql = [
    "begin;",
    LIVE_GUARD,
    "-- ── the security layer comes back below, exactly as in a fresh build ──",
    DROP_SECURITY,
    ...parts,
    pending.length
      ? `insert into ops.schema_upgrades (name) values ${pending.map((f) => `('${f}')`).join(", ")};`
      : "-- no new migrations",
    "-- ── db/booking.sql ──",
    bookingSql(),
    "-- ── db/rls.sql ──",
    rlsSql(),
    "grant usage on schema ops to clinic_app;",
    "grant select on ops.schema_upgrades, ops.backup_runs to clinic_app;",
    `do $$ begin
  if exists (select from pg_roles where rolname = 'backup_reader') then
    grant usage on schema ops to backup_reader;
    grant insert on ops.backup_runs to backup_reader;
  end if;
end $$;`,
    "commit;",
  ].join("\n");
  return { pending, enumSql, sql };
}

function connect(adminUrl: string) {
  return postgres(adminUrl, { max: 1, onnotice: () => {}, prepare: false });
}

/** Which migrations the live database has (empty array + `live: false` when it isn't live). */
export async function liveState(adminUrl: string) {
  const db = connect(adminUrl);
  try {
    const [{ live }] = await db`select to_regclass('ops.schema_upgrades') is not null as live`;
    if (!live) return { live: false, applied: [] as string[] };
    const rows = await db<{ name: string }[]>`select name from ops.schema_upgrades order by name`;
    return { live: true, applied: rows.map((r) => r.name) };
  } finally {
    await db.end();
  }
}

export async function runLiveUpgrade(opts: { adminUrl: string }) {
  const state = await liveState(opts.adminUrl);
  if (!state.live) {
    throw new LiveDbError(
      'REFUSED: this is not the live database (no ops.schema_upgrades). Run "Set up live database" once first.',
    );
  }
  const plan = buildLiveUpgradeSql(state.applied);
  const db = connect(opts.adminUrl);
  try {
    if (plan.enumSql) await db.unsafe(plan.enumSql).simple();
    await db.unsafe(plan.sql).simple();
  } finally {
    await db.end();
  }
  return { applied: plan.pending };
}

export function checkLiveSecrets(s: {
  appPassword: string;
  ownerEmail: string;
  ownerPassword: string;
}) {
  if (s.appPassword.length < 24 || !/^[A-Za-z0-9_-]+$/.test(s.appPassword)) {
    throw new LiveDbError(
      "LIVE_APP_DB_PASSWORD: at least 24 characters, only letters, numbers, - and _.",
    );
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.ownerEmail)) {
    throw new LiveDbError("LIVE_OWNER_EMAIL does not look like an email address.");
  }
  if (s.ownerPassword.length < 14) {
    throw new LiveDbError("LIVE_OWNER_PASSWORD must be at least 14 characters.");
  }
}

/** The live setup SQL with the three values filled in (quotes doubled; `$` is never special). */
export function filledLiveSetupSql(s: {
  appPassword: string;
  ownerEmail: string;
  ownerPassword: string;
}) {
  checkLiveSecrets(s);
  const q = (v: string) => v.replace(/'/g, "''");
  const sql = buildLiveSetupSql()
    .replace(`'${APP_PASSWORD_PLACEHOLDER}'`, () => `'${q(s.appPassword)}'`)
    .replace(`'${LIVE_OWNER_EMAIL_PLACEHOLDER}'`, () => `'${q(s.ownerEmail.trim().toLowerCase())}'`)
    .replace(`'${LIVE_OWNER_PASSWORD_PLACEHOLDER}'`, () => `'${q(s.ownerPassword)}'`);
  return `begin;\n${transactionBody(sql, "live setup")}\ncommit;`;
}

/** First-time setup of an EMPTY live database. Refuses if it already has tables. */
export async function runLiveSetup(opts: {
  adminUrl: string;
  appPassword: string;
  ownerEmail: string;
  ownerPassword: string;
}) {
  const sql = filledLiveSetupSql(opts);
  const db = connect(opts.adminUrl);
  try {
    await db.unsafe(sql).simple();
    const [{ n }] = await db`select count(*)::int as n from pg_tables where schemaname = 'public'`;
    return { tables: n };
  } finally {
    await db.end();
  }
}
