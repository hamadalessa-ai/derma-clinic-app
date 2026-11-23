// Films the LIVE demo for the pitch video: every step a patient, the AI receptionist, a doctor and
// the clinic owner would see, as JPEG pictures (pitch/shots/*.jpg). Run by .github/workflows/pitch-video.yml.
// Each scene is independent: if one fails, its error picture is saved and the others still run.
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, devices } from "@playwright/test";

const BASE = process.env.PITCH_BASE_URL ?? "https://derma-clinic-app.vercel.app";
const PASSWORD = process.env.DEMO_STAFF_PASSWORD;
const OUT = "pitch/shots";
mkdirSync(OUT, { recursive: true });
const log = [];
const note = (s) => {
  console.log(s);
  log.push(s);
};

// The full iPhone screen (no browser bars), so pictures fill the phone frame in the video.
const PHONE = { ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 };
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const stamp = Date.now().toString().slice(-6);
const PATIENT_PHONE = `0559${stamp}`;
const AI_PHONE = `0558${stamp}`;

const browser = await chromium.launch();

async function context(kind) {
  const ctx = await browser.newContext({
    ...(kind === "phone" ? PHONE : DESKTOP),
    locale: "ar-SA",
    timezoneId: "Asia/Riyadh",
  });
  await ctx.addCookies([{ name: "NEXT_LOCALE", value: "ar", url: BASE }]);
  return ctx;
}

async function shot(page, name, opts = {}) {
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(opts.wait ?? 400);
  const target = opts.locator ?? page;
  await target.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 92, ...(opts.full ? { fullPage: true } : {}) });
  note(`shot ${name}`);
}

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
}

async function scene(name, fn) {
  const started = Date.now();
  try {
    await fn();
    note(`OK ${name} (${Math.round((Date.now() - started) / 1000)}s)`);
  } catch (e) {
    note(`FAILED ${name}: ${String(e).split("\n")[0]}`);
    for (const p of browser.contexts().flatMap((c) => c.pages())) {
      await p.screenshot({ path: `${OUT}/error-${name}-${Math.random().toString(36).slice(2, 6)}.jpg`, type: "jpeg", quality: 70 }).catch(() => {});
    }
  } finally {
    for (const c of browser.contexts()) await c.close().catch(() => {});
  }
}

/** Scrolls an element to the top of the screen (under the sticky header). */
async function scrollTo(page, selector, offset = 0) {
  await page.evaluate(
    ([sel, off]) => {
      const el = document.querySelector(sel);
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - off);
    },
    [selector, offset],
  );
  await page.waitForTimeout(900);
}

/** Admin → Settings → Demo tools → "Refresh demo week": a clean week around today, test bookings cancelled. */
async function refreshDemoWeek(tag) {
  const ctx = await context("desktop");
  const page = await ctx.newPage();
  await login(page, "admin@derma.demo");
  await page.goto(BASE + "/settings?tab=demo", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "تحديث الأسبوع التجريبي" }).click();
  await page.getByText(/تم نقل/).waitFor({ timeout: 30000 });
  note(`${tag}: ${(await page.getByText(/تم نقل/).innerText()).trim()}`);
}
await scene("prepare", () => refreshDemoWeek("refresh before filming"));

// ── 1. The clinic's website ──────────────────────────────────────────────────
await scene("website", async () => {
  const ctx = await context("phone");
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  // Load lazy photos once.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 150));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState("networkidle");
  await shot(page, "site-hero", { wait: 1200 });
  await shot(page, "site-full", { full: true });
  await scrollTo(page, "#departments", 70);
  await shot(page, "site-chapters");
  await scrollTo(page, "#doctors", 70);
  await shot(page, "site-doctors");
  await scrollTo(page, "#offers", 70);
  await shot(page, "site-offers");

  const desk = await context("desktop");
  const d = await desk.newPage();
  await d.goto(BASE + "/", { waitUntil: "networkidle" });
  await shot(d, "site-desktop", { wait: 1500 });
  // The clinic's logo on a transparent background, large, for the opening and closing cards.
  const logoUrl = await d.locator('[data-slot="logo"]').first().getAttribute("src");
  const lp = await desk.newPage();
  await lp.setContent(
    `<html><body style="margin:0;background:transparent"><img id="l" src="${logoUrl}" style="height:300px"></body></html>`,
  );
  await lp.waitForFunction(() => document.getElementById("l").complete);
  await lp.locator("#l").screenshot({ path: `${OUT}/logo.png`, omitBackground: true });
  note("shot logo");
});

