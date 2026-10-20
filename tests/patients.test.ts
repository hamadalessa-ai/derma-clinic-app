import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { withTenant } from "@/db/tenant";
import { demoId } from "@/db/seed-data";
import {
  getFamily,
  getPatient,
  getPatientAlerts,
  hasWarning,
  normalizePhoneQuery,
  searchPatients,
} from "@/lib/patients/queries";

const DERMA = demoId("tenant:derma");
const LAMSA = demoId("tenant:lamsa");
const search = (q: string, tenant = DERMA) => withTenant(tenant, (tx) => searchPatients(tx, q));

afterAll(closeDb);

describe("patient search", () => {
  it("finds Arabic names regardless of alef/hamza spelling", async () => {
    const withHamza = await search("أحمد");
    const without = await search("احمد");
    expect(withHamza.length).toBeGreaterThan(0);
    expect(without.map((p) => p.id)).toEqual(withHamza.map((p) => p.id));
  });

  it("treats ة and ه as the same letter", async () => {
    const a = await search("فاطمة");
    const b = await search("فاطمه");
    expect(a.length).toBeGreaterThan(0);
    expect(b.map((p) => p.id)).toEqual(a.map((p) => p.id));
  });

  it("finds English names, case-insensitive", async () => {
    const rows = await search("al-ghamdi");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((p) => /ghamdi/i.test(p.fullNameEn ?? ""))).toBe(true);
  });

  it("finds by phone, including Arabic digits and +966", async () => {
    expect((await search("0500010003")).map((p) => p.fileNumber)).toEqual(["D-0003"]);
    expect((await search("٠٥٠٠٠١٠٠٠٣")).map((p) => p.fileNumber)).toEqual(["D-0003"]);
    expect((await search("+966 500010003")).map((p) => p.fileNumber)).toEqual(["D-0003"]);
  });

  it("finds by file number", async () => {
    expect((await search("D-0012")).map((p) => p.fileNumber)).toEqual(["D-0012"]);
  });

  it("never returns another clinic's patients", async () => {
    const lamsaPhone = "0500020001";
    expect(await search(lamsaPhone, DERMA)).toHaveLength(0);
    expect((await search(lamsaPhone, LAMSA)).map((p) => p.fileNumber)).toEqual(["L-0001"]);
  });

  it("normalises phone queries", () => {
    expect(normalizePhoneQuery("٠٥٠٠ ٠١٠ ٠٠٣")).toBe("0500010003");
    expect(normalizePhoneQuery("+966-500-010-003")).toBe("0500010003");
  });
});

describe("medical alerts and family", () => {
  it("collects allergies and contraindications for warning badges", async () => {
    const ids = ["D-0001", "D-0010", "D-0002"].map((f) => demoId(`derma:patient:${f}`));
    const alerts = await withTenant(DERMA, (tx) => getPatientAlerts(tx, ids));
    expect(alerts.get(ids[0])?.allergies[0]).toContain("Lidocaine");
    expect(alerts.get(ids[1])?.medications[0]).toContain("Isotretinoin");
    expect(hasWarning(alerts.get(ids[1]))).toBe(true);
    expect(hasWarning(alerts.get(ids[2]))).toBe(false);
  });

  it("links children to one guardian", async () => {
    const family = await withTenant(DERMA, async (tx) => {
      const guardian = await getPatient(tx, demoId("derma:patient:D-0008"));
      const child = await getPatient(tx, demoId("derma:patient:D-0039"));
      return { ofGuardian: await getFamily(tx, guardian!), ofChild: await getFamily(tx, child!) };
    });
    expect(family.ofGuardian.dependants.map((p) => p.fileNumber)).toEqual(["D-0039", "D-0040"]);
    expect(family.ofChild.guardian?.fileNumber).toBe("D-0008");
    expect(family.ofChild.siblings.map((p) => p.fileNumber)).toEqual(["D-0040"]);
  });
});
