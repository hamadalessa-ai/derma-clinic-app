/**
 * Builds a LOCAL database from db/setup.sql (the exact file pasted into Supabase),
 * substituting local-only passwords. Used by `pnpm db:local` and the test suite.
 *
 * To behave like Supabase, setup.sql runs as "local_admin", a NON-superuser that owns the
 * database (like Supabase's "postgres" user). The superuser is only used to create that
 * admin and the empty database.
 */
import postgres from "postgres";
import { APP_PASSWORD_PLACEHOLDER, buildSetupSql, DEMO_PASSWORD_PLACEHOLDER } from "./setup-sql";

export const LOCAL_APP_PASSWORD = "localdev-clinic-app";
const LOCAL_ADMIN = "local_admin";
const LOCAL_ADMIN_PASSWORD = "localdev-admin";

export async function createLocalDatabase(opts: {
  adminUrl: string; // superuser connection
  dbName: string;
  demoPassword: string;
  appPassword?: string;
  /** Build from this setup.sql text instead of today's (e.g. an earlier phase's). */
  setupSql?: string;
}) {
  if (!/^[a-z0-9_]+$/.test(opts.dbName)) throw new Error("bad database name");
  const su = postgres(opts.adminUrl, { max: 1, onnotice: () => {} });
  try {
    await su.unsafe(`
      do $$ begin
        if not exists (select from pg_roles where rolname = '${LOCAL_ADMIN}') then
          create role ${LOCAL_ADMIN} login password '${LOCAL_ADMIN_PASSWORD}' createrole createdb nosuperuser;
        end if;
        -- Mirror Supabase, where postgres administers the clinic_app role it created.
        if exists (select from pg_roles where rolname = 'clinic_app') then
          grant clinic_app to ${LOCAL_ADMIN} with admin option;
        end if;
      end $$;`);
    await su.unsafe(`drop database if exists ${opts.dbName} with (force)`);
    await su.unsafe(`create database ${opts.dbName} owner ${LOCAL_ADMIN}`);
  } finally {
    await su.end();
  }

  const url = new URL(opts.adminUrl);
  url.pathname = `/${opts.dbName}`;
  url.username = LOCAL_ADMIN;
  url.password = LOCAL_ADMIN_PASSWORD;
  const db = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    const sql = (opts.setupSql ?? buildSetupSql())
      .replace(APP_PASSWORD_PLACEHOLDER, opts.appPassword ?? LOCAL_APP_PASSWORD)
      .replace(DEMO_PASSWORD_PLACEHOLDER, opts.demoPassword);
    await db.unsafe(sql).simple();
  } finally {
    await db.end();
  }

  const appUrl = new URL(url);
  appUrl.username = "clinic_app";
  appUrl.password = opts.appPassword ?? LOCAL_APP_PASSWORD;
  return { adminUrl: url.toString(), appUrl: appUrl.toString() };
}
