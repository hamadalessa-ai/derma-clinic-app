import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildSetupSql } from "../src/db/setup-sql";

const out = path.resolve(__dirname, "../db/setup.sql");
writeFileSync(out, buildSetupSql());
console.log(`Wrote ${out}`);
