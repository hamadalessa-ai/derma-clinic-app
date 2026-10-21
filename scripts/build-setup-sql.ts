import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildResetSql } from "../src/db/reset-sql";
import { buildSetupSql } from "../src/db/setup-sql";

for (const [file, sql] of [
  ["../db/setup.sql", buildSetupSql()],
  ["../db/reset.sql", buildResetSql()],
] as const) {
  const out = path.resolve(__dirname, file);
  writeFileSync(out, sql);
  console.log(`Wrote ${out}`);
}
