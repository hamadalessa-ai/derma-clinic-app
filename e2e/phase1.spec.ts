/**
 * Phase 1 browser tests (desktop and phone sizes). Start from a fresh demo database:
 *   pnpm db:local && pnpm dev   then   pnpm e2e
 * Each project (desktop / mobile) uses its own patients so runs don't affect each other.
 */
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";

const PASSWORD = process.env.DEMO_PASSWORD ?? "Demo-Local-2026";
const PATIENT = { desktop: "D-0016", mobile: "D-0017" } as Record<string, string>;

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة المرور").fill(PASSWORD);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function newSession(browser: Browser, email: string, isMobile: boolean) {
  const context = await browser.newContext(
    isMobile
      ? {
          viewport: { width: 412, height: 915 },
          isMobile: true,
          hasTouch: true,
          locale: "ar-SA",
          timezoneId: "Asia/Riyadh",
        }
      : { viewport: { width: 1280, height: 900 }, locale: "ar-SA", timezoneId: "Asia/Riyadh" },
  );
  const page = await context.newPage();
  await signIn(page, email);
  return page;
}

async function openPatient(page: Page, file: string) {
  await page.goto(`/patients?q=${file}`);
  await page.locator("tbody tr").filter({ hasText: file }).getByRole("link").click();
  await expect(page).toHaveURL(/\/patients\/[0-9a-f-]{36}/);
}

/** Picks the <option> whose text matches (Playwright only matches exact labels). */
async function choose(select: Locator, text: RegExp) {
  const value = await select
    .locator("option")
    .filter({ hasText: text })
    .first()
    .getAttribute("value");
  await select.selectOption(value!);
}

async function drawSignature(page: Page) {
  const pad = page.getByTestId("signature-pad");
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height * 0.7);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(
      box.x + 20 + i * ((box.width - 40) / 12),
      box.y + box.height * (i % 2 ? 0.3 : 0.7),
    );
  }
  await page.mouse.up();
}

test.describe("done-when journey", () => {
  test("reception books → Dr. Sara sees it on My Day → check-in with signed consent → balance drops → note signed", async ({
    browser,
    isMobile,
  }, testInfo) => {
    test.setTimeout(120_000);
    const file = PATIENT[testInfo.project.name];
    const reception = await newSession(browser, "reception.riyadh1@derma.demo", isMobile);
    const doctor = await newSession(browser, "dr.sara@derma.demo", true); // the doctor is on her phone

    // 1. Reception sells a 4-session chemical peel package.
    await openPatient(reception, file);
    await reception.getByRole("tab", { name: "الباقات" }).click();
    await choose(reception.getByLabel("الباقة"), /التقشير الكيميائي/);
    await reception.getByLabel("دفعة أولى (اختياري)").fill("500");
    await reception.getByRole("button", { name: "بيع باقة" }).click();
    await expect(reception.getByTestId("package-remaining")).toContainText("4/4");

    // 2. Reception books Dr. Sara's next free slot for a chemical peel.
    await reception.goto("/calendar");
    await reception.getByTestId("new-booking").click();
    await reception.getByPlaceholder("ابحث بالاسم أو الجوال أو رقم الملف").fill(file);
    await reception.getByRole("option").filter({ hasText: file }).click();
    await expect(reception.getByTestId("selected-patient")).toContainText(file);
    await choose(reception.getByLabel("الخدمة", { exact: true }), /التقشير الكيميائي/);
    await reception
      .getByLabel("الطبيب", { exact: true })
      .selectOption({ label: "د. سارة العتيبي" });
    await reception.getByRole("button", { name: "أقرب موعد متاح" }).click();
    await reception.getByTestId("free-slot").first().click();
    const day = await reception.getByLabel("التاريخ", { exact: true }).inputValue();
    await reception.getByRole("button", { name: "احجز", exact: true }).click();
    await expect(reception.getByTestId("selected-patient")).toBeHidden();

    // 3. Dr. Sara sees it on My Day (on her phone).
    await doctor.goto(`/my-day?date=${day}`);
    const card = doctor
      .getByTestId("my-day-card")
      .filter({ hasText: /التقشير الكيميائي/ })
      .and(doctor.locator(`[data-patient="${file}"]`));
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-status", "booked");

    // 4. Reception checks in: consent opens, patient signs, one session is deducted, status → arrived.
    await reception.goto(`/calendar?date=${day}`);
    await reception.locator(`[data-testid="appointment"][data-patient="${file}"]`).first().click();
    await reception.getByTestId("check-in").click();
    await expect(reception.getByTestId("consent-text")).toContainText("التقشير الكيميائي");
    await drawSignature(reception);
    await reception.getByRole("button", { name: "اعتماد التوقيع" }).click();
    await expect(reception.getByRole("dialog").getByRole("status")).toContainText("المتبقي 3 من 4");
    await expect(reception.getByTestId("appointment-details")).toContainText("حضر");

    // 5. Dr. Sara sees "arrived", starts the visit, writes and signs a note.
    await doctor.reload();
    await expect(card).toHaveAttribute("data-status", "arrived");
    await card.getByRole("button", { name: "بدء" }).click();
    await expect(card).toHaveAttribute("data-status", "in_session");
    await card.getByRole("link", { name: "ملاحظة الزيارة" }).click();
    await doctor.getByRole("button", { name: "ملاحظة جديدة" }).click();
    await doctor
      .getByLabel("مسودة")
      .fill("تقشير خفيف بحمض الجليكوليك 30% لمدة 3 دقائق. لا مضاعفات. مراجعة بعد أسبوعين.");
    doctor.once("dialog", (d) => d.accept());
    await doctor.getByRole("button", { name: "توقيع الملاحظة" }).click();
    await expect(doctor.getByTestId("note-card").first()).toHaveAttribute("data-status", "signed");

    // 6. The package balance dropped (also visible on the profile).
    await openPatient(reception, file);
    await reception.getByRole("tab", { name: "الباقات" }).click();
    await expect(reception.getByTestId("package-remaining").first()).toContainText("3/4");
  });
});

