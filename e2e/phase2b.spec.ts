/**
 * Phase 2b browser tests (desktop and phone sizes): WhatsApp in DEMO mode.
 * Start from a fresh demo database:  pnpm db:local && pnpm dev  then  pnpm e2e
 * (needs MESSAGE_DEMO_MODE=on in .env.local).
 *
 *  1. Book online (WhatsApp ticked) → the confirmation appears in the WhatsApp simulator.
 *  2. "Run scheduled messages now" → the reminder appears → tap Confirm → reception's calendar
 *     shows the appointment as confirmed.
 *  3. Complete a visit → run (fast-forward 24 h) → post-care check-in → tap "I have a concern" →
 *     the chat is in reception's inbox flagged as a concern (the push to Dr. Sara is tested in
 *     tests/push.test.ts and tests/whatsapp-inbound.test.ts — a browser can't receive a real push).
 *  4. A message from a number that isn't a patient → inbox "new numbers" → create the patient.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";

const PASSWORD = process.env.DEMO_PASSWORD ?? "Demo-Local-2026";

function ctxOptions(isMobile: boolean) {
  return isMobile
    ? {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        locale: "ar-SA",
        timezoneId: "Asia/Riyadh",
      }
    : { viewport: { width: 1280, height: 900 }, locale: "ar-SA", timezoneId: "Asia/Riyadh" };
}

async function staff(browser: Browser, email: string, isMobile: boolean) {
  const page = await (await browser.newContext(ctxOptions(isMobile))).newPage();
  await page.goto("/login");
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة المرور").fill(PASSWORD);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/$/);
  return page;
}

let seq = 0;
const freshPhone = () => `0597${String((Date.now() + seq++ * 7919) % 1_000_000).padStart(6, "0")}`;

async function noSidewaysScroll(page: Page) {
  const sw = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sw).toBeLessThanOrEqual(1);
}

/** Books on /book with Dr. Sara, WhatsApp ticked: the first free time from tomorrow on. */
async function bookOnline(page: Page, opts: { service: RegExp; phone: string; name: string }) {
  await page.goto("/book");
  await page
    .getByTestId("step-branch")
    .getByRole("button", { name: /الرياض/ })
    .click();
  await page
    .getByTestId("step-service")
    .getByRole("button", { name: opts.service })
    .first()
    .click();
  await page
    .getByTestId("step-doctor")
    .getByRole("button", { name: /سارة العتيبي/ })
    .click();
  const days = page.locator("[data-day]:not([disabled])");
  const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  for (let i = 0; i < (await days.count()); i++) {
    const chip = days.nth(i);
    const day = (await chip.getAttribute("data-day"))!;
    if (day <= today) continue;
    await chip.click();
    const times = page.getByTestId("times");
    await expect(times.locator("[data-time], [data-testid=no-times]").first()).toBeVisible();
    const first = times.locator("[data-time]").first();
    if (!(await first.count())) continue;
    await first.click();
    await page.getByLabel("الاسم الكامل").fill(opts.name);
    await page.getByLabel("رقم الجوال").fill(opts.phone);
    await page.getByText("أنثى").click();
    await page.getByTestId("whatsapp-opt-in").check();
    await page.getByTestId("send-code").click();
    const code = (await page.getByTestId("demo-code").textContent())!.match(/\d{6}/)![0];
    await page.getByLabel("رمز التحقق").fill(code);
    await page.getByTestId("confirm").click();
    await expect(page.getByTestId("booking-done")).toBeVisible();
    await page.getByTestId("open-my").click();
    const fileNumber = (await page.locator("main p[dir=ltr]").first().textContent())!.trim();
    return { day, fileNumber };
  }
  throw new Error("no free online time found for Dr. Sara");
}

/** Opens a patient's chat in the simulator (by phone number) and returns the phone frame. */
async function openSimulatorChat(page: Page, phone: string) {
  await page.goto("/whatsapp/simulator");
  await page.locator(`[data-testid=conversation][data-phone="${phone}"]`).click();
  const frame = page.getByTestId("simulator-phone");
  await expect(frame).toBeVisible();
  return frame;
}

async function runNow(page: Page, fastForward: boolean) {
  await page.goto("/whatsapp/simulator");
  const panel = page.getByTestId("run-now");
  await panel.getByTestId("ignore-quiet").check();
  if (fastForward) await panel.getByTestId("fast-forward").check();
  await panel.getByTestId("run-now-button").click();
  await expect(panel.getByRole("status")).toBeVisible();
}