// ── 2. Booking from the phone (times first; mobile + code only to confirm) ─────
let bookedName = "ريم العتيبي";
const VIDEO_NAME = "منى الحربي";
const VIDEO_PHONE = `0557${stamp}`;
const TOMORROW = new Date(Date.now() + (3 + 24) * 3600_000).toISOString().slice(0, 10);

/** Picks a day (tomorrow if it has free times, else the first that does) and a time. */
async function pickTime(page, prefix, shotIt) {
  const preferred = page.locator(`[data-day="${TOMORROW}"]:not([disabled])`);
  if (await preferred.isVisible().catch(() => false)) {
    await preferred.click();
    await page.waitForTimeout(2500);
  }
  const days = page.locator("[data-day]:not([disabled])");
  const n = (await page.locator("[data-time]").first().isVisible().catch(() => false)) ? 0 : await days.count();
  for (let i = 0; i < n; i++) {
    await days.nth(i).click();
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="times"]')?.textContent?.match(/جار|Loading/),
      null,
      { timeout: 20000 },
    );
    if (await page.locator("[data-time]").first().isVisible().catch(() => false)) break;
  }
  await page.getByTestId("times").scrollIntoViewIfNeeded();
  if (shotIt) await shot(page, `${prefix}-times`);
  const times = page.locator("[data-time]");
  await times.nth(Math.min(2, (await times.count()) - 1)).click();
  await page.waitForTimeout(600);
}

