/** docs/WHATSAPP_TEMPLATES.md must list exactly what the app sends (run `pnpm docs:whatsapp`). */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TEMPLATE_KINDS, TEMPLATES } from "@/lib/whatsapp/catalog";
import { toMetaBody } from "@/lib/whatsapp/templates-doc";

const doc = readFileSync(path.resolve(__dirname, "../docs/WHATSAPP_TEMPLATES.md"), "utf8");

describe("WhatsApp templates doc", () => {
  it.each(TEMPLATE_KINDS)("lists %s with its current wording", (kind) => {
    const t = TEMPLATES[kind];
    expect(doc).toContain(`## \`${t.metaName}\``);
    expect(doc).toContain(toMetaBody(t.bodyAr, t.variables));
    expect(doc).toContain(toMetaBody(t.bodyEn, t.variables));
  });

  it("numbers variables the way Meta expects", () => {
    expect(toMetaBody("Hi {a}, {b} and {a} {c}", ["a", "b"])).toBe("Hi {{1}}, {{2}} and {{1}} {c}");
  });
});
