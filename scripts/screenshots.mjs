// Full-page screenshots of the public pages for design review (see .github/workflows/screenshots.yml).
import { createHmac } from "node:crypto";
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
  // Patient flow board on the demo day (the next working day), at 1 pm on the browser's clock.
  {
    const d = new Date(Date.now() + 3 * 3600_000);
    while (d.getUTCDay() === 5) d.setUTCDate(d.getUTCDate() + 1);
    const day = d.toISOString().slice(0, 10);
    await page.clock.setFixedTime(new Date(`${day}T13:00:00+03:00`));
    await page.goto(`${BASE}/calendar?view=flow&date=${day}`, { waitUntil: "networkidle" });
    await page.screenshot({ path: "screenshots/flow-en.png", fullPage: true });
    await context.addCookies([{ name: "NEXT_LOCALE", value: "ar", url: BASE }]);
    await page.reload({ waitUntil: "networkidle" });
    await page.screenshot({ path: "screenshots/flow-ar.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "screenshots/flow-ar-phone.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: BASE }]);
  }
  await page.goto(`${BASE}/reports`, { waitUntil: "networkidle" });
  await page.screenshot({ path: "screenshots/reports-en.png", fullPage: true });
  await page.goto(`${BASE}/patients/import`, { waitUntil: "networkidle" });
  await page.screenshot({ path: "screenshots/import-en.png", fullPage: true });
  await context.addCookies([{ name: "NEXT_LOCALE", value: "ar", url: BASE }]);
  await page.goto(`${BASE}/reports`, { waitUntil: "networkidle" });
  await page.screenshot({ path: "screenshots/reports-ar.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  await page.screenshot({ path: "screenshots/reports-ar-phone.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: BASE }]);
  await page.goto(`${BASE}/setup?tab=services`, { waitUntil: "networkidle" });
  await page.screenshot({ path: "screenshots/setup-en-services.png", fullPage: true });
  await page.getByTestId("setup-edit").first().click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "screenshots/setup-en-service-dialog.png" });
  await page.keyboard.press("Escape");
  await page.goto(`${BASE}/setup?tab=rooms`, { waitUntil: "networkidle" });
  await page.screenshot({ path: "screenshots/setup-en-rooms.png", fullPage: true });
  await page.goto(`${BASE}/setup?tab=prices`, { waitUntil: "networkidle" });
  await page.screenshot({ path: "screenshots/setup-en-prices.png", fullPage: true });
  await page.goto(`${BASE}/settings?tab=subscription`, { waitUntil: "networkidle" });
  await page.screenshot({ path: "screenshots/settings-en-subscription.png", fullPage: true });
  await page.goto(`${BASE}/settings?tab=team`, { waitUntil: "networkidle" });
  await page.screenshot({ path: "screenshots/team-en-desktop.png", fullPage: true });
  // Allow platform support for 4 hours (view only).
  await page.getByTestId("support-grant").click();
  await page.getByTestId("support-end").waitFor({ timeout: 15000 });
  await page.getByTestId("support-access").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "screenshots/support-en-granted.png", fullPage: true });
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
  await page.locator("#nc-specialty").selectOption("both");
  await page.screenshot({ path: "screenshots/platform-ar-form.png", fullPage: true });
  await page.getByTestId("clinic-add-save").click();
  await page.getByTestId("clinic-created").waitFor({ timeout: 15000 });
  await page.screenshot({ path: "screenshots/platform-ar-created.png", fullPage: true });
  // Open the new clinic's card: setup checklist and status; then suspend it.
  await page.getByRole("button", { name: "تم" }).click();
  const card = page.locator('[data-testid="platform-clinic"][data-slug="elite"]');
  await card.locator("button").first().click();
  await card.getByTestId("clinic-tab-status").click();
  await card.locator("select").selectOption("suspended");
  await card.locator('input[id^="why-"]').fill("تأخر السداد منذ 1 نوفمبر");
  await page.screenshot({ path: "screenshots/platform-ar-status.png", fullPage: true });
  await card.getByTestId("clinic-status-apply").click();
  await card.getByTestId("clinic-resume").waitFor({ timeout: 15000 });
  await page.screenshot({ path: "screenshots/platform-ar-suspended.png", fullPage: true });
  // Usage and limits on Derma's card.
  const derma = page.locator('[data-testid="platform-clinic"][data-slug="derma"]');
  await derma.locator("button").first().click();
  await derma.locator('input[id^="ai-"]').fill("10");
  await derma.locator('input[id^="wa-"]').fill("2000");
  await derma.getByTestId("limits-save").click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "screenshots/platform-ar-usage.png", fullPage: true });
  await derma.getByTestId("clinic-tab-billing").click();
  await page.screenshot({ path: "screenshots/platform-ar-billing.png", fullPage: true });
  await derma.getByTestId("statement-pay").first().click();
  await derma.getByTestId("statement-pay-save").click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "screenshots/platform-ar-paid.png", fullPage: true });
  // WhatsApp connection tab (Derma is a demo clinic: details can be saved, never switched live).
  await derma.getByTestId("clinic-tab-whatsapp").click();
  await derma.getByTestId("wa-displayPhone").fill("+966 55 000 0000");
  await derma.getByTestId("wa-phoneNumberId").fill("123456789012345");
  await derma.getByTestId("whatsapp-panel").locator('button[type="submit"]').click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "screenshots/platform-ar-whatsapp.png", fullPage: true });
  // Support access that Derma's admin granted above: open the clinic (view only, recorded).
  await derma.getByTestId("clinic-tab-support").click();
  await page.screenshot({ path: "screenshots/platform-ar-support.png", fullPage: true });
  await derma.getByTestId("support-open").click();
  await page.waitForURL((u) => u.pathname.startsWith("/home"), { timeout: 20000 });
  await page.goto(`${BASE}/patients`, { waitUntil: "networkidle" });
  await page.screenshot({ path: "screenshots/support-ar-session.png", fullPage: true });
  await context.close();
} catch (e) {
  console.error("platform screenshots failed:", e);
}
// Nurse / assistant: her doctors' day, a visit she prepares, and the care team in Settings → Team.
try {
  const password = process.env.DEMO_PASSWORD ?? "Demo-Local-2026";
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: "NEXT_LOCALE", value: "ar", url: BASE }]);
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill("nurse@derma.demo");
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  // The next working day (Friday and Saturday have no demo appointments).
  const d = new Date(Date.now() + 3 * 3600_000);
  while ([5, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  await page.goto(`${BASE}/my-day?date=${d.toISOString().slice(0, 10)}`, {
    waitUntil: "networkidle",
  });
  await page.screenshot({ path: "screenshots/nurse-ar-my-day.png", fullPage: true });
  const open = page.getByTestId("open-visit").first();
  if (await open.count()) {
    await open.click();
    await page.getByTestId("visit-screen").waitFor({ timeout: 20000 });
    const start = page.getByRole("button").filter({ hasText: /تحضير الملاحظة|بدء الزيارة/ });
    if (await start.count()) {
      await start.first().click();
      await page.getByTestId("note-card").waitFor({ timeout: 20000 });
    }
    await page.screenshot({ path: "screenshots/nurse-ar-visit.png", fullPage: true });
    // Post visit: a medication order and a price-list code before posting.
    if (await page.getByTestId("visit-workspace").count()) {
      await page.getByTestId("visit-note").fill("حب شباب خفيف. الخطة كما في الأوامر.");
      await page.getByTestId("visit-orders").getByRole("button").first().click();
      await page.getByTestId("order-name").fill("Adapalene 0.1% gel");
      await page.getByTestId("order-add").click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: "screenshots/nurse-ar-post-visit.png", fullPage: true });
    }
  }
  await context.clearCookies();
  await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: BASE }]);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill("admin@derma.demo");
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  await page.goto(`${BASE}/settings?tab=team`, { waitUntil: "networkidle" });
  await page.screenshot({ path: "screenshots/team-en-care-team.png", fullPage: true });
  console.log("nurse screenshots: OK");
  await context.close();
} catch (e) {
  console.error("nurse screenshots failed:", e);
}