/** Name, mobile, code (shown on screen in the demo), confirm. */
async function confirmBooking(page, prefix, name, phone, gender, shotIt) {
  await page.locator("#fullName").fill(name);
  await page.locator(`input[name="patientGender"][value="${gender}"]`).check();
  const optIn = page.getByTestId("whatsapp-opt-in");
  if (!(await optIn.isChecked().catch(() => true))) await optIn.check();
  await page.locator("#phone").fill(phone);
  await page.getByTestId("send-code").scrollIntoViewIfNeeded();
  if (shotIt) await shot(page, `${prefix}-details`);
  await page.getByTestId("send-code").click();
  await page.getByTestId("demo-code").waitFor({ timeout: 20000 });
  const code = ((await page.getByTestId("demo-code").innerText()).match(/\d{6}/) ?? [""])[0];
  await page.locator("#code").fill(code);
  await page.getByTestId("confirm").scrollIntoViewIfNeeded();
  if (shotIt) await shot(page, `${prefix}-code`);
  await page.getByTestId("confirm").click();
  await page.getByTestId("booking-done").waitFor({ timeout: 30000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  if (shotIt) await shot(page, `${prefix}-done`, { wait: 1000 });
}

await scene("booking", async () => {
  const ctx = await context("phone");
  const page = await ctx.newPage();
  // From the clinic's website: its "Book an appointment" button.
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.getByTestId("hero-book").click();
  await page.getByTestId("online-booking").waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  await shot(page, "book-1-start");
  if (await page.getByTestId("mode-clinic").isVisible().catch(() => false)) {
    await page.getByTestId("mode-clinic").click();
  }
  const branch = page.getByTestId("step-branch").getByRole("button").first();
  if (await branch.isVisible().catch(() => false)) await branch.click();
  await page.waitForTimeout(600);
  await page.getByTestId("step-service").scrollIntoViewIfNeeded();
  await shot(page, "book-2-service");
  const laser = page.locator("[data-service]", { hasText: /ليزر|إزالة الشعر/ }).first();
  if (await laser.isVisible().catch(() => false)) await laser.click();
  else await page.locator("[data-service]").first().click();
  await page.waitForTimeout(800);
  if (await page.getByTestId("doctor-female").isVisible().catch(() => false)) {
    await page.getByTestId("step-doctor").scrollIntoViewIfNeeded();
    await shot(page, "book-3-doctor");
    await page.getByTestId("doctor-female").click();
  } else if (await page.getByTestId("doctor-any").isVisible().catch(() => false)) {
    await page.getByTestId("doctor-any").click();
  }
  await page.waitForTimeout(800);
  await pickTime(page, "book-4", true);
  await confirmBooking(page, "book-5", bookedName, PATIENT_PHONE, "female", true);
});

// ── 2b. A video consultation booked the same way (its link arrives on WhatsApp) ──
await scene("video-booking", async () => {
  const ctx = await context("phone");
  const page = await ctx.newPage();
  await page.goto(BASE + "/book", { waitUntil: "networkidle" });
  await page.getByTestId("mode-video").click();
  await page.waitForTimeout(600);
  await shot(page, "vc-0-mode");
  const branch = page.getByTestId("step-branch").getByRole("button").first();
  if (await branch.isVisible().catch(() => false)) await branch.click();
  await page.waitForTimeout(600);
  // One video service: it is chosen already.
  const svc = page.locator("[data-service]").first();
  if (await svc.isVisible().catch(() => false)) await svc.click();
  await page.waitForTimeout(800);
  // Dr. Sarah if she offers it (she films the doctor's side), else any doctor.
  const sara = page.locator("[data-doctor]", { hasText: /سارة/ }).first();
  if (await sara.isVisible().catch(() => false)) await sara.click();
  else if (await page.getByTestId("doctor-any").isVisible().catch(() => false)) await page.getByTestId("doctor-any").click();
  await page.waitForTimeout(800);
  await pickTime(page, "vc-1", false);
  await confirmBooking(page, "vc-1", VIDEO_NAME, VIDEO_PHONE, "female", false);
  await shot(page, "vc-1-done", { wait: 800 });
});

let conversationUrl = null;
await scene("whatsapp", async () => {
  const ctx = await context("desktop");
  const page = await ctx.newPage();
  await login(page, "admin@derma.demo");
  await page.goto(BASE + "/whatsapp/simulator", { waitUntil: "networkidle" });
  const conv = page.getByTestId("conversation").filter({ hasText: bookedName }).first();
  await conv.waitFor({ timeout: 30000 });
  await conv.click();
  await page.getByTestId("patient-view-link").waitFor();
  conversationUrl = BASE + (await page.getByTestId("patient-view-link").getAttribute("href"));
  // Reminders now (demo: 24 hours ahead, quiet hours ignored).
  await page.getByTestId("fast-forward").check();
  await page.getByTestId("ignore-quiet").check();
  await page.getByTestId("run-now-button").click();
  await page.waitForTimeout(4000);
  await shot(page, "wa-desktop");

  // The patient's phone (the same session; the patient view is staff-only in the demo).
  const phone = await browser.newContext({ ...PHONE, locale: "ar-SA", timezoneId: "Asia/Riyadh", storageState: await ctx.storageState() });
  const p = await phone.newPage();
  await p.goto(conversationUrl, { waitUntil: "networkidle" });
  await p.evaluate(() => window.scrollTo(0, 0));
  await shot(p, "wa-1-confirmation", { wait: 800 });
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot(p, "wa-2-reminder", { wait: 800 });
  // The consent link in the messages, opened like the patient would.
  const link = await p.locator('a[href*="/sign/"]').last().getAttribute("href").catch(() => null);
  note(`consent link: ${link ? "found" : "none"}`);
  if (link) {
    const pc = await context("phone");
    const s = await pc.newPage();
    await s.goto(link.startsWith("http") ? link : BASE + link, { waitUntil: "networkidle" });
    await shot(s, "consent-1-open");
    const canvas = s.locator("canvas").first();
    await canvas.scrollIntoViewIfNeeded();
    await shot(s, "consent-2-pad");
    const box = await canvas.boundingBox();
    if (box) {
      // A flowing handwritten-looking stroke.
      const y = box.y + box.height * 0.55;
      await s.mouse.move(box.x + box.width * 0.15, y);
      await s.mouse.down();
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        await s.mouse.move(
          box.x + box.width * (0.15 + 0.7 * t),
          y + Math.sin(t * Math.PI * 3) * box.height * 0.18 - t * box.height * 0.1,
        );
      }
      await s.mouse.up();
    }
    const agree = s.getByTestId("sign-agree");
    if (await agree.isVisible().catch(() => false)) await agree.check();
    await shot(s, "consent-3-signed");
    await s.getByTestId("sign-submit").click();
    await s.getByTestId("sign-done").waitFor({ timeout: 20000 });
    await shot(s, "consent-4-done", { wait: 800 });
  }
});

// ── 4. The video consultation: the link from WhatsApp, the patient's page, the doctor's side ──
await scene("video", async () => {
  const ctx = await context("desktop");
  const page = await ctx.newPage();
  await login(page, "admin@derma.demo");
  await page.goto(BASE + "/whatsapp/simulator", { waitUntil: "networkidle" });
  const conv = page.getByTestId("conversation").filter({ hasText: VIDEO_NAME }).first();
  await conv.waitFor({ timeout: 30000 });
  await conv.click();
  await page.getByTestId("patient-view-link").waitFor();
  const url = BASE + (await page.getByTestId("patient-view-link").getAttribute("href"));
  const phone = await browser.newContext({ ...PHONE, locale: "ar-SA", timezoneId: "Asia/Riyadh", storageState: await ctx.storageState() });
  const p = await phone.newPage();
  await p.goto(url, { waitUntil: "networkidle" });
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot(p, "vc-2-whatsapp", { wait: 800 });
  const link = await p.locator('a[href*="/visit/"]').last().getAttribute("href").catch(() => null);
  note(`video link: ${link ? "found" : "none"}`);
  if (link) {
    const pc = await context("phone");
    const v = await pc.newPage();
    await v.goto(link.startsWith("http") ? link : BASE + link, { waitUntil: "networkidle" });
    await shot(v, "vc-3-patient", { wait: 1000 });
  }
  // The doctor's day with the video visit, and its visit screen.
  const dc = await context("phone");
  const d = await dc.newPage();
  await login(d, "dr.sara@derma.demo");
  await d.goto(`${BASE}/my-day?date=${TOMORROW}`, { waitUntil: "networkidle" });
  const card = d.getByTestId("my-day-card").filter({ hasText: VIDEO_NAME }).first();
  if (await card.isVisible().catch(() => false)) {
    await card.scrollIntoViewIfNeeded();
    await shot(d, "vc-4-doctor-day", { wait: 800 });
    const open = card.getByTestId("open-visit");
    if (await open.count()) {
      await open.first().click();
      await d.getByTestId("visit-screen").waitFor({ timeout: 20000 }).catch(() => {});
      await shot(d, "vc-5-doctor-visit", { wait: 1200 });
    }
  } else note("video visit not on Dr. Sarah's day");
});

// ── 6. The doctor: starts a waiting patient's visit and dictates; the AI writes the draft ──
await scene("doctor", async () => {
  const ctx = await context("phone");
  const page = await ctx.newPage();
  await login(page, "dr.sara@derma.demo");
  const TODAY = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  await page.goto(`${BASE}/my-day?date=${TODAY}`, { waitUntil: "networkidle" });
  await shot(page, "dr-1-myday", { wait: 1000 });
  const start = page.locator("[data-testid=my-day-card][data-status=arrived]").getByTestId("start-visit").first();
  if (!(await start.count())) return note("no arrived patient for Dr. Sarah");
  await start.click();
  await page.getByTestId("visit-workspace").waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  const text = page.getByTestId("scribe-text");
  if (!(await text.isVisible().catch(() => false))) return note("scribe not visible");
  await text.scrollIntoViewIfNeeded();
  await text.fill(
    "المريضة جاية لجلسة ليزر إزالة شعر، الجلسة الثالثة. البشرة النوع الثالث، ما فيه تهيج من الجلسة السابقة. سوينا الجلسة على الساقين بنفس الإعدادات. نصحتها بواقي شمس وتبعد عن الشمس أسبوع، والجلسة الجاية بعد ست أسابيع.",
  );
  await shot(page, "dr-3-dictation");
  await page.getByTestId("scribe-write").click();
  // Wait for the AI's draft in the note.
  const noteBox = page.getByTestId("visit-note");
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1500);
    if (((await noteBox.inputValue().catch(() => "")) || "").length > 40) break;
  }
  await page.waitForTimeout(800);
  await noteBox.evaluate((e) => e.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -170));
  await shot(page, "dr-5-note", { wait: 600 });
});

