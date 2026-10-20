/**
 * Design rule: screens never hard-code colours. Everything comes from the theme tokens
 * in src/app/globals.css, so a redesign changes the whole app from one place.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../src");
// Clinic brand colours stored as data (seed + schema default) are not design.
const SKIP_DIRS = new Set([path.join(ROOT, "db")]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (SKIP_DIRS.has(full)) return [];
    if (statSync(full).isDirectory()) return files(full);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.ts$/.test(name) ? [full] : [];
  });
}

const PALETTE =
  /\b(?:bg|text|border|ring|outline|fill|stroke|from|to|via|divide|shadow|decoration|accent|caret)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?\b/;
const RAW_COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/;

describe("theme", () => {
  const all = files(ROOT);
  const globals = path.join(ROOT, "app/globals.css");

  it("finds the source files", () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it.each(all.filter((f) => f !== globals).map((f) => [path.relative(ROOT, f), f]))(
    "%s uses theme tokens only",
    (_name, file) => {
      const lines = readFileSync(file, "utf8").split("\n");
      const bad = lines
        .map((line, i) => ({ line: line.trim(), n: i + 1 }))
        .filter(({ line }) => PALETTE.test(line) || RAW_COLOUR.test(line));
      expect(bad, "use a token from globals.css instead").toEqual([]);
    },
  );
});