// Two-step verification, end to end (as a demo doctor): set it up in My account, sign out,
// sign in again with password + authenticator code.
function totp(base32Key) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of base32Key.replace(/=+$/, "").toUpperCase())
    bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, "0");
}
try {
  const password = process.env.DEMO_PASSWORD ?? "Demo-Local-2026";
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: BASE }]);
  const page = await context.newPage();
  const signIn = async () => {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.locator('input[type="email"]').fill("dr.lina@derma.demo");
    await page.locator('input[type="password"]').fill(password);
    await page.locator('button[type="submit"]').click();
  };
  await signIn();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  await page.goto(`${BASE}/account`, { waitUntil: "networkidle" });
  await page.locator("#tf-password").fill(password);
  await page.getByTestId("two-factor-setup").locator('button[type="submit"]').click();
  const key = (await page.getByTestId("two-factor-key").textContent({ timeout: 15000 })).trim();
  await page.screenshot({ path: "screenshots/two-factor-en-setup.png", fullPage: true });
  await page.getByTestId("two-factor-code").fill(totp(key));
  await page.getByTestId("two-factor-setup").locator('button[type="submit"]').click();
  await page.getByTestId("two-factor-on").waitFor({ timeout: 15000 });
  await page.screenshot({ path: "screenshots/two-factor-en-on.png", fullPage: true });
  await context.clearCookies();
  await context.addCookies([{ name: "NEXT_LOCALE", value: "ar", url: BASE }]);
  await signIn();
  await page.getByTestId("login-code").waitFor({ timeout: 15000 });
  await page.screenshot({ path: "screenshots/two-factor-ar-login-code.png", fullPage: true });
  // A new 30-second window may be needed: the code used to switch it on can't be reused.
  await page.waitForTimeout(31000);
  await page.getByTestId("login-code").fill(totp(key));
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  await page.screenshot({ path: "screenshots/two-factor-ar-signed-in.png" });
  console.log("two-step verification: OK");
  await context.close();
} catch (e) {
  console.error("two-step verification screenshots failed:", e);
}
await browser.close();
console.log("Screenshots saved in screenshots/");