// ── 6a. Before / after photos: D-0013's laser course, two cheek photos compared ──
await scene("photos", async () => {
  const ctx = await context("desktop");
  const page = await ctx.newPage();
  await login(page, "dr.sara@derma.demo");
  await page.goto(`${BASE}/patients`, { waitUntil: "networkidle" });
  const row = page.locator("tr, a", { hasText: "D-0013" }).first();
  const href =
    (await row.getAttribute("href").catch(() => null)) ??
    (await row.locator('a[href^="/patients/"]').first().getAttribute("href"));
  await page.goto(BASE + href + "?tab=photos", { waitUntil: "networkidle" });
  await page.getByTestId("clinical-photos").waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  await shot(page, "ph-1-tab", { wait: 600 });
  const thumbs = page.getByTestId("photo-thumb");
  await thumbs.nth(2).click();
  await thumbs.nth(3).click();
  await page.getByTestId("photo-compare").waitFor({ timeout: 10000 });
  await shot(page, "ph-2-compare", { wait: 1200 });
});

// ── 6b. A clinic day: front desk search, the patient flow board, checkout ─────
// The browser's clock is set to late morning so waiting times look like a real day.
const TODAY = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const MORNING = new Date(`${TODAY}T11:40:00+03:00`);
await scene("clinic-day", async () => {
  const ctx = await context("desktop");
  const page = await ctx.newPage();
  await page.clock.setFixedTime(MORNING);
  await login(page, "reception.riyadh1@derma.demo");
  await page.goto(`${BASE}/calendar?view=flow&date=${TODAY}`, { waitUntil: "networkidle" });
  await page.getByTestId("desk-search").fill("050001001");
  await page.getByTestId("desk-hit").first().waitFor({ timeout: 20000 });
  await shot(page, "day-1-desk", { wait: 800 });
  await page.getByTestId("desk-search").fill("");
  await page.getByTestId("flow-board").waitFor({ timeout: 20000 });
  await shot(page, "day-2-board", { wait: 800 });
  const pay = page.getByTestId("flow-checkout").first();
  if (await pay.count()) {
    await pay.click();
    await page.getByTestId("checkout-screen").waitFor({ timeout: 20000 });
    await shot(page, "day-3-checkout", { wait: 1000 });
  } else note("no visit waiting for checkout");
});

