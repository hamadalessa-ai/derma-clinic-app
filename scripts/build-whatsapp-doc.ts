import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildTemplatesDoc } from "../src/lib/whatsapp/templates-doc";

const file = path.resolve(import.meta.dirname, "../docs/WHATSAPP_TEMPLATES.md");
writeFileSync(file, buildTemplatesDoc());
console.log(`Wrote ${file}`);
