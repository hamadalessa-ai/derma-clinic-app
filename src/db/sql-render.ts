/** Tiny helpers to write INSERT statements for db/setup.sql. */
export interface RawSql {
  raw: string;
}
export type SqlValue = string | number | boolean | null | RawSql;

/** A literal SQL expression, e.g. raw("now() - interval '3 days'"). */
export const raw = (sql: string): RawSql => ({ raw: sql });

export function lit(value: SqlValue): string {
  if (value === null) return "null";
  if (typeof value === "object") return value.raw;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return `'${value.replace(/'/g, "''")}'`;
}

export function insert(table: string, rows: Record<string, SqlValue>[]) {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const values = rows.map((r) => `  (${cols.map((c) => lit(r[c])).join(", ")})`).join(",\n");
  return `insert into public.${table} (${cols.join(", ")}) values\n${values};\n`;
}
