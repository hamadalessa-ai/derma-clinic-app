/**
 * Referee test for the PDF's Arabic/English layout: Chromium (a real browser text engine)
 * must place every character of each tricky line in the same left-to-right order as our
 * PDF layout does. Doesn't need the app server.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { TRICKY_LINES } from "../src/lib/pdf/bidi-cases";
import { visualOrder } from "../src/lib/pdf/bidi-layout";

const font = readFileSync(
  path.resolve(__dirname, "../src/lib/pdf/fonts/IBMPlexSansArabic-400.ttf"),
).toString("base64");

test.describe("PDF bidi layout matches the browser", () => {
  test.skip(({ isMobile }) => isMobile, "one run is enough");

  for (const { text, base } of TRICKY_LINES) {
    test(`${base}: ${text}`, async ({ page }) => {
      await page.setContent(`<!doctype html><html><head><style>
        @font-face { font-family: Plex; src: url(data:font/ttf;base64,${font}); }
        body { font: 24px Plex; } div { white-space: nowrap; display: inline-block; }
      </style></head><body><div id="t" dir="${base}"></div></body></html>`);
      await page.evaluate(() => document.fonts.ready);
      const centers = await page.evaluate((t) => {
        const el = document.getElementById("t")!;
        el.textContent = t;
        const node = el.firstChild!;
        return [...t].map((_, i) => {
          const r = document.createRange();
          r.setStart(node, i);
          r.setEnd(node, i + 1);
          const rect = r.getBoundingClientRect();
          return rect.left + rect.width / 2;
        });
      }, text);

      const ours = visualOrder(text, base);
      // Walking our order left to right, the browser's x positions must never go backwards
      // (equal x is allowed: Arabic ligatures such as لا share one glyph).
      const xs = ours.map((i) => centers[i]);
      const backwards = xs
        .map((x, k) => ({ k, x, prev: xs[k - 1] }))
        .filter(({ k, x, prev }) => k > 0 && x < prev - 0.5)
        .map(
          ({ k }) => `${JSON.stringify(text[ours[k - 1]])} then ${JSON.stringify(text[ours[k]])}`,
        );
      expect(
        backwards,
        "characters our PDF would draw in a different order than the browser",
      ).toEqual([]);
    });
  }
});
