import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Refuses to run as an admin/owner login: the app must use the restricted clinic_app role
 * so Row-Level Security always applies.
 */
export function assertRestrictedRole(databaseUrl: string) {
  const user = decodeURIComponent(new URL(databaseUrl).username);
  const role = user.split(".")[0]; // Supabase pooler usernames look like "clinic_app.<project-ref>"
  if (["postgres", "supabase_admin", "service_role"].includes(role)) {
    throw new Error(
      `DATABASE_URL logs in as "${role}". The app must connect as the restricted "clinic_app" role.`,
    );
  }
}

const globalForDb = globalThis as unknown as { __db?: Database; __dbUrl?: string };

/** Lazily creates one connection pool per server instance. */
export function getDb(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (globalForDb.__db && globalForDb.__dbUrl === url) return globalForDb.__db;
  assertRestrictedRole(url);

  const client = postgres(url, {
    // Supabase's transaction pooler (port 6543) does not support prepared statements.
    prepare: false,
    max: Number(process.env.DB_POOL_MAX ?? 5),
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
  globalForDb.__db = drizzle(client, { schema });
  globalForDb.__dbUrl = url;
  return globalForDb.__db;
}

/** Closes the pool (tests and scripts only). */
export async function closeDb() {
  if (!globalForDb.__db) return;
  await globalForDb.__db.$client.end();
  globalForDb.__db = undefined;
  globalForDb.__dbUrl = undefined;
}