test.describe("WhatsApp in demo mode", () => {
  test("booking → confirmation → run scheduled → reminder → Confirm → calendar shows confirmed", async ({
    browser,
    isMobile,
  }) => {
    test.setTimeout(180_000);
    const patient = await (await browser.newContext(ctxOptions(isMobile))).newPage();
    const phone = freshPhone();
    const booked = await bookOnline(patient, {
      service: /استشارة طبية/,
      phone,
      name: "مريضة واتساب تجريبية",
    });

    const admin = await staff(browser, "admin@derma.demo", isMobile);
    let chat = await openSimulatorChat(admin, phone);
    await expect(chat.locator("[data-kind=booking_confirmation]")).toBeVisible();
    await expect(chat.locator("[data-kind=booking_confirmation]")).toContainText(
      "موعد استشارة طبية",
    );
    await expect(admin.getByTestId("demo-label")).toBeVisible();
    await noSidewaysScroll(admin);

    // The reminder: due within 24 h — or tomorrow-ish, so fast-forward if needed.
    await runNow(admin, false);
    chat = await openSimulatorChat(admin, phone);
    if (!(await chat.locator("[data-kind=reminder]").count())) {
      await runNow(admin, true);
      chat = await openSimulatorChat(admin, phone);
    }
    const reminder = chat.locator("[data-kind=reminder]");
    await expect(reminder).toBeVisible();
    await chat.locator('[data-testid=chat-button][data-button="تأكيد"]').last().click();
    await expect(chat.locator("[data-kind=confirm_ack]")).toBeVisible();

    const reception = await staff(browser, "reception.riyadh1@derma.demo", false);
    await reception.goto(`/calendar?date=${booked.day}`);
    const block = reception.locator(
      `[data-testid=appointment][data-patient="${booked.fileNumber}"]`,
    );
    await expect(block).toHaveAttribute("data-status", "confirmed");
    await block.click();
    await expect(reception.getByTestId("appointment-whatsapp")).toContainText("تذكير");
  });

  test("completed visit → post-care check-in → 'I have a concern' → flagged in the inbox", async ({
    browser,
    isMobile,
  }) => {
    test.setTimeout(180_000);
    const patient = await (await browser.newContext(ctxOptions(isMobile))).newPage();
    const phone = freshPhone();
    const booked = await bookOnline(patient, {
      service: /جلسة تنظيف البشرة/,
      phone,
      name: "مريضة متابعة تجريبية",
    });

    // Reception: check in, start, complete (a visit done early for the demo).
    const reception = await staff(browser, "reception.riyadh1@derma.demo", false);
    await reception.goto(`/calendar?date=${booked.day}`);
    await reception
      .locator(`[data-testid=appointment][data-patient="${booked.fileNumber}"]`)
      .click();
    await reception.getByTestId("check-in").click();
    await expect(reception.getByText(/تم تسجيل الحضور/)).toBeVisible();
    await reception.getByRole("button", { name: "بدء الجلسة" }).click();
    await expect(reception.getByRole("button", { name: "إنهاء الجلسة" })).toBeVisible();
    await reception.getByRole("button", { name: "إنهاء الجلسة" }).click();
    await expect(
      reception.locator(`[data-testid=appointment][data-patient="${booked.fileNumber}"]`),
    ).toHaveAttribute("data-status", "completed");

    // Admin: run with fast-forward → the post-care check-in arrives; tap "I have a concern".
    const admin = await staff(browser, "admin@derma.demo", isMobile);
    await runNow(admin, true);
    const chat = await openSimulatorChat(admin, phone);
    await expect(chat.locator("[data-kind=post_care]")).toContainText("التنظيف");
    await chat.locator('[data-testid=chat-button][data-button="لدي استفسار/قلق"]').last().click();
    await expect(chat.locator("[data-kind=concern_ack]")).toBeVisible();

    // The admin status page shows what happened to the concern push (sent / no device / no keys…).
    await admin.goto("/settings/whatsapp/status");
    await expect(
      admin.locator("[data-testid=push-log-row][data-type=patient_concern]").first(),
    ).toBeVisible();

    // Reception's inbox: needs reply, flagged as a concern.
    const inbox = await staff(browser, "reception.riyadh1@derma.demo", isMobile);
    await inbox.goto("/whatsapp?f=needs_reply");
    const row = inbox.locator(`[data-testid=conversation][data-phone="${phone}"]`);
    await expect(row).toContainText("قلق بعد الإجراء");
    await row.click();
    await expect(inbox.getByTestId("inbox-thread")).toBeVisible();
    await expect(
      inbox.locator("[data-testid=chat-message][data-kind=inbound_button]").last(),
    ).toContainText("لدي استفسار/قلق");
    await inbox.getByTestId("reply-text").fill("مرحبًا، سنتصل بك خلال ساعة.");
    await inbox.getByTestId("reply-send").click();
    await expect(inbox.locator("[data-testid=chat-message][data-kind=staff_reply]")).toBeVisible();
    await noSidewaysScroll(inbox);
  });

  test("a number that isn't a patient lands in the inbox; reception creates the patient", async ({
    browser,
    isMobile,
  }) => {
    test.setTimeout(120_000);
    const admin = await staff(browser, "admin@derma.demo", isMobile);
    const phone = freshPhone();
    await admin.goto("/whatsapp/simulator");
    const form = admin.getByTestId("simulate-new-number");
    await form.getByLabel("رقم الجوال").fill(phone);
    await form.getByLabel("الاسم في واتساب (اختياري)").fill("Huda");
    await form.getByLabel("الرسالة").fill("السلام عليكم، هل يوجد عرض على الليزر؟");
    await form.getByRole("button", { name: "أرسل كمريض" }).click();
    await expect(admin.getByTestId("simulator-phone")).toBeVisible();

    const inbox = await staff(browser, "reception.riyadh1@derma.demo", isMobile);
    await inbox.goto("/whatsapp?f=new_contacts");
    const row = inbox.locator(`[data-testid=conversation][data-phone="${phone}"]`);
    await expect(row).toContainText("ليس مريضًا بعد");
    await row.click();
    const create = inbox.getByTestId("link-or-create");
    await create.getByLabel("الاسم الكامل").fill("هدى التجريبية");
    await create.getByText("أنثى").click();
    await create.getByTestId("create-patient").click();
    await expect(inbox).toHaveURL(/\/patients\/[0-9a-f-]{36}/);
    await expect(inbox.getByTestId("whatsapp-consent")).toBeVisible();
  });
});
