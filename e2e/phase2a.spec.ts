/**
 * Phase 2a browser tests (desktop and phone sizes). Start from a fresh demo database:
 *   pnpm db:local && pnpm dev   then   pnpm e2e        (MESSAGE_DEMO_MODE=on in .env.local)
 *
 *  1. A patient books online (/book) → reception's calendar shows it as "online" → it is on
 *     Dr. Sara's My Day → on /my the patient signs the consent and reschedules → at check-in
 *     reception sees "already signed" and no consent screen appears.
 *  2. On /my the patient cancels → reception's calendar shows it cancelled.
 *  3. The "demo mode" label is visible on /book and /my.
 * Every run uses fresh fake mobile numbers (new patients), so runs don't affect each other.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";

const PASSWORD = process.env.DEMO_PASSWORD ?? "Demo-Local-2026";

function phoneContext(isMobile: boolean) {
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
  const page = await (await browser.newContext(phoneContext(isMobile))).newPage();
  await page.goto("/login");
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة المرور").fill(PASSWORD);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/$/);
  return page;
}

let seq = 0;
/** A fresh fake mobile number: 0598 + 6 digits from the clock. */
const freshPhone = () => `0598${String((Date.now() + seq++ * 7919) % 1_000_000).padStart(6, "0")}`;

async function noSidewaysScroll(page: Page) {
  const sw = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sw).toBeLessThanOrEqual(1);
}

/**
 * Books on /book with Dr. Sara (Riyadh). Picks an open day at least `minDaysAhead` days ahead
 * that has free times, and the first time. Returns the Riyadh day and time.
 */
async function bookOnline(
  page: Page,
  opts: { service: RegExp; phone: string; name: string; minDaysAhead: number },
) {
  await page.goto("/book");
  await expect(page.getByTestId("demo-mode")).toBeVisible();
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
  const count = await days.count();
  for (let i = opts.minDaysAhead; i < count; i++) {
    const chip = days.nth(i);
    const day = (await chip.getAttribute("data-day"))!;
    const minDay = new Date(Date.now() + opts.minDaysAhead * 86_400_000 + 3 * 3_600_000)
      .toISOString()
      .slice(0, 10);
    if (day < minDay) continue;
    await chip.click();
    const times = page.getByTestId("times");
    await expect(times.locator("[data-time], [data-testid=no-times]").first()).toBeVisible();
    const first = times.locator("[data-time]").first();
    if (!(await first.count())) continue;
    const time = (await first.getAttribute("data-time"))!;
    await first.click();
    await page.getByLabel("الاسم الكامل").fill(opts.name);
    await page.getByLabel("رقم الجوال").fill(opts.phone);
    await page.getByText("أنثى").click();
    await page.getByTestId("send-code").click();
    const code = (await page.getByTestId("demo-code").textContent())!.match(/\d{6}/)![0];
    await page.getByLabel("رمز التحقق").fill(code);
    await page.getByTestId("confirm").click();
    await expect(page.getByTestId("booking-done")).toBeVisible();
    await noSidewaysScroll(page);
    return { day, time };
  }
  throw new Error("no free online time found for Dr. Sara");
}

async function appointmentOnCalendar(reception: Page, day: string, fileNumber: string) {
  await reception.goto(`/calendar?date=${day}`);
  const block = reception.locator(`[data-testid=appointment][data-patient="${fileNumber}"]`);
  await expect(block.first()).toBeVisible();
  return block.first();
}

