// Full-page screenshots of the public pages for design review (see .github/workflows/screenshots.yml).
import { mkdirSync } from "node:fs";
import { chromium, devices } from "@playwright/test";

const BASE = process.env.SCREENSHOT_BASE_URL ?? "http://derma.localhost:3000";
const PAGES = [
  ["site", "/"],
  ["book", "/book"],
];
const VIEWS = [
  ["desktop", { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }],
  ["phone", { ...devices["iPhone 13"], deviceScaleFactor: 2 }],
];

mkdirSync("screenshots", { recursive: true });
const browser = await chromium.launch();
for (const locale of ["ar", "en"]) {
  for (const [view, options] of VIEWS) {
    const context = await browser.newContext({ ...options, timezoneId: "Asia/Riyadh" });
    await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: BASE }]);
    const page = await context.newPage();
    for (const [name, path] of PAGES) {
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      // Scroll through once so lazy-loaded photos are in before the full-page picture.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 120));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `screenshots/${name}-${locale}-${view}.png`, fullPage: true });
      // The first screen as a visitor sees it.
      await page.screenshot({ path: `screenshots/${name}-${locale}-${view}-fold.png` });
      if (name === "site") {
        // The menus: the "Medical Services" mega menu on desktop, the full menu on phones.
        if (view === "desktop") {
          await page.locator("header nav button").nth(1).hover();
          await page.waitForTimeout(400);
          await page.screenshot({ path: `screenshots/${name}-${locale}-${view}-menu.png` });
          await page.mouse.move(5, 600);
        } else {
          await page.getByTestId("site-menu").click();
          await page
            .locator("details")
            .first()
            .evaluate((d) => (d.open = true));
          await page.waitForTimeout(300);
          await page.screenshot({ path: `screenshots/${name}-${locale}-${view}-menu.png` });
          await page.keyboard.press("Escape");
          await page.reload({ waitUntil: "networkidle" });
        }
      }
    }
    await context.close();
  }
}
await browser.close();
console.log("Screenshots saved in screenshots/");
