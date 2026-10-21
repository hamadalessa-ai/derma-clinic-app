/**
 * Clinic isolation tests. Everything here runs as the restricted clinic_app role,
 * exactly like the deployed app. Clinic A = Derma Clinics, clinic B = Lamsa Clinic.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { assertRestrictedRole, closeDb } from "@/db/client";
import { withTenant } from "@/db/tenant";
import { auditLogs, patients, rooms, TENANT_TABLES } from "@/db/schema";
import { demoId, DERMA, LAMSA } from "@/db/seed-data";

const A = demoId("tenant:derma");
const B = demoId("tenant:lamsa");
const B_PATIENT = demoId("lamsa:patient:L-0001");
const B_BRANCH = demoId("lamsa:branch:dammam");
const SEEDED_A = new Set(DERMA.patients.map((p) => demoId(`derma:patient:${p.fileNumber}`)));
const SEEDED_B = new Set(LAMSA.patients.map((p) => demoId(`lamsa:patient:${p.fileNumber}`)));

// A raw connection as clinic_app with a single connection, to prove pooled reuse is safe.
let raw: postgres.Sql;

beforeAll(() => {
  raw = postgres(inject("appUrl"), { max: 1, prepare: false, onnotice: () => {} });
});

afterAll(async () => {
  await raw.end();
  await closeDb();
});

/** Runs raw SQL as clinic_app with the clinic set, like withTenant does. */
async function rawAs<T>(tenantId: string, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  return raw.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

describe("the app role itself", () => {
  it("is not a superuser, cannot bypass RLS and owns no tables", async () => {
    const [role] = await raw`
      select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
      from pg_roles where rolname = current_user`;
    expect(role).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
    });
    const owned = await raw`
      select relname from pg_class where relowner = (select oid from pg_roles where rolname = current_user)`;
    expect(owned).toHaveLength(0);
  });

  it("every tenant table has RLS enabled AND forced", async () => {
    const rows = await raw`
      select relname, relrowsecurity, relforcerowsecurity from pg_class
      where relnamespace = 'public'::regnamespace and relname in ${raw(TENANT_TABLES)}`;
    expect(rows).toHaveLength(TENANT_TABLES.length);
    for (const r of rows)
      expect([r.relname, r.relrowsecurity, r.relforcerowsecurity]).toEqual([r.relname, true, true]);
  });

  it("refuses to start the app with an admin login", () => {
    expect(() => assertRestrictedRole("postgresql://postgres:x@db:5432/postgres")).toThrow();
    expect(() =>
      assertRestrictedRole(
        "postgresql://postgres.abcd:x@aws-0-ap-south-1.pooler.supabase.com:6543/postgres",
      ),
    ).toThrow();
    expect(() =>
      assertRestrictedRole(
        "postgresql://clinic_app.abcd:x@aws-0-ap-south-1.pooler.supabase.com:6543/postgres",
      ),
    ).not.toThrow();
  });
});

describe("without a clinic set (fail closed)", () => {
  it.each(TENANT_TABLES)("%s returns no rows", async (table) => {
    const rows = await raw`select count(*)::int as n from ${raw(table)}`;
    expect(rows[0].n).toBe(0);
  });

  it("cannot insert anything", async () => {
    await expect(
      raw`insert into patients (tenant_id, file_number, full_name_ar, phone, gender)
          values (${A}, 'X-1', 'اختبار', '0500999999', 'female')`,
    ).rejects.toThrow(/row-level security/);
  });

  it("an empty or garbage setting is still treated as 'no clinic'", async () => {
    const n = await raw.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', '', true)`;
      return (await tx`select count(*)::int as n from patients`)[0].n;
    });
    expect(n).toBe(0);
    await expect(
      raw.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', 'not-a-uuid', true)`;
        await tx`select count(*) from patients`;
      }),
    ).rejects.toThrow();
  });
});

