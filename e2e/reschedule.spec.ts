/**
 * Rescheduling shows real choices or a clear reason — never a silent "all full".
 *  - /my: the patient's own appointment doesn't block earlier times; the doctor's times, or (when the
 *    doctor is full) other doctors' times; moving works.
 *  - Reception calendar: "Free times that day" in the move dialog fills in the time.
 * The detailed rules (24-hour window, service not online, doctor full, WhatsApp buttons) are
 * covered with fixed dates in tests/reschedule.test.ts.
 * Start from a fresh demo database:  pnpm db:local && pnpm dev  then  pnpm e2e
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

let seq = 0;
const freshPhone = () => `0596${String((Date.now() + seq++ * 7919) % 1_000_000).padStart(6, "0")}`;

/** Books with Dr. Sara on the first day at least 3 days ahead that has free times (latest time). */
async function bookLater(page: Page, phone: string) {
  await page.goto("/book");
  await page
    .getByTestId("step-branch")
    .getByRole("button", { name: /الرياض/ })
    .click();
  await page
    .getByTestId("step-service")
    .getByRole("button", { name: /استشارة طبية/ })
    .first()
    .click();
  await page
    .getByTestId("step-doctor")
    .getByRole("button", { name: /سارة العتيبي/ })
    .click();
  const minDay = new Date(Date.now() + 3 * 86_400_000 + 3 * 3_600_000).toISOString().slice(0, 10);
  const days = page.locator("[data-day]:not([disabled])");
  for (let i = 0; i < (await days.count()); i++) {
    const chip = days.nth(i);
    const day = (await chip.getAttribute("data-day"))!;
    if (day < minDay) continue;
    await chip.click();
    const times = page.getByTestId("times");
    await expect(times.locator("[data-time], [data-testid=no-times]").first()).toBeVisible();
    const last = times.locator("[data-time]").last();
    if (!(await last.count())) continue;
    const time = (await last.getAttribute("data-time"))!;
    await last.click();
    await page.getByLabel("الاسم الكامل").fill("مريضة تغيير موعد");
    await page.getByLabel("رقم الجوال").fill(phone);
    await page.getByText("أنثى").click();
    await page.getByTestId("send-code").click();
    const code = (await page.getByTestId("demo-code").textContent())!.match(/\d{6}/)![0];
    await page.getByLabel("رمز التحقق").fill(code);
    await page.getByTestId("confirm").click();
    await expect(page.getByTestId("booking-done")).toBeVisible();
    return { day, time };
  }
  throw new Error("no free time found");
}

async function staff(browser: Browser, email: string) {
  const page = await (await browser.newContext(ctxOptions(false))).newPage();
  await page.goto("/login");
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة المرور").fill(PASSWORD);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/$/);
  return page;
}

test("/my: an earlier time on the same day can be chosen (with the same or another doctor)", async ({
  browser,
  isMobile,
}) => {
  test.setTimeout(120_000);
  const page = await (await browser.newContext(ctxOptions(isMobile))).newPage();
  const booked = await bookLater(page, freshPhone());
  await page.goto("/my");
  const card = page.getByTestId("portal-appointment").first();
  await card.getByTestId("portal-reschedule").click();
  const move = card.getByTestId("portal-move");
  await move.locator(`[data-day="${booked.day}"]`).click();
  const options = move.getByTestId("move-options").or(move.getByTestId("move-refusal"));
  await expect(options).toBeVisible();
  await expect(move.getByTestId("move-refusal")).toHaveCount(0); // 3+ days ahead: allowed
  // Either the same doctor's times, or "Dr. Sara has no free times" + other doctors — never silent.
  const same = move.getByTestId("same-doctor-times");
  if (await same.count()) {
    const earlier = same.locator("[data-time]").first();
    const t = (await earlier.getAttribute("data-time"))!;
    expect(t < booked.time).toBe(true); // earlier times are offered
    await earlier.click();
  } else {
    await expect(move.getByTestId("doctor-full")).toContainText("سارة");
    await move.getByTestId("other-doctors").locator("[data-time]").first().click();
  }
  await expect(page.getByText("تم تغيير الموعد.")).toBeVisible();
});

test("reception: 'Free times that day' in the move dialog fills in the time", async ({
  browser,
  isMobile,
}) => {
  test.skip(isMobile, "desktop calendar");
  const page = await staff(browser, "reception.riyadh1@derma.demo");
  await page.goto("/calendar");
  await page
    .locator(
      "[data-testid=appointment][data-status=booked], [data-testid=appointment][data-status=confirmed]",
    )
    .first()
    .click();
  await page.getByRole("button", { name: "تغيير الموعد" }).click();
  await page.getByTestId("show-free-times").click();
  const box = page.getByTestId("move-free-times");
  const firstTime = box
    .locator("[data-testid=same-doctor-times] button, [data-testid=other-doctor-times] button")
    .first();
  const noneText = box.getByText("لا توجد أوقات متاحة مع أي طبيب");
  await expect(firstTime.or(noneText)).toBeVisible();
  if (await firstTime.count()) {
    const t = (await firstTime.textContent())!.trim();
    await firstTime.click();
    await expect(page.locator("#move-time")).toHaveValue(t);
  }
});
