// End-to-end walkthrough of one clinic visit, with a picture of every step:
// reception checks in → nurse prepares (orders, codes, "ready for doctor") and posts →
// reception checks out (payment, invoice number, next session, instructions) → the patient's link.
// Runs against a fresh demo database (screenshots workflow). Fails loudly on any broken step.
import { createHash, createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium, devices } from "@playwright/test";

const BASE = process.env.SCREENSHOT_BASE_URL ?? "http://derma.localhost:3000";
const PASSWORD = process.env.DEMO_PASSWORD ?? "Demo-Local-2026";
mkdirSync("screenshots", { recursive: true });

// The demo day: the next working day (no clinic on Fridays), at 10:30 on the browser's clock.
const d = new Date(Date.now() + 3 * 3600_000);
while (d.getUTCDay() === 5) d.setUTCDate(d.getUTCDate() + 1);
const DAY = d.toISOString().slice(0, 10);
const CLOCK = new Date(`${DAY}T10:30:00+03:00`);

let n = 0;
const shot = async (page, name, fullPage = false) => {
  await page.waitForTimeout(400);
  const file = `screenshots/walk-${String(++n).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: file, fullPage });
  console.log("✓", file);
};

const browser = await chromium.launch();
async function signIn(email, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, timezoneId: "Asia/Riyadh" });
  await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: BASE }]);
  const page = await context.newPage();
  await page.clock.setFixedTime(CLOCK);
  page.on("dialog", (dlg) => dlg.accept()); // "Post this visit?" confirm
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  return page;
}
const board = (page) =>
  page.goto(`${BASE}/calendar?view=flow&date=${DAY}`, { waitUntil: "networkidle" });
const column = (page, stage) => page.locator(`[data-testid=flow-column][data-stage=${stage}]`);

// ── 1. Reception: the board, then check in one of Dr. Sarah's / Dr. Faisal's patients ──
const desk = await signIn("reception.riyadh1@derma.demo");
await board(desk);
await shot(desk, "reception-board");
// A patient of Dr. Sarah / Dr. Faisal (the nurse's doctors) with no consent to sign. The same
// patient may have another visit today, so the card is followed by patient AND time.
const card = column(desk, "expected")
  .locator("[data-testid=flow-card]")
  .filter({ hasText: /Sarah|Faisal/ })
  .filter({ hasNotText: "Consent to sign" })
  .first();
const file = await card.getAttribute("data-patient");
if (!file) throw new Error("no expected patient of Dr. Sarah / Dr. Faisal without a consent");
const time = (await card.locator("span.font-mono").first().innerText()).trim();
const ours = (stage) =>
  column(desk, stage)
    .locator(`[data-testid=flow-card][data-patient="${file}"]`)
    .filter({ hasText: time });
console.log("patient:", file, time);
await card.getByTestId("flow-check-in").click();
await ours("waiting").waitFor({ timeout: 15000 });
await shot(desk, "checked-in-waiting");

// ── 2. Nurse Huda: her doctors' day → the visit → start ──
const nurse = await signIn("nurse@derma.demo", { width: 1280, height: 900 });
await nurse.goto(`${BASE}/my-day?date=${DAY}`, { waitUntil: "networkidle" });
const mine = nurse
  .locator(`[data-testid=my-day-card][data-patient="${file}"][data-status=arrived]`)
  .filter({ hasText: time });
await mine.waitFor({ timeout: 15000 });
await mine.scrollIntoViewIfNeeded();
await shot(nurse, "nurse-my-day");
await mine.getByTestId("start-visit").click(); // starts the visit and opens its screen
await nurse.getByTestId("visit-workspace").waitFor({ timeout: 20000 });
await shot(nurse, "nurse-visit-started");

// Reception sees "With nurse".
await board(desk);
await ours("nurse").waitFor({ timeout: 15000 });

// Note, a medication, a treatment plan, an invoice code.
await nurse
  .getByTestId("visit-note")
  .fill(
    "Reason for visit: acne follow-up.\nFindings: mild inflammatory papules on cheeks.\nPlan: topical treatment, peel course.",
  );
const orders = nurse.getByTestId("visit-orders");
await orders.getByRole("button").last().click(); // "Add"
await nurse.getByTestId("order-name").fill("Adapalene 0.1% gel");
await nurse.locator("#o-dose").fill("Thin layer");
await nurse.locator("#o-freq").fill("Every night");
await nurse.locator("#o-dur").fill("8 weeks");
await nurse.getByTestId("order-add").click();
await orders.getByText("Adapalene 0.1% gel").waitFor({ timeout: 15000 });
await orders.getByRole("button").last().click(); // "Add" again
await orders.getByRole("button", { name: "Treatment plan" }).click();
await nurse.getByTestId("order-name").fill("Chemical peel course");
const peel = await nurse
  .locator("#o-svc option", { hasText: /peel/i })
  .first()
  .getAttribute("value");
await nurse.locator("#o-svc").selectOption(peel);
await nurse.locator("#o-sessions").fill("3");
await nurse.locator("#o-weeks").fill("3");
await nurse.getByTestId("order-add").click();
await orders.getByText("Chemical peel course").waitFor({ timeout: 15000 });
const charges = nurse.getByTestId("visit-charges");
const pick = charges.getByTestId("charge-pick");
const spf = await pick.locator("option", { hasText: "SPF50" }).getAttribute("value");
await pick.selectOption(spf);
await charges.getByTestId("charge-qty").fill("1");
await charges.getByTestId("charge-add").click();
await charges.getByText("SPF50").first().waitFor({ timeout: 15000 });
await nurse.getByTestId("ready-for-doctor-button").click();
await nurse.getByText("The doctor has been told").waitFor({ timeout: 15000 });
await shot(nurse, "nurse-orders-codes-ready", true);

// Reception sees "With doctor".
await board(desk);
await ours("doctor").waitFor({ timeout: 15000 });
await shot(desk, "board-with-doctor");

// ── 3. The nurse posts the visit (in the doctor's name) ──
await nurse.getByTestId("post-visit").click();
await nurse.waitForURL((u) => u.pathname.startsWith("/my-day"), { timeout: 20000 });
await shot(nurse, "nurse-posted");

// ── 4. Reception: checkout ──
await board(desk);
const toPay = ours("checkout");
await toPay.waitFor({ timeout: 15000 });
await shot(desk, "board-checkout");
await toPay.getByTestId("flow-checkout").click();
await desk.getByTestId("checkout-screen").waitFor({ timeout: 20000 });
await desk.waitForLoadState("networkidle");
await shot(desk, "checkout", true);
const appointmentId = desk.url().split("/checkout/")[1].split(/[?#]/)[0];
await desk.getByTestId("checkout-method").selectOption("card");
await desk.getByTestId("checkout-invoice").fill("INV-2026-1187");
await desk.getByTestId("checkout-submit").click();
await desk.getByTestId("checkout-done").waitFor({ timeout: 15000 });
const book = desk.getByTestId("book-plan-session").first();
if (await book.count()) {
  await book.click();
  await desk.getByText("Booked ✓").first().waitFor({ timeout: 15000 });
}
await desk.getByTestId("send-instructions").click();
await desk.waitForTimeout(2500);
await shot(desk, "checkout-paid-booked-sent", true);
await board(desk);
await ours("done").waitFor({ timeout: 15000 });
await shot(desk, "board-done");

// Printed instructions.
await desk.goto(`${BASE}/instructions/${appointmentId}`, { waitUntil: "networkidle" });
await shot(desk, "printed-instructions", true);

// ── 5. The patient's WhatsApp link, on a phone ──
const demoId = (key) => {
  const h = createHash("sha1").update(`derma-demo:${key}`).digest("hex");
  const v = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${v}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const secret = process.env.VERIFICATION_SECRET || process.env.BETTER_AUTH_SECRET;
const sig = createHmac("sha256", secret)
  .update(`care-link:${demoId("tenant:derma")}:${appointmentId}`)
  .digest("base64url")
  .slice(0, 22);
const phone = await browser.newContext({ ...devices["iPhone 13"], timezoneId: "Asia/Riyadh" });
await phone.addCookies([{ name: "NEXT_LOCALE", value: "ar", url: BASE }]);
const pp = await phone.newPage();
await pp.goto(`${BASE}/care/${appointmentId}.${sig}`, { waitUntil: "networkidle" });
await pp.getByTestId("instruction-sheet").waitFor({ timeout: 15000 });
await shot(pp, "patient-care-link-phone", true);

// The WhatsApp simulator: what the patient received.
await desk.goto(`${BASE}/whatsapp/simulator`, { waitUntil: "networkidle" });
await shot(desk, "whatsapp-simulator");

// Help centre: the nurse's guides (Arabic) and reception's (English).
await nurse.context().addCookies([{ name: "NEXT_LOCALE", value: "ar", url: BASE }]);
await nurse.goto(`${BASE}/help`, { waitUntil: "networkidle" });
await nurse.getByTestId("help-guide").first().waitFor({ timeout: 15000 });
await shot(nurse, "help-nurse-ar", true);
await desk.goto(`${BASE}/help`, { waitUntil: "networkidle" });
await shot(desk, "help-reception-en", true);

// ── 6. Dental: the dentist's patient file, a dental visit, and reception's lab cases ──
const dentist = await signIn("dr.nawaf@derma.demo");
await dentist.goto(`${BASE}/patients/${demoId("derma:patient:D-0015")}?tab=dental`, {
  waitUntil: "networkidle",
});
await dentist.getByTestId("tooth-chart").waitFor({ timeout: 15000 });
await dentist.locator("[data-testid=tooth][data-tooth='25']").click();
await dentist.getByTestId("tooth-panel").waitFor({ timeout: 5000 });
await shot(dentist, "dental-patient-file", true);
// Voice charting: what the dentist said, read into a checked list (not saved in the walkthrough).
await dentist.getByTestId("dictation-text").fill("17 MO caries, 26 crown, 37 root canal");
await dentist.getByTestId("dictation-items").waitFor({ timeout: 5000 });
await dentist.getByTestId("dental-dictation").scrollIntoViewIfNeeded();
await shot(dentist, "dental-voice-charting", false);
await dentist.goto(`${BASE}/my-day?date=${DAY}`, { waitUntil: "networkidle" });
const dentalStart = dentist.getByTestId("start-visit").first();
if (await dentalStart.count()) {
  await dentalStart.click();
  await dentist.getByTestId("visit-workspace").waitFor({ timeout: 20000 });
  await dentist.getByTestId("dental-section").waitFor({ timeout: 15000 });
  await shot(dentist, "dental-visit", true);
}
await desk.goto(`${BASE}/lab-cases`, { waitUntil: "networkidle" });
await shot(desk, "lab-cases-reception");

// ── 7. Memberships: the renewals page, a member's file, and the plans in Clinic set-up ──
await desk.goto(`${BASE}/memberships`, { waitUntil: "networkidle" });
await desk.getByTestId("memberships-page").waitFor({ timeout: 15000 });
await shot(desk, "memberships-page", true);
await desk.goto(`${BASE}/patients/${demoId("derma:patient:D-0038")}?tab=packages`, {
  waitUntil: "networkidle",
});
await desk.getByTestId("membership-panel").waitFor({ timeout: 15000 });
await shot(desk, "membership-member-file", true);
await desk.goto(`${BASE}/patients/${demoId("derma:patient:D-0020")}?tab=packages`, {
  waitUntil: "networkidle",
});
await shot(desk, "membership-lapsed-file", true);
const owner = await signIn("admin@derma.demo");
await owner.goto(`${BASE}/setup?tab=memberships`, { waitUntil: "networkidle" });
await shot(owner, "membership-plans-setup");
await owner.goto(`${BASE}/reports`, { waitUntil: "networkidle" });
await shot(owner, "reports-members");

// ── 8. Lab results: a patient's Labs tab (flags, repeat tests) and the add form ──
const doctorLabs = await signIn("dr.sara@derma.demo");
await doctorLabs.goto(`${BASE}/patients/${demoId("derma:patient:D-0012")}?tab=labs`, {
  waitUntil: "networkidle",
});
await doctorLabs.getByTestId("lab-results").waitFor({ timeout: 15000 });
await shot(doctorLabs, "labs-tab", true);
await doctorLabs.getByTestId("lab-add-open").click();
await doctorLabs.getByTestId("lab-add").waitFor();
await shot(doctorLabs, "labs-add-form");

await browser.close();
console.log("walkthrough: OK");