describe("clinic A cannot READ clinic B (raw SQL through the app role)", () => {
  it("sees only its own patients", async () => {
    const rows = await rawAs(A, (tx) => tx`select id, tenant_id from patients`);
    // (Other test files may add patients; all 40 seeded ones must be there.)
    expect(rows.filter((r) => SEEDED_A.has(r.id))).toHaveLength(40);
    expect(new Set(rows.map((r) => r.tenant_id))).toEqual(new Set([A]));
  });

  it("gets nothing when asking for B's rows explicitly, by tenant or by id", async () => {
    const byTenant = await rawAs(A, (tx) => tx`select * from patients where tenant_id = ${B}`);
    const byId = await rawAs(A, (tx) => tx`select * from patients where id = ${B_PATIENT}`);
    expect(byTenant).toHaveLength(0);
    expect(byId).toHaveLength(0);
  });

  it.each(TENANT_TABLES)("%s: no rows of clinic B are visible", async (table) => {
    const rows = await rawAs(
      A,
      (tx) => tx`select count(*)::int as n from ${tx(table)} where tenant_id <> ${A}`,
    );
    expect(rows[0].n).toBe(0);
  });

  it("cannot switch off row security", async () => {
    await expect(
      rawAs(A, async (tx) => {
        await tx`set local row_security = off`;
        await tx`select * from patients`;
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot become an admin or disable RLS", async () => {
    await expect(raw`set role postgres`).rejects.toThrow();
    await expect(raw`alter table patients disable row level security`).rejects.toThrow();
    await expect(raw`alter table patients no force row level security`).rejects.toThrow();
  });
});

describe("clinic A cannot WRITE clinic B (raw SQL through the app role)", () => {
  it("cannot insert a row for clinic B", async () => {
    await expect(
      rawAs(
        A,
        (tx) => tx`
        insert into patients (tenant_id, file_number, full_name_ar, phone, gender)
        values (${B}, 'HACK-1', 'مريض مزيف', '0500999998', 'male')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("updating clinic B's rows changes nothing", async () => {
    const res = await rawAs(
      A,
      (tx) => tx`update patients set full_name_ar = 'تم الاختراق' where tenant_id = ${B}`,
    );
    expect(res.count).toBe(0);
    const still = await rawAs(
      B,
      (tx) => tx`select full_name_ar from patients where id = ${B_PATIENT}`,
    );
    expect(still[0].full_name_ar).not.toBe("تم الاختراق");
  });

  it("deleting clinic B's rows deletes nothing", async () => {
    const res = await rawAs(A, (tx) => tx`delete from patients where tenant_id = ${B}`);
    expect(res.count).toBe(0);
    const n = await rawAs(B, (tx) => tx`select count(*)::int as n from patients`);
    expect(n[0].n).toBe(8);
  });

  it("cannot move its own row into clinic B", async () => {
    await expect(
      rawAs(A, (tx) => tx`update patients set tenant_id = ${B} where file_number = 'D-0001'`),
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot attach its own row to one of clinic B's branches", async () => {
    await expect(
      rawAs(
        A,
        (tx) => tx`
        insert into rooms (tenant_id, branch_id, name_ar, name_en)
        values (${A}, ${B_BRANCH}, 'غرفة', 'Room')`,
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("cannot change the clinic directory", async () => {
    await expect(raw`update tenants set name_en = 'x'`).rejects.toThrow(/permission denied/);
    await expect(
      raw`insert into tenants (slug, name_ar, name_en) values ('evil', 'x', 'x')`,
    ).rejects.toThrow(/permission denied/);
  });

  it("cannot edit or delete the audit log, even its own", async () => {
    await expect(rawAs(A, (tx) => tx`update audit_logs set action = 'x'`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(rawAs(A, (tx) => tx`delete from audit_logs`)).rejects.toThrow(/permission denied/);
  });
});

describe("withTenant()", () => {
  it("returns only the current clinic's data", async () => {
    const a = await withTenant(A, (tx) => tx.select().from(patients));
    const b = await withTenant(B, (tx) => tx.select().from(patients));
    expect(a.filter((p) => SEEDED_A.has(p.id))).toHaveLength(40);
    expect(b.filter((p) => SEEDED_B.has(p.id))).toHaveLength(8);
    expect(a.every((p) => p.tenantId === A)).toBe(true);
    expect(b.every((p) => p.tenantId === B)).toBe(true);
  });

  it("keeps clinics apart when requests run at the same time", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => {
        const t = i % 2 === 0 ? A : B;
        return withTenant(t, async (tx) => {
          await tx.execute(sql`select pg_sleep(0.01)`);
          const rows = await tx.select({ tenantId: patients.tenantId }).from(patients);
          return { t, ok: rows.length > 0 && rows.every((r) => r.tenantId === t) };
        });
      }),
    );
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("does not leak the clinic setting to the next query on the same connection", async () => {
    await rawAs(A, (tx) => tx`select 1`);
    const after = await raw`select count(*)::int as n from patients`;
    expect(after[0].n).toBe(0);
    const setting = await raw`select current_setting('app.tenant_id', true) as v`;
    expect(setting[0].v ?? "").toBe("");
  });

  it("writes are stamped and checked against the current clinic", async () => {
    const [room] = await withTenant(A, (tx) =>
      tx
        .insert(rooms)
        .values({
          tenantId: A,
          branchId: demoId("derma:branch:riyadh"),
          nameAr: "غرفة اختبار",
          nameEn: "Test room",
        })
        .returning(),
    );
    expect(room.tenantId).toBe(A);
    const seenByB = await withTenant(B, (tx) =>
      tx.select().from(rooms).where(eq(rooms.id, room.id)),
    );
    expect(seenByB).toHaveLength(0);
    await withTenant(A, (tx) => tx.delete(rooms).where(eq(rooms.id, room.id)));
  });

  it("rejects a tenant id that is not a UUID", async () => {
    await expect(withTenant("derma", async () => 1)).rejects.toThrow(/UUID/);
    await expect(withTenant("' or 1=1 --", async () => 1)).rejects.toThrow(/UUID/);
  });

  it("rolls back everything if the work fails", async () => {
    await expect(
      withTenant(A, async (tx) => {
        await tx
          .insert(auditLogs)
          .values({ tenantId: A, action: "test.rollback", entityType: "test" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const rows = await withTenant(A, (tx) =>
      tx.select().from(auditLogs).where(eq(auditLogs.action, "test.rollback")),
    );
    expect(rows).toHaveLength(0);
  });
});

describe("every table, with real data in both clinics (full staff context)", () => {
  /**
   * Like rawAs, but also tells Postgres the user may see all branches and has all roles.
   * The user is the clinic's admin (push devices and notification choices are visible to their owner only).
   */
  async function staffAs<T>(tenantId: string, fn: (tx: postgres.TransactionSql) => Promise<T>) {
    return raw.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantId}, true),
                      set_config('app.branch_ids', '*', true),
                      set_config('app.roles', 'clinic_admin,practitioner,receptionist', true),
                      set_config('app.user_id', ${tenantId === A ? "usr_derma-admin" : "usr_lamsa-admin"}, true)`;
      return fn(tx);
    }) as Promise<T>;
  }

  it.each(TENANT_TABLES)("%s: each clinic has rows, and sees only its own", async (table) => {
    for (const [mine, other] of [
      [A, B],
      [B, A],
    ]) {
      const rows = await staffAs(mine, (tx) => tx`select tenant_id from ${tx(table)}`);
      expect(rows.length, `${table} should have demo rows for both clinics`).toBeGreaterThan(0);
      expect(rows.every((r) => r.tenant_id === mine)).toBe(true);
      const leaked = await staffAs(
        mine,
        (tx) => tx`select count(*)::int as n from ${tx(table)} where tenant_id = ${other}`,
      );
      expect(leaked[0].n).toBe(0);
    }
  });

  it.each(TENANT_TABLES)("%s: clinic A cannot change or delete clinic B's rows", async (table) => {
    const update = await staffAs(
      A,
      (tx) => tx`update ${tx(table)} set tenant_id = tenant_id where tenant_id = ${B}`,
    ).then(
      (r) => r.count,
      (e: Error) => e.message,
    );
    expect(update === 0 || /permission denied/.test(String(update))).toBe(true);
    const del = await staffAs(A, (tx) => tx`delete from ${tx(table)} where tenant_id = ${B}`).then(
      (r) => r.count,
      (e: Error) => e.message,
    );
    expect(del === 0 || /permission denied/.test(String(del))).toBe(true);
    const stillThere = await staffAs(B, (tx) => tx`select count(*)::int as n from ${tx(table)}`);
    expect(stillThere[0].n).toBeGreaterThan(0);
  });
});
