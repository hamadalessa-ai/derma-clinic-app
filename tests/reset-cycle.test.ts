/**
 * The "start over" path the founder uses on Supabase: setup → reset → setup again,
 * run as a NON-superuser admin (like Supabase's postgres user), on its own database.
 */
import { readdirSync, readFileSync } from "node:fs";
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

describe("reset refuses real patient data", () => {
  it("rolls back and keeps everything when a real (non-fake) patient exists", async () => {
    const superUrl =
      process.env.DATABASE_URL_ADMIN ?? "postgresql://postgres:localdev@127.0.0.1:5432/postgres";
    const { adminUrl } = await createLocalDatabase({
      adminUrl: superUrl,
      dbName: "derma_reset_guard_test",
      demoPassword: "Reset-Test-123",
    });
    const db = postgres(adminUrl, { max: 1, onnotice: () => {} });
    try {
      await db
        .unsafe(
          `
        alter table public.patients no force row level security;
        update public.patients set is_fake = false
          where id = (select id from public.patients order by id limit 1);
        alter table public.patients force row level security;`,
        )
        .simple();
      const before = await db`select count(*)::int as n from pg_tables where schemaname = 'public'`;
      await expect(
        db.unsafe(readFileSync(path.resolve(__dirname, "../db/reset.sql"), "utf8")).simple(),
      ).rejects.toThrow(/REFUSED: this database holds 1 real patient/);
      await db.unsafe("rollback").simple();
      const after = await db`select count(*)::int as n from pg_tables where schemaname = 'public'`;
      expect(after[0]!.n).toBe(before[0]!.n);
      // FORCE RLS is back too: the refusal rolled the guard's own change back.
      const [{ forced }] = await db`
        select relforcerowsecurity as forced from pg_class where oid = 'public.patients'::regclass`;
      expect(forced).toBe(true);
    } finally {
      await db.end();
      const su = postgres(superUrl, { max: 1, onnotice: () => {} });
      await su.unsafe("drop database if exists derma_reset_guard_test with (force)");
      await su.end();
    }
  }, 120_000);
});

/**
 * The live demo database may have been built by ANY earlier phase's setup.sql (tests/released-setup).
 * Today's reset.sql must remove everything each of them created — including tables the schema no
 * longer has — and today's setup.sql must then work.
 */
describe("reset works on a database from every released phase", () => {
  const dir = path.resolve(__dirname, "released-setup");
  const released = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  it("has the released phases to test", () => {
    expect(released).toEqual([
      "phase-0.sql",
      "phase-1.sql",
      "phase-2a.sql",
      "phase-2b-concerns.sql", // live since PR #10 (consent rules + concern actions)
      "phase-2b-push-log.sql", // live since PR #8 (push log)
      "phase-2b.sql",
    ]);
  });

  it.each(released)(
    "%s → today's reset.sql → today's setup.sql",
    async (file) => {
      const superUrl =
        process.env.DATABASE_URL_ADMIN ?? "postgresql://postgres:localdev@127.0.0.1:5432/postgres";
      const old = readFileSync(path.join(dir, file), "utf8")
        .replace(APP_PASSWORD_PLACEHOLDER, LOCAL_APP_PASSWORD)
        .replace(DEMO_PASSWORD_PLACEHOLDER, "Reset-Test-123");
      const { adminUrl } = await createLocalDatabase({
        adminUrl: superUrl,
        dbName: "derma_reset_released",
        demoPassword: "Reset-Test-123",
        setupSql: old,
      });
      const db = postgres(adminUrl, { max: 1, onnotice: () => {} });
      try {
        await db.unsafe(readFileSync(path.resolve(__dirname, "../db/reset.sql"), "utf8")).simple();
        const left = await db`
        select (select coalesce(string_agg(tablename, ', '), '') from pg_tables where schemaname = 'public') as tables,
               (select count(*)::int from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'public' and t.typtype = 'e') as enums,
               (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public') as functions`;
        expect(left[0]).toEqual({ tables: "", enums: 0, functions: 0 });
        const again = buildSetupSql()
          .replace(APP_PASSWORD_PLACEHOLDER, LOCAL_APP_PASSWORD)
          .replace(DEMO_PASSWORD_PLACEHOLDER, "Reset-Test-123");
        await db.unsafe(again).simple();
        const [{ n }] =
          await db`select count(*)::int as n from pg_tables where schemaname = 'public'`;
        expect(n).toBeGreaterThanOrEqual(40);
      } finally {
        await db.end();
        const su = postgres(superUrl, { max: 1, onnotice: () => {} });
        await su.unsafe("drop database if exists derma_reset_released with (force)");
        await su.end();
      }
    },
    180_000,
  );
});
