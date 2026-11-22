/**
 * Lab results: what a lab measured for a patient (blood tests before isotretinoin, hormones for
 * hair loss, biopsies…), entered by a doctor or nurse with the lab's report attached, and "repeat
 * this test by …" requests with a due date.
 *
 * Clinical: only doctors and nurses (`labs:view` / `labs:manage`, and the database policy).
 * A report is never edited: a mistake is voided with a reason and entered again. Values are
 * flagged low / normal / high against the reference range written with them. Values never go
 * into the audit log (only counts).
 */
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { files, labReports, labRequests, labValues, users } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";
import { riyadhDay } from "@/lib/booking/time";

export { LAB_PRESETS } from "./presets";

export class LabError extends Error {
  constructor(public code: "not_found" | "empty" | "bad_date" | "voided" | "bad_file") {
    super(code);
    this.name = "LabError";
  }
}

export type LabFlag = "low" | "normal" | "high" | "abnormal" | "none";

const ARABIC_DIGITS = /[٠-٩]/g;

/** The number in a written value ("12.4", "١٢٫٤", "12,4"); null for "<0.5", "Negative"… */
export function numberIn(valueText: string): number | null {
  const s = valueText
    .trim()
    .replace(ARABIC_DIGITS, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace("٫", ".")
    .replace(/^(-?\d+),(\d+)$/, "$1.$2");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Low / normal / high against the range; "abnormal" when the doctor marks a text result so. */
export function flagOf(
  value: number | null,
  low: number | null | undefined,
  high: number | null | undefined,
  abnormal = false,
): LabFlag {
  if (value === null) return abnormal ? "abnormal" : "none";
  if (low != null && value < low) return "low";
  if (high != null && value > high) return "high";
  if (low != null || high != null) return abnormal ? "abnormal" : "normal";
  return abnormal ? "abnormal" : "none";
}

const sameTest = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export interface LabValueInput {
  testName: string;
  valueText: string;
  unit?: string | null;
  refLow?: number | null;
  refHigh?: number | null;
  abnormal?: boolean;
}

export async function addLabReport(
  tx: TenantTx,
  actor: Actor,
  input: {
    patientId: string;
    appointmentId?: string | null;
    takenOn: string;
    labName?: string | null;
    note?: string | null;
    fileId?: string | null;
    values: LabValueInput[];
  },
  today = riyadhDay(new Date()),
) {
  assertCan(actor.roles, "labs:manage");
  const values = input.values.filter((v) => v.testName.trim() && v.valueText.trim());
  if (!values.length && !input.fileId) throw new LabError("empty");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.takenOn) || input.takenOn > today)
    throw new LabError("bad_date");
  if (input.fileId) {
    const [f] = await tx.select({ kind: files.kind }).from(files).where(eq(files.id, input.fileId));
    if (f?.kind !== "lab_report") throw new LabError("bad_file");
  }
  const [report] = await tx
    .insert(labReports)
    .values({
      tenantId: actor.tenantId,
      patientId: input.patientId,
      appointmentId: input.appointmentId ?? null,
      takenOn: input.takenOn,
      labName: input.labName?.trim() || null,
      note: input.note?.trim() || null,
      fileId: input.fileId ?? null,
      enteredByUserId: actor.userId,
    })
    .returning();
  if (values.length) {
    await tx.insert(labValues).values(
      values.map((v, i) => {
        const num = numberIn(v.valueText);
        return {
          tenantId: actor.tenantId,
          reportId: report.id,
          position: i,
          testName: v.testName.trim(),
          valueText: v.valueText.trim(),
          valueNum: num,
          unit: v.unit?.trim() || null,
          refLow: v.refLow ?? null,
          refHigh: v.refHigh ?? null,
          flag: flagOf(num, v.refLow, v.refHigh, v.abnormal),
        };
      }),
    );
  }
  // Open "repeat this test" requests for the same tests are done now.
  const open = await tx
    .select()
    .from(labRequests)
    .where(
      and(
        eq(labRequests.patientId, input.patientId),
        isNull(labRequests.doneAt),
        isNull(labRequests.cancelledAt),
      ),
    );
  const done = open.filter((r) => values.some((v) => sameTest(v.testName, r.testName)));
  if (done.length) {
    await tx
      .update(labRequests)
      .set({ doneReportId: report.id, doneAt: new Date() })
      .where(
        inArray(
          labRequests.id,
          done.map((r) => r.id),
        ),
      );
  }
  await audit(tx, {
    actorUserId: actor.userId,
    action: "lab.report",
    entityType: "patient",
    entityId: input.patientId,
    metadata: {
      reportId: report.id,
      values: values.length,
      file: !!input.fileId,
      requestsDone: done.length,
    },
  });
  return { report, requestsDone: done.length };
}

