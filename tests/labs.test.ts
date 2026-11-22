/**
 * Lab results: flags against the range, entering and voiding reports, repeat-test requests
 * (done automatically by matching results), the lab's report file, and who may see any of it
 * (doctors and nurses only — reception, an admin alone and patients see nothing).
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { labReports } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { withActor } from "@/lib/auth/db";
import { PermissionError } from "@/lib/auth/permissions";
import { getFileStore } from "@/lib/files/store";
import {
  addLabReport,
  cancelRequest,
  flagOf,
  LabError,
  labsForPatient,
  numberIn,
  requestRepeat,
  requestState,
  voidLabReport,
} from "@/lib/labs/labs";
import { patientDbContext } from "@/lib/portal/session";
import { admin, DERMA, drSara, nurse, patient, reception } from "./fixtures";

afterAll(closeDb);

const FILE = "D-0037";
const TODAY = "2036-03-10";

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof LabError) return e.code;
    if (e instanceof PermissionError) return "not_allowed";
    throw e;
  }
  return "ok";
};

describe("values and flags (pure)", () => {
  it("reads numbers as written on reports, Arabic digits too", () => {
    expect(numberIn("12.4")).toBe(12.4);
    expect(numberIn("١٢٫٤")).toBe(12.4);
    expect(numberIn("12,4")).toBe(12.4);
    expect(numberIn("<0.5")).toBeNull();
    expect(numberIn("Negative")).toBeNull();
  });
  it("flags low / normal / high, and abnormal text results", () => {
    expect(flagOf(14, 30, 400)).toBe("low");
    expect(flagOf(182, null, 150)).toBe("high");
    expect(flagOf(38, 7, 56)).toBe("normal");
    expect(flagOf(5, null, null)).toBe("none");
    expect(flagOf(null, null, null, true)).toBe("abnormal");
  });
  it("a request is overdue, due (14 days) or later", () => {
    const r = (dueOn: string) => ({ dueOn, doneAt: null, cancelledAt: null });
    expect(requestState(r("2036-03-09"), TODAY)).toBe("overdue");
    expect(requestState(r("2036-03-20"), TODAY)).toBe("due");
    expect(requestState(r("2036-05-01"), TODAY)).toBe("later");
  });
});

describe("entering results", () => {
  let reportId = "";

  it("a repeat-test request is done when its result is entered", async () => {
    await withActor(drSara, (tx) =>
      requestRepeat(
        tx,
        drSara,
        { patientId: patient(FILE), testName: "Ferritin", dueOn: "2036-04-10" },
        TODAY,
      ),
    );
    expect(
      await code(
        withActor(drSara, (tx) =>
          requestRepeat(
            tx,
            drSara,
            { patientId: patient(FILE), testName: "TSH", dueOn: "2036-03-01" },
            TODAY,
          ),
        ),
      ),
    ).toBe("bad_date");

    const r = await withActor(nurse, (tx) =>
      addLabReport(
        tx,
        nurse,
        {
          patientId: patient(FILE),
          takenOn: "2036-03-08",
          labName: "Test Lab",
          values: [
            { testName: " ferritin ", valueText: "14", unit: "ng/mL", refLow: 30, refHigh: 400 },
            { testName: "ANA", valueText: "Negative" },
            { testName: "", valueText: "" },
          ],
        },
        TODAY,
      ),
    );
    reportId = r.report.id;
    expect(r.requestsDone).toBe(1);
    const data = await withActor(drSara, (tx) => labsForPatient(tx, drSara, patient(FILE), TODAY));
    const rep = data.reports.find((x) => x.id === reportId)!;
    expect(rep.values.map((v) => [v.testName, v.flag])).toEqual([
      ["ferritin", "low"],
      ["ANA", "none"],
    ]);
    expect(data.requests.find((q) => q.testName === "Ferritin")?.state).toBe("done");
  });

  it("refuses an empty report or a date in the future", async () => {
    const add = (takenOn: string, values: { testName: string; valueText: string }[]) =>
      code(
        withActor(drSara, (tx) =>
          addLabReport(tx, drSara, { patientId: patient(FILE), takenOn, values }, TODAY),
        ),
      );
    expect(await add("2036-03-08", [])).toBe("empty");
    expect(await add("2036-03-11", [{ testName: "TSH", valueText: "2" }])).toBe("bad_date");
  });

  it("only the lab's own report file can be attached", async () => {
    const stored = await withActor(drSara, (tx) =>
      getFileStore().put(
        { tx, tenantId: DERMA, userId: drSara.userId },
        { kind: "lab_report", mimeType: "application/pdf", data: Buffer.from("%PDF-1.4 fake") },
      ),
    );
    const r = await withActor(drSara, (tx) =>
      addLabReport(
        tx,
        drSara,
        { patientId: patient(FILE), takenOn: "2036-03-09", fileId: stored.id, values: [] },
        TODAY,
      ),
    );
    expect(r.report.fileId).toBe(stored.id);
    const sig = await withActor(drSara, (tx) =>
      getFileStore().put(
        { tx, tenantId: DERMA, userId: drSara.userId },
        { kind: "signature", mimeType: "text/plain", data: Buffer.from("x") },
      ),
    );
    expect(
      await code(
        withActor(drSara, (tx) =>
          addLabReport(
            tx,
            drSara,
            { patientId: patient(FILE), takenOn: "2036-03-09", fileId: sig.id, values: [] },
            TODAY,
          ),
        ),
      ),
    ).toBe("bad_file");
  });

  it("a mistake is voided with a reason, once; the database never lets results be edited", async () => {
    await withActor(drSara, (tx) =>
      voidLabReport(tx, drSara, { reportId, reason: "Wrong patient's sheet" }),
    );
    expect(
      await code(
        withActor(drSara, (tx) => voidLabReport(tx, drSara, { reportId, reason: "again" })),
      ),
    ).toBe("not_found");
    await expect(
      withActor(drSara, (tx) =>
        tx.execute(sql`update lab_values set value_text = '99' where report_id = ${reportId}`),
      ),
    ).rejects.toThrow();
    await expect(
      withActor(drSara, (tx) =>
        tx.execute(sql`update lab_reports set lab_name = 'Other' where id = ${reportId}`),
      ),
    ).rejects.toThrow();
  });

  it("requests can be cancelled once", async () => {
    const q = await withActor(drSara, (tx) =>
      requestRepeat(
        tx,
        drSara,
        { patientId: patient(FILE), testName: "Zinc", dueOn: "2036-06-01" },
        TODAY,
      ),
    );
    await withActor(drSara, (tx) => cancelRequest(tx, drSara, q.id));
    expect(await code(withActor(drSara, (tx) => cancelRequest(tx, drSara, q.id)))).toBe(
      "not_found",
    );
  });
});

describe("who sees lab results", () => {
  it("reception and an admin alone cannot, in code and in the database", async () => {
    for (const who of [reception, admin]) {
      expect(await code(withActor(who, (tx) => labsForPatient(tx, who, patient(FILE))))).toBe(
        "not_allowed",
      );
      const rows = await withActor(who, (tx) =>
        tx
          .select()
          .from(labReports)
          .where(eq(labReports.patientId, patient(FILE))),
      );
      expect(rows).toHaveLength(0);
    }
    expect(
      await code(
        withActor(reception, (tx) =>
          addLabReport(tx, reception, {
            patientId: patient(FILE),
            takenOn: "2026-01-01",
            values: [{ testName: "TSH", valueText: "2" }],
          }),
        ),
      ),
    ).toBe("not_allowed");
  });

  it("patients never see results through their own page", async () => {
    const rows = await withTenant(patientDbContext(DERMA, patient("D-0012")), (tx) =>
      tx.execute(sql`select id from lab_reports`),
    );
    expect(rows).toHaveLength(0);
  });

  it("demo data: D-0012 has low ferritin and an overdue repeat test", async () => {
    const data = await withActor(drSara, (tx) => labsForPatient(tx, drSara, patient("D-0012")));
    const flags = data.reports.flatMap((r) => r.values.map((v) => `${v.testName}:${v.flag}`));
    expect(flags).toEqual(expect.arrayContaining(["Ferritin:low", "Triglycerides:high"]));
    expect(data.requests.map((q) => q.state)).toContain("overdue");
  });
});
