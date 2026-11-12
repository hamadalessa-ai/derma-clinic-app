/**
 * Patient walls (patient page /my). Everything runs as the restricted clinic_app role with RAW
 * SQL, so these prove the DATABASE enforces it, whatever the app code does:
 *  - a signed-in patient sees only their own rows and their family's (children they are guardian of),
 *  - never clinical notes, other patients, payments, audit logs or staff logins,
 *  - and can write nothing at all.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import postgres from "postgres";
import { closeDb } from "@/db/client";
import { withTenant } from "@/db/tenant";
import { PATIENT_READABLE_TABLES, TENANT_TABLES } from "@/db/schema";
import { demoId } from "@/db/seed-data";

const DERMA = demoId("tenant:derma");
const LAMSA = demoId("tenant:lamsa");
const pid = (file: string) => demoId(`derma:patient:${file}`);
const GUARDIAN = pid("D-0008"); // guardian of D-0039 and D-0040
const CHILD = pid("D-0039");
const SOLO = pid("D-0001"); // has clinical notes
const LAMSA_PATIENT = demoId("lamsa:patient:L-0002");

let raw: postgres.Sql;

beforeAll(() => {
  raw = postgres(inject("appUrl"), { max: 1, prepare: false, onnotice: () => {} });
});

afterAll(async () => {
  await raw.end();
  await closeDb();
});

/** Raw SQL as a signed-in patient. `roles` lets a test try to sneak extra roles in. */
async function asPatient<T>(
  patientId: string | null,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
  { tenant = DERMA, roles = "patient" } = {},
) {
  return raw.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${tenant}, true),
                    set_config('app.branch_ids', '*', true),
                    set_config('app.roles', ${roles}, true),
                    set_config('app.patient_id', ${patientId ?? ""}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

const AUTH_TABLES = [
  "users",
  "sessions",
  "accounts",
  "verifications",
  "two_factors",
  "global_rate_hits",
];
const HIDDEN = [
  ...TENANT_TABLES.filter((t) => !(PATIENT_READABLE_TABLES as readonly string[]).includes(t)),
  ...AUTH_TABLES,
];

describe("a signed-in patient (raw SQL)", () => {
  it("sees only themselves, or themselves plus the children they are guardian of", async () => {
    const solo = await asPatient(SOLO, (tx) => tx`select id from patients`);
    expect(solo.map((r) => r.id)).toEqual([SOLO]);
    const family = await asPatient(GUARDIAN, (tx) => tx`select id from patients order by id`);
    expect(new Set(family.map((r) => r.id))).toEqual(new Set([GUARDIAN, CHILD, pid("D-0040")]));
  });

  it("a child does NOT see the guardian's rows (family works one way)", async () => {
    const rows = await asPatient(CHILD, (tx) => tx`select id from patients`);
    expect(rows.map((r) => r.id)).toEqual([CHILD]);
  });

  it.each(["appointments", "patient_packages", "patient_consents"])(
    "%s: only own / family rows, even with a query that asks for everything",
    async (table) => {
      for (const [who, allowed] of [
        [SOLO, [SOLO]],
        [GUARDIAN, [GUARDIAN, CHILD, pid("D-0040")]],
      ] as const) {
        const rows = await asPatient(who, (tx) => tx`select patient_id from ${tx(table)}`);
        expect(rows.every((r) => (allowed as readonly string[]).includes(r.patient_id))).toBe(true);
        const others = await asPatient(
          who,
          (tx) =>
            tx`select count(*)::int as n from ${tx(table)} where patient_id <> all(${allowed as unknown as string[]})`,
        );
        expect(others[0].n).toBe(0);
      }
    },
  );

  it("the guardian sees the child's appointment (family on /my)", async () => {
    const rows = await asPatient(
      GUARDIAN,
      (tx) => tx`select count(*)::int as n from appointments where patient_id = ${CHILD}`,
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it.each(HIDDEN)("%s: completely invisible to a patient", async (table) => {
    const rows = await asPatient(GUARDIAN, (tx) => tx`select count(*)::int as n from ${tx(table)}`);
    expect(rows[0].n).toBe(0);
  });

  it("never sees clinical notes, even if the request also claims the practitioner role", async () => {
    // Sanity: the notes exist and a real practitioner sees them.
    const staff = await raw.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${DERMA}, true),
                      set_config('app.branch_ids', '*', true),
                      set_config('app.roles', 'practitioner', true)`;
      return tx`select count(*)::int as n from clinical_notes where patient_id = ${SOLO}`;
    });
    expect(staff[0].n).toBeGreaterThan(0);
    for (const roles of ["patient", "patient,practitioner", "practitioner,patient,clinic_admin"]) {
      const rows = await asPatient(
        SOLO,
        (tx) => tx`select count(*)::int as n from clinical_notes where patient_id = ${SOLO}`,
        { roles },
      );
      expect(rows[0].n, roles).toBe(0);
    }
  });

  it("cannot write anything: insert, update and delete are refused or change nothing", async () => {
    const tryIt = (q: (tx: postgres.TransactionSql) => Promise<postgres.RowList<postgres.Row[]>>) =>
      asPatient(SOLO, q).then(
        (r) => r.count,
        (e: Error) => e.message,
      );
    const results = [
      await tryIt((tx) => tx`update patients set full_name_ar = 'x' where id = ${SOLO}`),
      await tryIt(
        (tx) => tx`update appointments set status = 'cancelled' where patient_id = ${SOLO}`,
      ),
      await tryIt((tx) => tx`delete from patient_consents where patient_id = ${SOLO}`),
      await tryIt((tx) => tx`update tenant_settings set online_booking_enabled = false`),
      await tryIt((tx) => tx`update services set price_halalas = 1`),
      await tryIt(
        (tx) =>
          tx`insert into audit_logs (tenant_id, action, entity_type) values (${DERMA}, 'patient.hack', 'x')`,
      ),
    ];
    for (const r of results)
      expect(r === 0 || /row-level security|permission denied/.test(String(r))).toBe(true);
    // Nothing changed.
    const [p] = await asPatient(SOLO, (tx) => tx`select full_name_ar from patients`);
    expect(p.full_name_ar).not.toBe("x");
  });

  it("the patient role without a patient id sees nothing (fails closed)", async () => {
    const rows = await asPatient(null, (tx) => tx`select count(*)::int as n from patients`);
    expect(rows[0].n).toBe(0);
    const appts = await asPatient(null, (tx) => tx`select count(*)::int as n from appointments`);
    expect(appts[0].n).toBe(0);
  });

  it("a patient id from another clinic sees nothing in this clinic", async () => {
    const rows = await asPatient(
      LAMSA_PATIENT,
      (tx) => tx`select count(*)::int as n from patients`,
    );
    expect(rows[0].n).toBe(0);
    // …and in their own clinic, nothing from Derma.
    const own = await asPatient(LAMSA_PATIENT, (tx) => tx`select tenant_id from patients`, {
      tenant: LAMSA,
    });
    expect(own.map((r) => r.tenant_id)).toEqual([LAMSA]);
  });

  it("reference tables (services, branches…) stay readable for the patient page", async () => {
    for (const table of ["services", "branches", "tenant_settings", "consent_templates"]) {
      const rows = await asPatient(SOLO, (tx) => tx`select count(*)::int as n from ${tx(table)}`);
      expect(rows[0].n, table).toBeGreaterThan(0);
    }
  });
});

describe("withTenant patient context", () => {
  it("patientId and the patient role must go together", async () => {
    await expect(withTenant({ tenantId: DERMA, patientId: SOLO }, async () => 1)).rejects.toThrow(
      /go together/,
    );
    await expect(
      withTenant({ tenantId: DERMA, roles: ["patient"] }, async () => 1),
    ).rejects.toThrow(/go together/);
    await expect(
      withTenant({ tenantId: DERMA, roles: ["patient"], patientId: "nope" }, async () => 1),
    ).rejects.toThrow(/bad patientId/);
  });
});
