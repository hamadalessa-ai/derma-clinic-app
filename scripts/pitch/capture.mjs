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

// ── 2. Booking from the phone + 3. WhatsApp + 4. consent ─────────────────────
let bookedName = "ريم العتيبي";
await scene("booking", async () => {
  const ctx = await context("phone");
  const page = await ctx.newPage();
  await page.goto(BASE + "/book", { waitUntil: "networkidle" });
  await shot(page, "book-1-start");
  await page.locator("#phone").fill(PATIENT_PHONE);
  await shot(page, "book-2-mobile");
  await page.getByTestId("send-code").click();
  await page.getByTestId("demo-code").waitFor({ timeout: 20000 });
  const code = ((await page.getByTestId("demo-code").innerText()).match(/\d{6}/) ?? [""])[0];
  await page.locator("#code").fill(code);
  await shot(page, "book-3-code");
  await page.getByTestId("verify-code").click();
  await page.getByTestId("online-booking").waitFor();
  await page.waitForTimeout(800);
  // Visit the clinic (when video is offered too).
  if (await page.getByTestId("mode-clinic").isVisible().catch(() => false)) {
    await shot(page, "book-4-mode");
    await page.getByTestId("mode-clinic").click();
  }
  // Riyadh branch.
  const branch = page.getByTestId("step-branch").getByRole("button").first();
  if (await branch.isVisible().catch(() => false)) await branch.click();
  await page.waitForTimeout(600);
  await shot(page, "book-5-service");
  // A laser hair removal session if offered, else the first service.
  const laser = page.locator("[data-service]", { hasText: /ليزر|إزالة الشعر/ }).first();
  if (await laser.isVisible().catch(() => false)) await laser.click();
  else await page.locator("[data-service]").first().click();
  await page.waitForTimeout(800);
  if (await page.getByTestId("doctor-female").isVisible().catch(() => false)) {
    await shot(page, "book-6-doctor");
    await page.getByTestId("doctor-female").click();
  } else if (await page.getByTestId("doctor-any").isVisible().catch(() => false)) {
    await page.getByTestId("doctor-any").click();
  }
  await page.waitForTimeout(800);
  // The first day with free times.
  const days = page.locator("[data-day]:not([disabled])");
  const n = await days.count();
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
  await shot(page, "book-7-times");
  const times = page.locator("[data-time]");
  await times.nth(Math.min(2, (await times.count()) - 1)).click();
  await page.waitForTimeout(600);
  await page.locator("#fullName").fill(bookedName);
  await page.locator('input[name="patientGender"][value="female"]').check();
  const optIn = page.getByTestId("whatsapp-opt-in");
  if (!(await optIn.isChecked().catch(() => true))) await optIn.check();
  await page.getByTestId("confirm").scrollIntoViewIfNeeded();
  await shot(page, "book-8-details");
  await page.getByTestId("confirm").click();
  await page.getByTestId("booking-done").waitFor({ timeout: 30000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "book-9-done", { wait: 1000 });
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

// ── 5. The AI receptionist on WhatsApp ───────────────────────────────────────
await scene("ai", async () => {
  const ctx = await context("desktop");
  const page = await ctx.newPage();
  await login(page, "admin@derma.demo");
  await page.goto(BASE + "/whatsapp/simulator", { waitUntil: "networkidle" });
  await page.locator("#sim-phone").fill(AI_PHONE);
  await page.locator("#sim-name").fill("نوف");
  await page.locator("#sim-text").fill("السلام عليكم، ودي أحجز جلسة ليزر إزالة شعر الأسبوع الجاي، الفترة المسائية لو سمحتوا");
  await page.locator('[data-testid="simulate-new-number"] button[type="submit"]').click();
  await page.waitForURL(/c=/, { timeout: 30000 });
  await page.getByTestId("patient-view-link").waitFor();
  const url = BASE + (await page.getByTestId("patient-view-link").getAttribute("href"));
  const phone = await browser.newContext({ ...PHONE, locale: "ar-SA", timezoneId: "Asia/Riyadh", storageState: await ctx.storageState() });
  const p = await phone.newPage();
  const replies = [
    "أنثى، واسمي نوف القحطاني",
    "فرع الرياض، أي طبيبة متاحة، وأول موعد بعد الساعة ٤ العصر",
    "أول موعد تقترحه مناسب لي",
    "نعم",
  ];
  const msgs = p.getByTestId("chat-message");
  /** Waits until the clinic (the AI) has answered: the last message is from the clinic. */
  const waitForAnswer = async (before) => {
    for (let i = 0; i < 60; i++) {
      await p.waitForTimeout(2500);
      await p.reload({ waitUntil: "networkidle" });
      const n = await msgs.count();
      const lastDir = await msgs.last().getAttribute("data-direction").catch(() => null);
      if (n > before && lastDir === "out") break;
    }
    await p.waitForTimeout(3000); // a confirmation may follow the reply
    await p.reload({ waitUntil: "networkidle" });
  };
  await p.goto(url, { waitUntil: "networkidle" });
  await waitForAnswer(1);
  for (let turn = 0; ; turn++) {
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await shot(p, `ai-${turn + 1}`, { wait: 600 });
    const last = (await msgs.last().innerText().catch(() => "")).replace(/\s+/g, " ");
    note(`ai turn ${turn + 1}: ${last.slice(0, 200)}`);
    if (turn >= replies.length) break;
    // Stop once the booking is confirmed.
    const kinds = await msgs.evaluateAll((ms) => ms.map((m) => m.getAttribute("data-kind")));
    if (turn >= 2 && kinds.some((k) => k && /confirm/.test(k))) break;
    const before = await msgs.count();
    await p.getByTestId("simulator-input").fill(replies[turn]);
    await p.getByTestId("simulator-input").press("Enter");
    await p.waitForTimeout(1500);
    await waitForAnswer(before + 1);
  }
  await shot(p, "ai-full", { full: true });
});

// ── 6. The doctor's day ──────────────────────────────────────────────────────
await scene("doctor", async () => {
  const ctx = await context("phone");
  const page = await ctx.newPage();
  await login(page, "dr.sara@derma.demo");
  await page.goto(BASE + "/my-day", { waitUntil: "networkidle" });
  await shot(page, "dr-1-myday", { wait: 1000 });
  await shot(page, "dr-1-myday-full", { full: true });
  const open = page.getByTestId("open-visit").first();
  if (await open.isVisible().catch(() => false)) {
    await open.click();
    await page.getByTestId("visit-screen").waitFor({ timeout: 20000 });
    await shot(page, "dr-2-visit", { wait: 800 });
    if (await page.getByTestId("start-visit").isVisible().catch(() => false)) {
      await page.getByTestId("start-visit").click();
      await page.waitForTimeout(3000);
    }
    const text = page.getByTestId("scribe-text");
    if (await text.isVisible().catch(() => false)) {
      await text.scrollIntoViewIfNeeded();
      await text.fill(
        "المريضة جاية لجلسة ليزر إزالة شعر، الجلسة الثالثة. البشرة النوع الثالث، ما فيه تهيج من الجلسة السابقة. سوينا الجلسة على الساقين بنفس الإعدادات. نصحتها بواقي شمس وتبعد عن الشمس أسبوع، والجلسة الجاية بعد ست أسابيع.",
      );
      await shot(page, "dr-3-dictation");
      await page.getByTestId("scribe-write").click();
      await page.waitForTimeout(15000);
      await shot(page, "dr-4-draft", { full: true });
      // The note with the AI draft, on screen.
      const noteBox = page.locator("textarea").last();
      await noteBox.evaluate((e) => e.scrollIntoView({ block: "start" }));
      await page.evaluate(() => window.scrollBy(0, -260));
      await shot(page, "dr-5-note", { wait: 600 });
    } else note("scribe not visible");
  } else note("no visit to open");
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
  // A patient with a package (session balance).
  await page.goto(BASE + "/patients", { waitUntil: "networkidle" });
  await page.locator('a[href^="/patients/"]').first().click();
  await page.waitForLoadState("networkidle");
  await shot(page, "own-3-patient", { full: true, wait: 1000 });
  await page.goto(BASE + "/settings?tab=team", { waitUntil: "networkidle" });
  await shot(page, "own-4-team", { wait: 800 });
});

writeFileSync(`${OUT}/log.txt`, log.join("\n") + "\n");
await browser.close();
