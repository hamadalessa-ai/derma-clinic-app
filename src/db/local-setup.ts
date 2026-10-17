/**
 * Builds a LOCAL database from db/setup.sql (the exact file pasted into Supabase),
 * substituting local-only passwords. Used by `pnpm db:local` and the test suite.
 */
import postgres from "postgres";
import { APP_PASSWORD_PLACEHOLDER, buildSetupSql, DEMO_PASSWORD_PLACEHOLDER } from "./setup-sql";

export const LOCAL_APP_PASSWORD = "localdev-clinic-app";

export async function createLocalDatabase(opts: {
  adminUrl: string;
  dbName: string;
  demoPassword: string;
  appPassword?: string;
}) {
  if (!/^[a-z0-9_]+$/.test(opts.dbName)) throw new Error("bad database name");
  const admin = postgres(opts.adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists ${opts.dbName} with (force)`);
    await admin.unsafe(`create database ${opts.dbName}`);
  } finally {
    await admin.end();
  }

  const url = new URL(opts.adminUrl);
  url.pathname = `/${opts.dbName}`;
  const db = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    const sql = buildSetupSql()
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
