/**
 * The "start over" path the founder uses on Supabase: setup → reset → setup again,
 * run as a NON-superuser admin (like Supabase's postgres user), on its own database.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { APP_PASSWORD_PLACEHOLDER, buildSetupSql, DEMO_PASSWORD_PLACEHOLDER } from "@/db/setup-sql";
import { createLocalDatabase, LOCAL_APP_PASSWORD } from "@/db/local-setup";

describe("reset then setup again", () => {
  it("leaves nothing of ours behind, and a second setup works", async () => {
    const superUrl =
      process.env.DATABASE_URL_ADMIN ?? "postgresql://postgres:localdev@127.0.0.1:5432/postgres";
    const { adminUrl } = await createLocalDatabase({
      adminUrl: superUrl,
      dbName: "derma_reset_test",
      demoPassword: "Reset-Test-123",
    });
    const db = postgres(adminUrl, { max: 1, onnotice: () => {} });
    try {
      await db.unsafe(readFileSync(path.resolve(__dirname, "../db/reset.sql"), "utf8")).simple();
      const left = await db`
        select (select count(*)::int from pg_tables where schemaname = 'public') as tables,
               (select count(*)::int from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'public' and t.typtype = 'e') as enums,
               (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public') as functions`;
      expect(left[0]).toEqual({ tables: 0, enums: 0, functions: 0 });

      const again = buildSetupSql()
        .replace(APP_PASSWORD_PLACEHOLDER, LOCAL_APP_PASSWORD)
        .replace(DEMO_PASSWORD_PLACEHOLDER, "Reset-Test-123");
      await db.unsafe(again).simple();
      // (Row counts are hidden even from the table owner by FORCE RLS, so check the tables exist.)
      const [{ n }] =
        await db`select count(*)::int as n from pg_tables where schemaname = 'public'`;
      expect(n).toBeGreaterThanOrEqual(30);
    } finally {
      await db.end();
      const su = postgres(superUrl, { max: 1, onnotice: () => {} });
      await su.unsafe("drop database if exists derma_reset_test with (force)");
      await su.end();
    }
  }, 120_000);
});