test.describe("calendar", () => {
  test.skip(({ isMobile }) => isMobile, "calendar is for desktop and tablet");

  test("day view per doctor and per room, week view per doctor", async ({ page }) => {
    await signIn(page, "reception.riyadh1@derma.demo");
    await page.goto("/calendar");
    await expect(page.getByTestId("calendar-column")).toHaveCount(3); // Riyadh doctors
    await page.getByRole("link", { name: "حسب الغرفة" }).click();
    await expect(page.getByTestId("calendar-column")).toHaveCount(4); // Riyadh rooms
    await page.getByRole("link", { name: "أسبوع" }).click();
    await expect(page.getByTestId("calendar-column")).toHaveCount(7);
  });

  test("a Jeddah doctor only sees Jeddah", async ({ page }) => {
    await signIn(page, "dr.lina@derma.demo");
    await page.goto("/calendar");
    await expect(page.getByTestId("calendar-column")).toHaveCount(2);
    await expect(page.getByText("د. سارة العتيبي")).toHaveCount(0);
  });

  test("works on a tablet in landscape", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1180, height: 820 },
      hasTouch: true,
      locale: "ar-SA",
    });
    const page = await context.newPage();
    await signIn(page, "reception.riyadh1@derma.demo");
    await page.goto("/calendar");
    await expect(page.getByTestId("appointment").first()).toBeVisible();
    await page.getByTestId("appointment").first().click();
    await expect(page.getByTestId("appointment-details")).toBeVisible();
  });
});

test.describe("reschedule request (clinic setting OFF)", () => {
  test.skip(({ isMobile }) => isMobile, "one run is enough");

  test("doctor requests a new time on My Day; reception sees and rejects it", async ({
    browser,
  }) => {
    const doctor = await newSession(browser, "dr.sara@derma.demo", true);
    // Find a day with a movable appointment of Dr. Sara (tomorrow onwards).
    let card;
    for (let i = 1; i <= 5; i++) {
      const d = new Date(Date.now() + 3 * 3600_000 + i * 86400_000).toISOString().slice(0, 10);
      await doctor.goto(`/my-day?date=${d}`);
      card = doctor
        .locator(
          '[data-testid="my-day-card"][data-status="confirmed"], [data-testid="my-day-card"][data-status="booked"]',
        )
        .first();
      if (await card.count()) break;
    }
    await card!.getByRole("button", { name: "تغيير الموعد" }).click();
    const dialog = doctor.getByRole("dialog");
    await dialog.getByRole("button", { name: "تغيير الموعد" }).click();
    await dialog.getByLabel("الوقت", { exact: true }).selectOption("19:00");
    await dialog.getByLabel(/السبب/).fill("مؤتمر طبي");
    await dialog.getByRole("button", { name: "حفظ" }).click();
    await expect(dialog.getByRole("status")).toContainText("تم إرسال طلب التغيير");

    const reception = await newSession(browser, "reception.riyadh1@derma.demo", false);
    await reception.goto("/requests");
    const req = reception.getByTestId("reschedule-request").filter({ hasText: "مؤتمر طبي" });
    await expect(req).toBeVisible();
    await req.getByRole("button", { name: "رفض" }).click();
    await expect(req).toHaveCount(0);
  });
});

test("My Day shows allergy warnings and package balances", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "phone only");
  const doctor = await newSession(browser, "dr.sara@derma.demo", true);
  await doctor.goto("/my-day");
  await expect(
    doctor.locator('[data-testid="my-day-card"][data-patient="D-0001"]').getByTestId("alert-badge"),
  ).toBeVisible();
  await expect(
    doctor
      .locator('[data-testid="my-day-card"][data-patient="D-0002"]')
      .getByTestId("balance-badge"),
  ).toContainText("3/6");
});

test("the app can be installed (manifest + service worker)", async ({ page }) => {
  await page.goto("/login");
  const r = await page.evaluate(async () => {
    const manifest = await (await fetch("/manifest.webmanifest")).json();
    const sw = await fetch("/sw.js");
    return {
      display: manifest.display,
      icons: manifest.icons.length,
      sw: sw.ok,
      link: !!document.querySelector('link[rel="manifest"]'),
    };
  });
  expect(r).toEqual({ display: "standalone", icons: 3, sw: true, link: true });
});