test.describe("online booking and the patient page", () => {
  test("book online → reception sees 'online' → Dr. Sara's My Day → sign consent on /my → reschedule → check-in sees it signed", async ({
    browser,
    isMobile,
  }) => {
    test.setTimeout(180_000);
    const patient = await (await browser.newContext(phoneContext(isMobile))).newPage();
    const booked = await bookOnline(patient, {
      service: /بوتوكس/,
      phone: freshPhone(),
      name: isMobile ? "مريضة جوال تجريبية" : "مريضة مكتب تجريبية",
      minDaysAhead: 2,
    });

    // The patient page opens straight away (the verified mobile signed them in).
    await patient.getByTestId("open-my").click();
    await expect(patient.getByTestId("portal-home")).toBeVisible();
    await expect(patient.getByTestId("demo-mode")).toBeVisible();
    const fileNumber = (await patient.locator("main p[dir=ltr]").first().textContent())!.trim();
    expect(fileNumber).toMatch(/^D-\d{4}$/);
    await noSidewaysScroll(patient);

    // Reception: the booking is on the calendar, marked "online".
    const reception = await staff(browser, "reception.riyadh1@derma.demo", false);
    const block = await appointmentOnCalendar(reception, booked.day, fileNumber);
    await expect(block).toHaveAttribute("data-source", "online");
    await expect(block.getByTestId("source-badge")).toBeVisible();

    // Dr. Sara (on her phone): it is on My Day, marked online.
    const doctor = await staff(browser, "dr.sara@derma.demo", true);
    await doctor.goto(`/my-day?date=${booked.day}`);
    const card = doctor.locator(`[data-testid=my-day-card][data-patient="${fileNumber}"]`);
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-source", "online");

    // Patient signs the Botox consent on /my before the visit.
    const toSign = patient.getByTestId("consent-to-sign").first();
    await expect(toSign).toBeVisible();
    await toSign.getByTestId("sign-consent").click();
    const pad = patient.getByTestId("signature-pad");
    await pad.scrollIntoViewIfNeeded();
    const box = (await pad.boundingBox())!;
    await patient.mouse.move(box.x + 20, box.y + box.height * 0.7);
    await patient.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await patient.mouse.move(
        box.x + 20 + i * ((box.width - 40) / 10),
        box.y + box.height * (i % 2 ? 0.3 : 0.7),
      );
    }
    await patient.mouse.up();
    await patient.getByTestId("consent-agree").check();
    await patient.getByTestId("consent-submit").click();
    await expect(patient.getByTestId("consent-to-sign")).toHaveCount(0);
    await expect(patient.getByTestId("signed-consents")).toContainText("صفحة المريض");

    // Patient moves the appointment to another free time (same day or later).
    const appt = patient.getByTestId("portal-appointment").first();
    await appt.getByTestId("portal-reschedule").click();
    const move = patient.getByTestId("portal-move");
    let movedDay = "";
    const dayChips = move.locator("[data-day]");
    for (let i = 3; i < (await dayChips.count()); i++) {
      const chip = dayChips.nth(i);
      movedDay = (await chip.getAttribute("data-day"))!;
      await chip.click();
      const slot = move.locator("[data-time]").first();
      await expect(slot.or(move.getByText("لا توجد أوقات متاحة"))).toBeVisible();
      if (await slot.count()) {
        await slot.click();
        break;
      }
      movedDay = "";
    }
    expect(movedDay).not.toBe("");
    await expect(patient.getByText("تم تغيير الموعد.")).toBeVisible();

    // Reception: on the new day, the dialog says "already signed (patient page)"; check-in needs no consent.
    const moved = await appointmentOnCalendar(reception, movedDay, fileNumber);
    await moved.click();
    const status = reception.getByTestId("consent-status");
    await expect(status).toHaveAttribute("data-signed", "true");
    await expect(status).toContainText("صفحة المريض");
    await reception.getByTestId("check-in").click();
    await expect(reception.getByTestId("consent-text")).toHaveCount(0);
    await expect(reception.getByText(/تم تسجيل الحضور/)).toBeVisible();
  });

  test("the patient cancels on /my → it leaves reception's calendar (slot free again)", async ({
    browser,
    isMobile,
  }) => {
    test.setTimeout(120_000);
    const patient = await (await browser.newContext(phoneContext(isMobile))).newPage();
    const booked = await bookOnline(patient, {
      service: /استشارة طبية/,
      phone: freshPhone(),
      name: "مريض إلغاء تجريبي",
      minDaysAhead: 2,
    });
    await patient.goto("/my");
    const fileNumber = (await patient.locator("main p[dir=ltr]").first().textContent())!.trim();
    const appt = patient.getByTestId("portal-appointment").first();
    await appt.getByTestId("portal-cancel").click();
    await patient.getByTestId("portal-cancel-confirm").click();
    await expect(patient.getByText("تم إلغاء الموعد.")).toBeVisible();
    await expect(
      patient
        .getByTestId("past")
        .locator("[data-testid=portal-appointment][data-status=cancelled]"),
    ).toHaveCount(1);

    // Reception: cancelled appointments leave the calendar, so the time is free again.
    const reception = await staff(browser, "reception.riyadh1@derma.demo", false);
    await reception.goto(`/calendar?date=${booked.day}`);
    await expect(reception.getByTestId("calendar-board")).toBeVisible();
    await expect(
      reception.locator(`[data-testid=appointment][data-patient="${fileNumber}"]`),
    ).toHaveCount(0);
  });

  test("signing in to /my with a code (existing demo patients), and signing out", async ({
    browser,
    isMobile,
  }) => {
    const page = await (await browser.newContext(phoneContext(isMobile))).newPage();
    await page.goto("/my");
    await expect(page.getByTestId("demo-mode")).toBeVisible();
    // Own demo patient per screen size (codes are rate-limited per mobile number).
    // D-0007: online Botox booking; D-0012: online consultation today.
    await page.getByLabel("رقم الجوال").fill(isMobile ? "0500010012" : "0500010007");
    await page.getByTestId("send-code").click();
    const code = (await page.getByTestId("demo-code").textContent())!.match(/\d{6}/)![0];
    await page.getByLabel("رمز التحقق").fill("000000" === code ? "111111" : "000000");
    await page.getByTestId("verify").click();
    await expect(page.getByText("الرمز غير صحيح")).toBeVisible();
    await page.getByLabel("رمز التحقق").fill(code);
    await page.getByTestId("verify").click();
    await expect(page.getByTestId("portal-home")).toBeVisible();
    await expect(page.getByTestId("upcoming")).toContainText(isMobile ? "استشارة" : "بوتوكس");
    await noSidewaysScroll(page);
    await page.getByTestId("sign-out").click();
    await expect(page.getByTestId("portal-sign-in")).toBeVisible();
  });
});

test.describe("settings and account", () => {
  test.skip(({ isMobile }) => isMobile, "desktop only");

  test("admin sees the booking link and QR code; staff see notification settings", async ({
    browser,
  }) => {
    const admin = await staff(browser, "admin@derma.demo", false);
    await admin.goto("/settings");
    await expect(admin.getByTestId("booking-link")).toContainText("/book");
    await expect(admin.getByTestId("booking-qr")).toBeVisible();
    await expect(admin.getByTestId("qr-download")).toHaveAttribute("href", /^data:image\/png/);
    await expect(admin.getByTestId("show-prices")).toBeChecked();

    const doctor = await staff(browser, "dr.sara@derma.demo", false);
    await doctor.goto("/account");
    await expect(doctor.getByTestId("push-device")).toBeVisible();
    await expect(doctor.getByTestId("push-prefs")).toBeVisible();
    await expect(doctor.locator("[data-push-type=new_booking]")).toBeVisible();
  });
});