// ── 7. The owner's control ───────────────────────────────────────────────────
await scene("owner", async () => {
  const ctx = await context("desktop");
  const page = await ctx.newPage();
  await login(page, "admin@derma.demo");
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  await shot(page, "own-1-home", { wait: 1000 });
  await page.goto(BASE + "/calendar", { waitUntil: "networkidle" });
  await shot(page, "own-2-calendar", { wait: 1500 });
  // A patient with a package (Sara, D-0002: laser hair removal, 3 of 6 sessions used).
  await page.goto(BASE + "/patients", { waitUntil: "networkidle" });
  const row = page.locator("tr, a", { hasText: "D-0002" }).first();
  const href =
    (await row.getAttribute("href").catch(() => null)) ??
    (await row.locator('a[href^="/patients/"]').first().getAttribute("href"));
  await page.goto(BASE + href + "?tab=packages", { waitUntil: "networkidle" });
  note(`patient page: ${page.url()}`);
  await shot(page, "own-3-patient", { full: true, wait: 1000 });
  await page.goto(BASE + "/reports", { waitUntil: "networkidle" });
  await page.getByTestId("report-tiles").waitFor({ timeout: 20000 });
  await shot(page, "own-4-report", { wait: 1000 });
  await shot(page, "own-4-report-full", { full: true, wait: 400 });
});

// Leave the live demo clean again.
await scene("cleanup", () => refreshDemoWeek("refresh after filming"));

writeFileSync(`${OUT}/log.txt`, log.join("\n") + "\n");
await browser.close();
