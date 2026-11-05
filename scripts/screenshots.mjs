// TEMPORARY (review branch only): render dermaclinics.net with JavaScript (as a visitor sees it)
// to collect its text, doctors and image addresses for the concept website.
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
const PAGES = [
  "en", "ar", "en/dermatology-aesthetic-medicin", "ar/dermatology-aesthetic-medicin",
  "en/dentistry", "ar/dentistry", "en/plastic-surgery", "ar/plastic-surgery",
  "en/ab043d79", "en/dental-care", "en/Hair%20Transplant", "en/8a0f3527",
];
mkdirSync("screenshots", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const out = [];
for (const p of PAGES) {
  try {
    await page.goto(`https://dermaclinics.net/${p}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 500) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 250));
      }
    });
    await page.waitForTimeout(1500);
    const name = p.replace(/[^a-z0-9]+/gi, "-");
    await page.screenshot({ path: `screenshots/live-${name}.png`, fullPage: true });
    const info = await page.evaluate(() => ({
      text: document.body.innerText,
      images: [...document.querySelectorAll("img")].map((i) => `${i.alt} | ${i.currentSrc || i.src}`),
      bg: [...document.querySelectorAll("*")]
        .map((e) => getComputedStyle(e).backgroundImage)
        .filter((b) => b && b !== "none" && b.includes("url")),
      links: [...document.querySelectorAll("a")].map((a) => `${a.innerText.trim()} | ${a.href}`),
    }));
    out.push(`===== ${p}\n--- TEXT\n${info.text}\n--- IMAGES\n${info.images.join("\n")}\n--- BACKGROUNDS\n${[...new Set(info.bg)].join("\n")}\n--- LINKS\n${info.links.join("\n")}\n`);
  } catch (e) {
    out.push(`===== ${p}\nERROR ${e}\n`);
  }
}
writeFileSync("screenshots/live-site.txt", out.join("\n"));
await browser.close();
