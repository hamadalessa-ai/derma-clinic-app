/**
 * "Clear demo patients": one demo clinic's patients and everything attached go; its set-up, the
 * other clinics and the audit log stay; it refuses for non-demo clinics and real patients.
 * Runs on a throwaway database built from today's setup.sql, as the NON-superuser admin.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PATIENT_DATA_TABLES, runClearDemoPatients } from "@/db/clear-demo-patients";
import { createLocalDatabase } from "@/db/local-setup";

const superUrl =
  process.env.DATABASE_URL_ADMIN ?? "postgresql://postgres:localdev@127.0.0.1:5432/postgres";
const dbName = "derma_clear_test";
let adminUrl = "";
let su: postgres.Sql;

async function count(table: string, slug: string) {
  const [{ n }] = await su.unsafe(
    `select count(*)::int as n from public.${table} x
       join public.tenants t on t.id = x.tenant_id where t.slug = $1`,
    [slug],
  );
  return n as number;
}

beforeAll(async () => {
  ({ adminUrl } = await createLocalDatabase({
    adminUrl: superUrl,
    dbName,
    demoPassword: "Demo-12345",
  }));
  // The superuser sees past RLS, to check the result.
  su = postgres(superUrl.replace(/\/[^/]*$/, `/${dbName}`), { max: 1, onnotice: () => {} });
}, 120_000);

afterAll(async () => {
  await su?.end();
  const s = postgres(superUrl, { max: 1, onnotice: () => {} });
  await s.unsafe(`drop database if exists ${dbName} with (force)`);
  await s.end();
});

describe("clear demo patients", () => {
  it("refuses an unknown or non-demo clinic and changes nothing", async () => {
    await expect(runClearDemoPatients({ adminUrl, slug: "nope" })).rejects.toThrow(/not a demo/);
    await expect(runClearDemoPatients({ adminUrl, slug: "Bad slug" })).rejects.toThrow(/bad/);
    expect(await count("patients", "derma")).toBeGreaterThan(0);
  });

  it("refuses when a patient is not marked fake, and changes nothing", async () => {
    const before = await count("patients", "lamsa");
    const [p] = await su`
      update public.patients set is_fake = false
       where id = (select x.id from public.patients x join public.tenants t on t.id = x.tenant_id
                    where t.slug = 'lamsa' limit 1)
      returning id`;
    try {
      await expect(runClearDemoPatients({ adminUrl, slug: "lamsa" })).rejects.toThrow(
        /not marked fake/,
      );
      expect(await count("patients", "lamsa")).toBe(before);
    } finally {
      await su`update public.patients set is_fake = true where id = ${p.id}`;
    }
  });

  it("empties Derma's patient data and keeps its set-up, Lamsa and the audit log", async () => {
    const lamsaBefore = await count("patients", "lamsa");
    const servicesBefore = await count("services", "derma");
    const membersBefore = await count("tenant_members", "derma");
    const auditBefore = await count("audit_logs", "derma");
    expect(await count("appointments", "derma")).toBeGreaterThan(0);

    const report = await runClearDemoPatients({ adminUrl, slug: "derma" });
    expect(report).toMatch(/cleared "derma"/);

    for (const t of PATIENT_DATA_TABLES) {
      const [{ exists }] = await su`
        select exists (select from information_schema.columns
                        where table_schema = 'public' and table_name = ${t}
                          and column_name = 'tenant_id') as exists`;
      if (!exists) continue;
      const left =
        t === "reservations"
          ? (
              await su`select count(*)::int as n from public.reservations r
                        join public.tenants x on x.id = r.tenant_id
                       where x.slug = 'derma' and r.appointment_id is not null`
            )[0].n
          : await count(t, "derma");
      expect(left, t).toBe(0);
    }
    expect(await count("patients", "lamsa")).toBe(lamsaBefore);
    expect(await count("services", "derma")).toBe(servicesBefore);
    expect(await count("tenant_members", "derma")).toBe(membersBefore);
    expect(await count("audit_logs", "derma")).toBe(auditBefore);

    // Protections are back: FORCE RLS and the append-only triggers.
    const [{ forced }] = await su`
      select bool_and(relforcerowsecurity) as forced from pg_class
       where relnamespace = 'public'::regnamespace and relname in ('patients', 'patient_consents', 'files')`;
    expect(forced).toBe(true);
    const [{ off }] = await su`
      select count(*)::int as off from pg_trigger
       where not tgisinternal and tgenabled = 'D'
         and tgrelid in ('public.patients'::regclass, 'public.patient_consents'::regclass)`;
    expect(off).toBe(0);

    // Running it again is harmless.
    expect(await runClearDemoPatients({ adminUrl, slug: "derma" })).toMatch(/cleared "derma"/);
  });
});
