/**
 * Patient import from a spreadsheet (Excel → "CSV UTF-8"). Two steps: check (every row, with the
 * reason a row can't be imported) and import (the good rows, in one transaction). Existing
 * patients (same mobile and name, or same file number) are skipped, never overwritten. Package
 * balances come in as the clinic's package + a correction for the sessions already used.
 * Arabic or English column names; commas or semicolons.
 */
import { eq, sql } from "drizzle-orm";
import { packageSessionEvents, packageTemplates, patientPackages, patients } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";
import { nextFileNumber } from "@/lib/patients/queries";
import { normalizeSaudiMobile, westernDigits } from "@/lib/phone";
export { TEMPLATE_CSV } from "./import-template";

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 2_000_000;

/** Columns we understand, and the header names (Arabic or English) that mean them. */
export const COLUMNS = {
  fileNumber: ["file_number", "file number", "file", "رقم الملف"],
  nameAr: ["name_ar", "name", "full name", "الاسم", "الاسم بالعربي", "الاسم الكامل"],
  nameEn: ["name_en", "english name", "الاسم بالإنجليزي", "الاسم بالانجليزي"],
  phone: ["phone", "mobile", "mobile number", "الجوال", "رقم الجوال", "الهاتف"],
  gender: ["gender", "sex", "الجنس"],
  dateOfBirth: ["date_of_birth", "dob", "birth date", "تاريخ الميلاد"],
  idNumber: ["id_number", "national id", "iqama", "رقم الهوية", "الهوية"],
  email: ["email", "e-mail", "البريد", "البريد الإلكتروني"],
  package: ["package", "package_name", "الباقة"],
  sessionsUsed: ["sessions_used", "used sessions", "الجلسات المستخدمة"],
  packageBoughtOn: ["package_bought_on", "package date", "تاريخ شراء الباقة"],
} as const;
export type Column = keyof typeof COLUMNS;

// ─── CSV ────────────────────────────────────────────────────────────────────

/** RFC 4180 CSV (quotes, doubled quotes, line breaks inside quotes); comma or semicolon. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Which column holds what (unknown columns are ignored). */
export function mapHeader(header: string[]): Partial<Record<Column, number>> {
  const out: Partial<Record<Column, number>> = {};
  header.forEach((h, i) => {
    const k = (Object.keys(COLUMNS) as Column[]).find((c) =>
      (COLUMNS[c] as readonly string[]).some((alias) => norm(alias) === norm(h)),
    );
    if (k && out[k] === undefined) out[k] = i;
  });
  return out;
}

// ─── Checking rows ──────────────────────────────────────────────────────────

export type RowProblem =
  | "missing_name"
  | "bad_phone"
  | "bad_gender"
  | "bad_date"
  | "bad_email"
  | "unknown_package"
  | "bad_sessions"
  | "duplicate_in_file"
  | "already_exists";

export interface ImportRow {
  line: number; // the row in the spreadsheet (header = 1)
  fileNumber: string | null;
  nameAr: string;
  nameEn: string | null;
  phone: string;
  gender: "male" | "female";
  dateOfBirth: string | null;
  idType: "national_id" | "iqama" | "passport" | null;
  idNumber: string | null;
  email: string | null;
  package: { templateId: string; used: number; boughtOn: string | null } | null;
}

export interface ImportCheck {
  ok: ImportRow[];
  problems: { line: number; problems: RowProblem[]; name: string }[];
  missingColumns: Column[];
  total: number;
}

function gender(s: string): "male" | "female" | null {
  const v = norm(s);
  if (["male", "m", "ذكر", "رجل", "م"].includes(v)) return "male";
  if (["female", "f", "أنثى", "انثى", "امرأة", "ث"].includes(v)) return "female";
  return null;
}

/** YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY (Gregorian). */
export function isoDate(s: string): string | null {
  const v = westernDigits(s.trim());
  let y: number, m: number, d: number;
  let r = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/)))
    [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return null;
  if (y < 1900 || y > 2100) return null;
  return date.toISOString().slice(0, 10);
}