export async function voidLabReport(
  tx: TenantTx,
  actor: Actor,
  input: { reportId: string; reason: string },
) {
  assertCan(actor.roles, "labs:manage");
  const reason = input.reason.trim();
  if (!reason) throw new LabError("empty");
  const [row] = await tx
    .update(labReports)
    .set({ voidedAt: new Date(), voidedByUserId: actor.userId, voidReason: reason })
    .where(and(eq(labReports.id, input.reportId), isNull(labReports.voidedAt)))
    .returning();
  if (!row) throw new LabError("not_found");
  await audit(tx, {
    actorUserId: actor.userId,
    action: "lab.void",
    entityType: "patient",
    entityId: row.patientId,
    metadata: { reportId: row.id },
  });
  return row;
}

export async function requestRepeat(
  tx: TenantTx,
  actor: Actor,
  input: {
    patientId: string;
    testName: string;
    dueOn: string;
    reason?: string | null;
    appointmentId?: string | null;
  },
  today = riyadhDay(new Date()),
) {
  assertCan(actor.roles, "labs:manage");
  if (!input.testName.trim()) throw new LabError("empty");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn) || input.dueOn < today)
    throw new LabError("bad_date");
  const [row] = await tx
    .insert(labRequests)
    .values({
      tenantId: actor.tenantId,
      patientId: input.patientId,
      appointmentId: input.appointmentId ?? null,
      testName: input.testName.trim(),
      dueOn: input.dueOn,
      reason: input.reason?.trim() || null,
      requestedByUserId: actor.userId,
    })
    .returning();
  await audit(tx, {
    actorUserId: actor.userId,
    action: "lab.request",
    entityType: "patient",
    entityId: input.patientId,
    metadata: { requestId: row.id, dueOn: row.dueOn },
  });
  return row;
}

export async function cancelRequest(tx: TenantTx, actor: Actor, requestId: string) {
  assertCan(actor.roles, "labs:manage");
  const [row] = await tx
    .update(labRequests)
    .set({ cancelledAt: new Date() })
    .where(
      and(
        eq(labRequests.id, requestId),
        isNull(labRequests.doneAt),
        isNull(labRequests.cancelledAt),
      ),
    )
    .returning();
  if (!row) throw new LabError("not_found");
  await audit(tx, {
    actorUserId: actor.userId,
    action: "lab.request_cancel",
    entityType: "patient",
    entityId: row.patientId,
    metadata: { requestId: row.id },
  });
  return row;
}

export type RequestState = "overdue" | "due" | "later" | "done" | "cancelled";
/** Due = within the next 14 days. */
export function requestState(
  r: { dueOn: string; doneAt: Date | null; cancelledAt: Date | null },
  today = riyadhDay(new Date()),
): RequestState {
  if (r.doneAt) return "done";
  if (r.cancelledAt) return "cancelled";
  if (r.dueOn < today) return "overdue";
  const in14 = new Date(Date.parse(`${today}T00:00:00Z`) + 14 * 86400_000)
    .toISOString()
    .slice(0, 10);
  return r.dueOn <= in14 ? "due" : "later";
}

/** Everything for one patient: reports (newest first) with their values, and the requests. */
export async function labsForPatient(
  tx: TenantTx,
  actor: Actor,
  patientId: string,
  today = riyadhDay(new Date()),
) {
  assertCan(actor.roles, "labs:view");
  const reports = await tx
    .select({ r: labReports, enteredBy: users.name, enteredByEn: users.nameEn })
    .from(labReports)
    .leftJoin(users, eq(users.id, labReports.enteredByUserId))
    .where(eq(labReports.patientId, patientId))
    .orderBy(desc(labReports.takenOn), desc(labReports.createdAt));
  const ids = reports.map((x) => x.r.id);
  const values = ids.length
    ? await tx
        .select()
        .from(labValues)
        .where(inArray(labValues.reportId, ids))
        .orderBy(asc(labValues.position))
    : [];
  const requests = await tx
    .select()
    .from(labRequests)
    .where(eq(labRequests.patientId, patientId))
    .orderBy(asc(labRequests.dueOn));
  return {
    reports: reports.map(({ r, enteredBy, enteredByEn }) => ({
      id: r.id,
      takenOn: r.takenOn,
      labName: r.labName,
      note: r.note,
      fileId: r.fileId,
      appointmentId: r.appointmentId,
      enteredBy: enteredBy ?? "",
      enteredByEn: enteredByEn ?? null,
      voided: !!r.voidedAt,
      voidReason: r.voidReason,
      values: values
        .filter((v) => v.reportId === r.id)
        .map((v) => ({
          id: v.id,
          testName: v.testName,
          valueText: v.valueText,
          unit: v.unit,
          refLow: v.refLow,
          refHigh: v.refHigh,
          flag: v.flag as LabFlag,
        })),
    })),
    requests: requests.map((q) => ({
      id: q.id,
      testName: q.testName,
      dueOn: q.dueOn,
      reason: q.reason,
      state: requestState(q, today),
    })),
  };
}
export type LabsView = Awaited<ReturnType<typeof labsForPatient>>;
