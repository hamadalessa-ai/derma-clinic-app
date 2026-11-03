/**
 * Automatic update of the live DEMO database (used by the "Update demo database" GitHub workflow).
 *
 * Does what the founder used to do by hand in the Supabase SQL Editor — db/reset.sql, then
 * db/setup.sql with the two passwords filled in — but as ONE transaction: it either fully
 * succeeds or changes nothing, so a failure can never leave the live demo empty.
 *
 * Demo only: it deletes all app data and rebuilds the fake demo clinics.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { APP_PASSWORD_PLACEHOLDER, DEMO_PASSWORD_PLACEHOLDER } from "./setup-sql";

const ROOT = path.resolve(__dirname, "../..");

/** The text between the file's single `begin;` line and its single `commit;` line. */
export function transactionBody(sql: string, name: string): string {
  const lines = sql.split("\n");
  const begins = lines.flatMap((l, i) => (l.trim().toLowerCase() === "begin;" ? [i] : []));
  const commits = lines.flatMap((l, i) => (l.trim().toLowerCase() === "commit;" ? [i] : []));
  if (begins.length !== 1 || commits.length !== 1 || begins[0] > commits[0]) {
    throw new Error(
      `${name} must contain exactly one "begin;" line and one "commit;" line after it`,
    );
  }
  return lines.slice(begins[0] + 1, commits[0]).join("\n");
}

/** SQL string literal content: single quotes doubled. */
function quoteInner(value: string) {
  return value.replace(/'/g, "''");
}

export function checkPasswords(appPassword: string, demoPassword: string) {
  if (!appPassword || !demoPassword) {
    throw new Error("APP_DB_PASSWORD and DEMO_STAFF_PASSWORD must both be set.");
  }
  if (appPassword.length < 16 || !/^[A-Za-z0-9_-]+$/.test(appPassword)) {
    throw new Error(
      "APP_DB_PASSWORD must be at least 16 characters, using only letters, numbers, - and _.",
    );
  }
  if (demoPassword.length < 10) {
    throw new Error("DEMO_STAFF_PASSWORD must be at least 10 characters.");
  }
}

/** One transaction: everything in reset.sql, then everything in setup.sql (passwords filled in). */
export function buildDemoUpdateSql(opts: {
  resetSql: string;
  setupSql: string;
  appPassword: string;
  demoPassword: string;
}): string {
  checkPasswords(opts.appPassword, opts.demoPassword);
  const setup = transactionBody(opts.setupSql, "db/setup.sql");
  if (
    !setup.includes(`'${APP_PASSWORD_PLACEHOLDER}'`) ||
    !setup.includes(`'${DEMO_PASSWORD_PLACEHOLDER}'`)
  ) {
    throw new Error("db/setup.sql no longer has the two CHANGE_ME_ password placeholders");
  }
  // Callback replacers, so "$" in a password is never treated as a replacement pattern.
  const filled = setup
    .replace(`'${APP_PASSWORD_PLACEHOLDER}'`, () => `'${quoteInner(opts.appPassword)}'`)
    .replace(`'${DEMO_PASSWORD_PLACEHOLDER}'`, () => `'${quoteInner(opts.demoPassword)}'`);
  return [
    "begin;",
    "-- ── db/reset.sql ──",
    transactionBody(opts.resetSql, "db/reset.sql"),
    "-- ── db/setup.sql ──",
    filled,
    "commit;",
  ].join("\n");
}

export function readDemoSqlFiles() {
  return {
    resetSql: readFileSync(path.join(ROOT, "db/reset.sql"), "utf8"),
    setupSql: readFileSync(path.join(ROOT, "db/setup.sql"), "utf8"),
  };
}

/** Runs the update as the database admin (Supabase: the "postgres" user, via the session pooler). */
export async function runDemoUpdate(opts: {
  adminUrl: string;
  appPassword: string;
  demoPassword: string;
  resetSql?: string;
  setupSql?: string;
}) {
  const files = readDemoSqlFiles();
  const sql = buildDemoUpdateSql({
    resetSql: opts.resetSql ?? files.resetSql,
    setupSql: opts.setupSql ?? files.setupSql,
    appPassword: opts.appPassword,
    demoPassword: opts.demoPassword,
  });
  const db = postgres(opts.adminUrl, { max: 1, onnotice: () => {}, prepare: false });
  try {
    await db.unsafe(sql).simple();
    const [{ n }] = await db`select count(*)::int as n from pg_tables where schemaname = 'public'`;
    return { tables: n };
  } finally {
    await db.end();
  }
}