export async function checkImport(tx: TenantTx, csv: string): Promise<ImportCheck> {
  const rows = parseCsv(csv);
  const [header = [], ...body] = rows;
  const cols = mapHeader(header);
  const missingColumns = (["nameAr", "phone", "gender"] as Column[]).filter(
    (c) => cols[c] === undefined,
  );
  if (missingColumns.length) return { ok: [], problems: [], missingColumns, total: body.length };

  const existing = await tx
    .select({ phone: patients.phone, nameAr: patients.fullNameAr, file: patients.fileNumber })
    .from(patients);
  const existingKey = new Set(existing.map((p) => `${p.phone}|${norm(p.nameAr)}`));
  const existingFiles = new Set(existing.map((p) => p.file));
  const templates = await tx
    .select({
      id: packageTemplates.id,
      nameAr: packageTemplates.nameAr,
      nameEn: packageTemplates.nameEn,
      sessions: packageTemplates.sessionsCount,
    })
    .from(packageTemplates);

  const get = (r: string[], c: Column) => (cols[c] === undefined ? "" : (r[cols[c]!] ?? "").trim());
  const seen = new Set<string>();
  const ok: ImportRow[] = [];
  const problems: ImportCheck["problems"] = [];

  body.slice(0, MAX_IMPORT_ROWS).forEach((r, i) => {
    const line = i + 2;
    const p: RowProblem[] = [];
    const nameAr = get(r, "nameAr");
    if (!nameAr) p.push("missing_name");
    const phone = normalizeSaudiMobile(get(r, "phone"));
    if (!phone) p.push("bad_phone");
    const g = gender(get(r, "gender"));
    if (!g) p.push("bad_gender");
    const dobRaw = get(r, "dateOfBirth");
    const dob = dobRaw ? isoDate(dobRaw) : null;
    if (dobRaw && !dob) p.push("bad_date");
    const email = get(r, "email") || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) p.push("bad_email");
    const idNumber = westernDigits(get(r, "idNumber")) || null;
    const fileNumber = get(r, "fileNumber") || null;

    let pkg: ImportRow["package"] = null;
    const pkgName = get(r, "package");
    if (pkgName) {
      const tpl = templates.find(
        (t) => norm(t.nameAr) === norm(pkgName) || norm(t.nameEn) === norm(pkgName),
      );
      if (!tpl) p.push("unknown_package");
      const usedRaw = westernDigits(get(r, "sessionsUsed")) || "0";
      const used = Number(usedRaw);
      if (!Number.isInteger(used) || used < 0 || (tpl && used > tpl.sessions))
        p.push("bad_sessions");
      const boughtRaw = get(r, "packageBoughtOn");
      const boughtOn = boughtRaw ? isoDate(boughtRaw) : null;
      if (boughtRaw && !boughtOn) p.push("bad_date");
      if (tpl) pkg = { templateId: tpl.id, used: Number.isInteger(used) ? used : 0, boughtOn };
    }

    const key = `${phone}|${norm(nameAr)}`;
    if (phone && nameAr) {
      if (existingKey.has(key) || (fileNumber && existingFiles.has(fileNumber)))
        p.push("already_exists");
      else if (seen.has(key) || (fileNumber && seen.has(`file:${fileNumber}`)))
        p.push("duplicate_in_file");
    }
    if (p.length) {
      problems.push({ line, problems: [...new Set(p)], name: nameAr });
      return;
    }
    seen.add(key);
    if (fileNumber) seen.add(`file:${fileNumber}`);
    ok.push({
      line,
      fileNumber,
      nameAr,
      nameEn: get(r, "nameEn") || null,
      phone: phone!,
      gender: g!,
      dateOfBirth: dob,
      idType: idNumber
        ? idNumber.startsWith("1")
          ? "national_id"
          : idNumber.startsWith("2")
            ? "iqama"
            : "passport"
        : null,
      idNumber,
      email,
      package: pkg,
    });
  });
  return { ok, problems, missingColumns: [], total: body.length };
}

// ─── Importing ──────────────────────────────────────────────────────────────

export async function runImport(
  tx: TenantTx,
  actor: Actor,
  csv: string,
  opts: { filePrefix: string; isDemo: boolean },
) {
  assertCan(actor.roles, "patients:import");
  const check = await checkImport(tx, csv);
  if (check.missingColumns.length)
    return { imported: 0, packages: 0, skipped: check.problems.length, check };
  let packages = 0;
  for (const r of check.ok) {
    const [p] = await tx
      .insert(patients)
      .values({
        tenantId: actor.tenantId,
        fileNumber: r.fileNumber ?? (await nextFileNumber(tx, opts.filePrefix)),
        fullNameAr: r.nameAr,
        fullNameEn: r.nameEn,
        phone: r.phone,
        gender: r.gender,
        dateOfBirth: r.dateOfBirth,
        idType: r.idType,
        idNumber: r.idNumber,
        email: r.email,
        // A demo clinic only ever holds fake data.
        isFake: opts.isDemo,
        createdVia: "reception",
      })
      .returning({ id: patients.id });
    if (r.package) {
      const [tpl] = await tx
        .select()
        .from(packageTemplates)
        .where(eq(packageTemplates.id, r.package.templateId));
      const bought = r.package.boughtOn
        ? new Date(`${r.package.boughtOn}T12:00:00+03:00`)
        : new Date();
      const [pkg] = await tx
        .insert(patientPackages)
        .values({
          tenantId: actor.tenantId,
          patientId: p.id,
          templateId: tpl.id,
          serviceId: tpl.serviceId,
          nameAr: tpl.nameAr,
          nameEn: tpl.nameEn,
          sessionsTotal: tpl.sessionsCount,
          priceHalalas: tpl.priceHalalas,
          purchasedAt: bought,
          expiresAt: new Date(bought.getTime() + tpl.validityDays * 86400_000),
          soldBy: actor.userId,
        })
        .returning({ id: patientPackages.id });
      if (r.package.used > 0) {
        // Sessions already used before the clinic moved to us: one correction, with its reason.
        await tx.insert(packageSessionEvents).values({
          tenantId: actor.tenantId,
          patientPackageId: pkg.id,
          kind: "override",
          delta: r.package.used,
          reason: "Imported from the previous system",
          createdBy: actor.userId,
        });
      }
      packages++;
    }
  }
  // Counts only: no names or numbers in the log.
  await audit(tx, {
    actorUserId: actor.userId,
    action: "patients.import",
    entityType: "patient",
    entityId: null,
    metadata: { imported: check.ok.length, packages, skipped: check.problems.length },
  });
  return { imported: check.ok.length, packages, skipped: check.problems.length, check };
}

/** How many patients the clinic has (shown before importing). */
export async function patientCount(tx: TenantTx) {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(patients);
  return Number(r?.n ?? 0);
}
