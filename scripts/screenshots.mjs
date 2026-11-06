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
          await page.locator("header nav [aria-haspopup]").first().hover();
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
// Settings → Team, signed in as the demo admin (desktop, English).
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: BASE }]);
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill("admin@derma.demo");
  await page.locator('input[type="password"]').fill(process.env.DEMO_PASSWORD ?? "Demo-Local-2026");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  await page.goto(`${BASE}/settings?tab=team`, { waitUntil: "networkidle" });
  await page.screenshot({ path: "screenshots/team-en-desktop.png", fullPage: true });
  await page.getByTestId("team-add").click();
  await page.locator("#from-web").selectOption({ index: 2 });
  await page.locator("#email").fill("demo.doctor@derma.demo");
  await page.getByTestId("team-add-save").click();
  await page.getByTestId("team-invite-link").waitFor({ timeout: 15000 });
  await page.screenshot({ path: "screenshots/team-en-invite.png", fullPage: true });
  const url = await page.getByTestId("team-invite-link").locator("input").inputValue();
  await page.goto(url.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: "networkidle" });
  await page.screenshot({ path: "screenshots/invite-en-desktop.png", fullPage: true });
  await context.close();
} catch (e) {
  console.error("team screenshots failed:", e);
}
// Platform → Add a clinic, signed in as the platform owner (desktop, Arabic).
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: "NEXT_LOCALE", value: "ar", url: BASE }]);
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill("owner@platform.demo");
  await page.locator('input[type="password"]').fill(process.env.DEMO_PASSWORD ?? "Demo-Local-2026");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  await page.goto(`${BASE}/platform`, { waitUntil: "networkidle" });
  await page.getByTestId("clinic-add").click();
  const fill = (id, v) => page.locator(`#nc-${id}`).fill(v);
  await fill("nameAr", "عيادات النخبة");
  await fill("nameEn", "Elite Clinics");
  await fill("slug", "elite");
  await fill("branchNameAr", "فرع العليا");
  await fill("branchNameEn", "Olaya");
  await fill("cityAr", "الرياض");
  await fill("cityEn", "Riyadh");
  await fill("adminNameAr", "مدير النخبة");
  await fill("adminEmail", "admin@elite.demo");
  await page.screenshot({ path: "screenshots/platform-ar-form.png", fullPage: true });
  await page.getByTestId("clinic-add-save").click();
  await page.getByTestId("clinic-created").waitFor({ timeout: 15000 });
  await page.screenshot({ path: "screenshots/platform-ar-created.png", fullPage: true });
  await context.close();
} catch (e) {
  console.error("platform screenshots failed:", e);
}
await browser.close();
console.log("Screenshots saved in screenshots/");
