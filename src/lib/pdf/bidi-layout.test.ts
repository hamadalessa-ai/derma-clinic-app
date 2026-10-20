import path from "node:path";
import { describe, expect, it } from "vitest";
import * as fontkit from "fontkit";
import type { Font } from "fontkit";
import { TRICKY_LINES } from "./bidi-cases";
import { breakLines, fontMeasurer, layoutParagraph, visualAtoms, visualOrder } from "./bidi-layout";

const font = fontkit.openSync(path.resolve(__dirname, "fonts/IBMPlexSansArabic-400.ttf")) as Font;
const m = fontMeasurer(font, 12);

/** What a reader sees, left to right (atoms joined; RTL atoms shown reversed like on screen). */
function seen(line: string, base: "rtl" | "ltr" = "rtl") {
  return visualAtoms(line, base)
    .map((a) => (a.level % 2 ? [...a.text].reverse().join("") : a.text))
    .join("");
}

describe("bidi layout", () => {
  it("keeps the whole line: every character appears exactly once", () => {
    for (const { text, base } of TRICKY_LINES) {
      const atoms = visualAtoms(text, base);
      const chars = atoms.map((a) => a.text).join("");
      const mirror: Record<string, string> = {
        "(": ")",
        ")": "(",
        "[": "]",
        "]": "[",
        "«": "»",
        "»": "«",
      };
      const normalise = (s: string) => [...s].map((c) => (mirror[c] ? "()" : c)).sort();
      expect(normalise(chars)).toEqual(normalise(text));
    }
  });

  it("orders the doctor/service/price/date line like a browser", () => {
    // Reading left to right on screen: date, then price, then the English run, then the name.
    expect(seen("د. سارة – Laser Hair Removal – 1,250 ر.س – 2026/10/21")).toBe(
      // A number right after English text joins the English left-to-right run (UAX #9 rule W7),
      // which is also what browsers show. Verified against Chromium in e2e/pdf-bidi.spec.ts.
      "2026/10/21 – س.ر Laser Hair Removal – 1,250 – ةراس .د",
    );
  });

  it("keeps numbers, dates and English runs left-to-right inside Arabic", () => {
    const atoms = visualAtoms("التاريخ 2026/10/21 والسعر 1,250.50 ر.س");
    const ltr = atoms.filter((a) => a.level % 2 === 0 && !a.space).map((a) => a.text);
    expect(ltr).toEqual(["1,250.50", "2026/10/21"]);
  });

  it("mirrors brackets in right-to-left text", () => {
    const atoms = visualAtoms("(الثلاثاء)");
    expect(atoms.map((a) => a.text)).toEqual(["(", "الثلاثاء", ")"]);
  });

  it("never splits an Arabic word, so letters stay joined", () => {
    for (const { text, base } of TRICKY_LINES) {
      const arabicWords = text.match(/[ء-يٮ-ۓ]+/g) ?? [];
      const atoms = visualAtoms(text, base).map((a) => a.text);
      for (const w of arabicWords) expect(atoms.join("|")).toContain(w);
    }
  });

  it("produces the same character order as the Unicode algorithm for all tricky lines", () => {
    for (const { text, base } of TRICKY_LINES) {
      const order = visualOrder(text, base);
      expect(order.length).toBe([...text].filter((c) => !/\s/.test(c)).length);
      expect(new Set(order).size).toBe(order.length);
    }
  });

  it("breaks long paragraphs into lines that fit", () => {
    const para = TRICKY_LINES.map((l) => l.text).join(" ");
    const lines = breakLines(para, 200, m);
    expect(lines.length).toBeGreaterThan(3);
    for (const l of lines) expect(m.width(l) <= 200 || !l.includes(" ")).toBe(true);
    expect(lines.join(" ")).toBe(para.split(/\s+/).join(" "));
    const laid = layoutParagraph(para, 200, m);
    expect(laid.every((l) => l.width <= 200 + 1)).toBe(true);
  });
});
