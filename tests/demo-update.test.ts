/**
 * The automatic live-demo update (GitHub workflow "Update demo database"):
 * reset + setup in ONE transaction, run as a NON-superuser admin like Supabase's postgres user.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import {
  buildDemoUpdateSql,
  checkPasswords,
  runDemoUpdate,
  transactionBody,
} from "@/db/demo-update";
import { createLocalDatabase, LOCAL_APP_PASSWORD } from "@/db/local-setup";
import { APP_PASSWORD_PLACEHOLDER, DEMO_PASSWORD_PLACEHOLDER } from "@/db/setup-sql";

const superUrl =
  process.env.DATABASE_URL_ADMIN ?? "postgresql://postgres:localdev@127.0.0.1:5432/postgres";
const files = {
  resetSql: readFileSync(path.resolve(__dirname, "../db/reset.sql"), "utf8"),
  setupSql: readFileSync(path.resolve(__dirname, "../db/setup.sql"), "utf8"),
};

describe("building the update SQL", () => {
  it("wraps reset + setup in exactly one transaction", () => {
    const sql = buildDemoUpdateSql({
      ...files,
      appPassword: "A".repeat(20),
      demoPassword: "Demo-12345",
    });
    const lines = sql.split("\n").map((l) => l.trim().toLowerCase());
    expect(lines.filter((l) => l === "begin;")).toHaveLength(1);
    expect(lines.filter((l) => l === "commit;")).toHaveLength(1);
    expect(lines[0]).toBe("begin;");
    expect(lines.at(-1)).toBe("commit;");
    expect(sql).not.toContain("CHANGE_ME_APP_DB_PASSWORD'");
    expect(sql.indexOf("drop table if exists")).toBeLessThan(
      sql.indexOf("create temp table setup_params"),
    );
  });

  it("quotes the demo password safely ($ and ' included)", () => {
    const sql = buildDemoUpdateSql({
      ...files,
      appPassword: "A".repeat(20),
      demoPassword: "Pa$$'w$&rd-1",
    });
    expect(sql).toContain("'Pa$$''w$&rd-1'");
  });

  it("refuses weak or unsafe passwords before touching the database", () => {
    expect(() => checkPasswords("short", "Demo-12345")).toThrow(/APP_DB_PASSWORD/);
    expect(() => checkPasswords("has spaces in it 1234", "Demo-12345")).toThrow(/APP_DB_PASSWORD/);
    expect(() => checkPasswords("A".repeat(20), "short")).toThrow(/DEMO_STAFF_PASSWORD/);
    expect(() => checkPasswords("", "")).toThrow(/must both be set/);
  });

  it("refuses files that are not a single transaction", () => {
    expect(() => transactionBody("select 1;", "x.sql")).toThrow(/exactly one/);
    expect(() => transactionBody("begin;\nbegin;\ncommit;", "x.sql")).toThrow(/exactly one/);
  });
});

describe("updating a live demo database", () => {
  // The setup.sql the live demo runs today (newest file in tests/released-setup).
  const latest = "phase-2b-concerns.sql";
  it("tests against a released snapshot that exists", () => {
    expect(readdirSync(path.resolve(__dirname, "released-setup"))).toContain(latest);
  });

  async function liveCopy(dbName: string) {
    const old = readFileSync(path.resolve(__dirname, "released-setup", latest), "utf8")
      .replace(APP_PASSWORD_PLACEHOLDER, LOCAL_APP_PASSWORD)
      .replace(DEMO_PASSWORD_PLACEHOLDER, "Old-Demo-123");
    return createLocalDatabase({
      adminUrl: superUrl,
      dbName,
      demoPassword: "Old-Demo-123",
      setupSql: old,
    });
  }
  async function drop(dbName: string) {
    const su = postgres(superUrl, { max: 1, onnotice: () => {} });
    await su.unsafe(`drop database if exists ${dbName} with (force)`);
    await su.end();
  }
  async function canLogin(adminUrl: string, password: string) {
    const url = new URL(adminUrl);
    url.username = "clinic_app";
    url.password = password;
    const db = postgres(url.toString(), { max: 1, onnotice: () => {}, connect_timeout: 5 });
    try {
      await db`select 1`;
      return true;
    } catch {
      return false;
    } finally {
      await db.end();
    }
  }

  it("rebuilds the demo with the new passwords, and can run twice", async () => {
    const dbName = "derma_update_ok";
    const { adminUrl } = await liveCopy(dbName);
    try {
      const newApp = "New-App-Password-2026";
      const first = await runDemoUpdate({
        adminUrl,
        appPassword: newApp,
        demoPassword: "New-Demo-$'1",
      });
      expect(first.tables).toBeGreaterThanOrEqual(40);
      expect(await canLogin(adminUrl, newApp)).toBe(true);
      expect(await canLogin(adminUrl, LOCAL_APP_PASSWORD)).toBe(false);

      const su = postgres(superUrl.replace(/\/[^/]*$/, `/${dbName}`), {
        max: 1,
        onnotice: () => {},
      });
      try {
        const [{ ok, total }] = await su`
            select count(*)::int as total,
                   sum((password = extensions.crypt(${"New-Demo-$'1"}, password))::int)::int as ok
            from public.accounts where provider_id = 'credential'`;
        expect(total).toBeGreaterThan(0);
        expect(ok).toBe(total);
      } finally {
        await su.end();
      }

      const second = await runDemoUpdate({
        adminUrl,
        appPassword: newApp,
        demoPassword: "New-Demo-$'1",
      });
      expect(second.tables).toBe(first.tables);
    } finally {
      await drop(dbName);
    }
  }, 180_000);

  it("changes nothing when something fails half-way", async () => {
    const dbName = "derma_update_fail";
    const { adminUrl } = await liveCopy(dbName);
    try {
      const broken = transactionBody(files.setupSql, "db/setup.sql") + "\nselect 1/0;";
      await expect(
        runDemoUpdate({
          adminUrl,
          appPassword: "Another-App-Pass-2026",
          demoPassword: "Another-Demo-1",
          setupSql: `begin;\n${broken}\ncommit;`,
        }),
      ).rejects.toThrow(/division by zero/);
      // The reset part was rolled back too: the old database and the old password still work.
      expect(await canLogin(adminUrl, LOCAL_APP_PASSWORD)).toBe(true);
      const db = postgres(adminUrl, { max: 1, onnotice: () => {} });
      try {
        const [{ n }] =
          await db`select count(*)::int as n from pg_tables where schemaname = 'public'`;
        expect(n).toBeGreaterThanOrEqual(40);
      } finally {
        await db.end();
      }
    } finally {
      await drop(dbName);
    }
  }, 180_000);
});
