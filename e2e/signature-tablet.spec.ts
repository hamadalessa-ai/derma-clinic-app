/**
 * The consent signature pad on tablets (iPad / Android tablet size), portrait and landscape:
 *  - touch, pen and mouse all draw, and the ink is exactly under the finger/pen;
 *  - the page doesn't scroll while signing;
 *  - turning the tablet keeps the signature, and new strokes still land under the finger;
 *  - a full check-in with a signature works on a tablet.
 * These tests open their own tablet-sized windows, so they run once (desktop project).
 * Start from a fresh demo database:  pnpm db:local && pnpm dev  then  pnpm e2e
 */
import {
  expect,
  test,
  type Browser,
  type CDPSession,
  type Locator,
  type Page,
} from "@playwright/test";

const PASSWORD = process.env.DEMO_PASSWORD ?? "Demo-Local-2026";

const TABLETS = [
  { name: "iPad", portrait: { width: 820, height: 1180 }, scale: 2 },
  { name: "Android tablet", portrait: { width: 800, height: 1280 }, scale: 1.5 },
];

async function tabletSession(
  browser: Browser,
  size: { width: number; height: number },
  scale: number,
) {
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: scale,
    isMobile: true,
    hasTouch: true,
    locale: "ar-SA",
    timezoneId: "Asia/Riyadh",
  });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("البريد الإلكتروني").fill("reception.riyadh1@derma.demo");
  await page.getByLabel("كلمة المرور").fill(PASSWORD);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/$/);
  return { page, cdp: await context.newCDPSession(page) };
}

type Pt = { x: number; y: number }; // fractions of the pad

/** Screen points for fractions of the pad's drawing area (inside its border). */
async function toScreen(pad: Locator, pts: Pt[]) {
  const box = (await pad.boundingBox())!;
  const border = await pad.evaluate((c) => ({
    l: c.clientLeft,
    t: c.clientTop,
    w: c.clientWidth,
    h: c.clientHeight,
  }));
  return pts.map((p) => ({
    x: box.x + border.l + p.x * border.w,
    y: box.y + border.t + p.y * border.h,
  }));
}

async function drawTouch(cdp: CDPSession, pad: Locator, pts: Pt[]) {
  const s = await toScreen(pad, pts);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [s[0]] });
  for (const p of s.slice(1))
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [p] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function drawPen(cdp: CDPSession, pad: Locator, pts: Pt[]) {
  const s = await toScreen(pad, pts);
  const ev = (type: "mousePressed" | "mouseMoved" | "mouseReleased", p: { x: number; y: number }) =>
    cdp.send("Input.dispatchMouseEvent", {
      type,
      x: p.x,
      y: p.y,
      button: "left",
      buttons: type === "mouseReleased" ? 0 : 1,
      clickCount: 1,
      pointerType: "pen",
      force: 0.5,
    });
  await ev("mousePressed", s[0]);
  for (const p of s.slice(1)) await ev("mouseMoved", p);
  await ev("mouseReleased", s[s.length - 1]);
}

async function drawMouse(page: Page, pad: Locator, pts: Pt[]) {
  const s = await toScreen(pad, pts);
  await page.mouse.move(s[0].x, s[0].y);
  await page.mouse.down();
  for (const p of s.slice(1)) await page.mouse.move(p.x, p.y);
  await page.mouse.up();
}

/** True when there is ink within 3 CSS pixels of each point (fractions of the pad). */
async function inkAt(pad: Locator, pts: Pt[]) {
  return pad.evaluate((c, points) => {
    const ctx = (c as HTMLCanvasElement).getContext("2d")!;
    const sx = (c as HTMLCanvasElement).width / c.clientWidth;
    const sy = (c as HTMLCanvasElement).height / c.clientHeight;
    return points.map((p) => {
      const cx = p.x * c.clientWidth * sx;
      const cy = p.y * c.clientHeight * sy;
      const r = Math.ceil(3 * sx);
      const data = ctx.getImageData(Math.max(0, cx - r), Math.max(0, cy - r), 2 * r, 2 * r).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
      return false;
    });
  }, pts);
}

const line = (y: number, from = 0.1, to = 0.9): Pt[] =>
  Array.from({ length: 15 }, (_, i) => ({ x: from + ((to - from) * i) / 14, y }));
const checkpoints = (y: number): Pt[] => [0.25, 0.5, 0.75].map((x) => ({ x, y }));

async function openCheckInConsent(page: Page, file: string, day?: string) {
  await page.goto(day ? `/calendar?date=${day}` : "/calendar");
  await page.locator(`[data-testid=appointment][data-patient="${file}"]`).first().click();
  await page.getByTestId("check-in").click();
  const pad = page.getByTestId("signature-pad");
  await expect(pad).toBeVisible();
  await pad.scrollIntoViewIfNeeded();
  return pad;
}

const scrollPositions = (page: Page) =>
  page.evaluate(() => ({
    page: window.scrollY,
    dialog: (document.querySelector("dialog[open]") as HTMLElement | null)?.scrollTop ?? 0,
  }));

test.describe("signature pad on tablets", () => {
  test.skip(({ isMobile }) => isMobile, "these tests open their own tablet windows");

  for (const tablet of TABLETS) {
    for (const orientation of ["portrait", "landscape"] as const) {
      test(`${tablet.name}, ${orientation}: touch, pen and mouse draw under the finger; no scrolling`, async ({
        browser,
      }) => {
        test.setTimeout(120_000);
        const size =
          orientation === "portrait"
            ? tablet.portrait
            : { width: tablet.portrait.height, height: tablet.portrait.width };
        const { page, cdp } = await tabletSession(browser, size, tablet.scale);
        const pad = await openCheckInConsent(page, "D-0002");
        await expect(pad).toHaveAttribute("data-empty", "true");

        const before = await scrollPositions(page);
        await drawTouch(cdp, pad, line(0.3));
        expect(await scrollPositions(page)).toEqual(before); // signing never scrolls the page
        expect(await inkAt(pad, checkpoints(0.3))).toEqual([true, true, true]);
        expect(await inkAt(pad, checkpoints(0.85))).toEqual([false, false, false]); // only where drawn

        await drawPen(cdp, pad, line(0.55));
        expect(await inkAt(pad, checkpoints(0.55))).toEqual([true, true, true]);
        await drawMouse(page, pad, line(0.8));
        expect(await inkAt(pad, checkpoints(0.8))).toEqual([true, true, true]);
        await expect(pad).toHaveAttribute("data-empty", "false");

        // The drawing surface matches the screen's pixel density (sharp, not stretched).
        const dims = await pad.evaluate((c) => ({
          ratioX: (c as HTMLCanvasElement).width / c.clientWidth,
          ratioY: (c as HTMLCanvasElement).height / c.clientHeight,
        }));
        expect(dims.ratioX).toBeCloseTo(tablet.scale, 1);
        expect(dims.ratioY).toBeCloseTo(tablet.scale, 1);
      });
    }

    test(`${tablet.name}: turning the tablet keeps the signature; new strokes still land under the finger`, async ({
      browser,
    }) => {
      test.setTimeout(120_000);
      const { page, cdp } = await tabletSession(browser, tablet.portrait, tablet.scale);
      const pad = await openCheckInConsent(page, "D-0002");
      await drawTouch(cdp, pad, line(0.3));
      await page.setViewportSize({ width: tablet.portrait.height, height: tablet.portrait.width });
      await page.waitForTimeout(300);
      await pad.scrollIntoViewIfNeeded();
      expect(await inkAt(pad, checkpoints(0.3))).toEqual([true, true, true]); // kept, same place
      await drawTouch(cdp, pad, line(0.7, 0.1, 0.3));
      expect(await inkAt(pad, [{ x: 0.2, y: 0.7 }])).toEqual([true]);
      expect(await inkAt(pad, [{ x: 0.6, y: 0.7 }])).toEqual([false]);
      await page.setViewportSize(tablet.portrait);
      await page.waitForTimeout(300);
      expect(await inkAt(pad, [...checkpoints(0.3), { x: 0.2, y: 0.7 }])).toEqual(
        Array(4).fill(true),
      );
    });
  }

  test("phone turned sideways: the pad grows, the signature is kept and still lines up", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const { page, cdp } = await tabletSession(browser, { width: 390, height: 844 }, 3);
    const pad = await openCheckInConsent(page, "D-0002");
    const narrow = await pad.evaluate((c) => c.clientWidth);
    await drawTouch(cdp, pad, line(0.3));
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(300);
    await pad.scrollIntoViewIfNeeded();
    expect(await pad.evaluate((c) => c.clientWidth)).toBeGreaterThan(narrow); // really resized
    expect(await inkAt(pad, checkpoints(0.3))).toEqual([true, true, true]);
    // A short stroke on the left only: the ink must be exactly there, not stretched further right.
    await drawTouch(cdp, pad, line(0.7, 0.1, 0.3));
    expect(await inkAt(pad, [{ x: 0.2, y: 0.7 }])).toEqual([true]);
    expect(
      await inkAt(pad, [
        { x: 0.5, y: 0.7 },
        { x: 0.8, y: 0.7 },
      ]),
    ).toEqual([false, false]);
  });

  test("a full check-in with a signature on an iPad (landscape)", async ({ browser }) => {
    test.setTimeout(180_000);
    // A fresh Botox booking (needs the injectables consent) for a new fake patient.
    const patientPage = await (
      await browser.newContext({ locale: "ar-SA", timezoneId: "Asia/Riyadh" })
    ).newPage();
    await patientPage.goto("/book");
    await patientPage
      .getByTestId("step-branch")
      .getByRole("button", { name: /الرياض/ })
      .click();
    await patientPage
      .getByTestId("step-service")
      .getByRole("button", { name: /بوتوكس/ })
      .first()
      .click();
    await patientPage
      .getByTestId("step-doctor")
      .getByRole("button", { name: /سارة العتيبي/ })
      .click();
    const days = patientPage.locator("[data-day]:not([disabled])");
    let day = "";
    for (let i = 1; i < (await days.count()) && !day; i++) {
      await days.nth(i).click();
      const times = patientPage.getByTestId("times");
      await expect(times.locator("[data-time], [data-testid=no-times]").first()).toBeVisible();
      if (await times.locator("[data-time]").count()) {
        day = (await days.nth(i).getAttribute("data-day"))!;
        await times.locator("[data-time]").first().click();
      }
    }
    const phone = `0594${String(Date.now() % 1_000_000).padStart(6, "0")}`;
    await patientPage.getByLabel("الاسم الكامل").fill("مريضة توقيع لوحي");
    await patientPage.getByLabel("رقم الجوال").fill(phone);
    await patientPage.getByText("أنثى").click();
    await patientPage.getByTestId("send-code").click();
    const code = (await patientPage.getByTestId("demo-code").textContent())!.match(/\d{6}/)![0];
    await patientPage.getByLabel("رمز التحقق").fill(code);
    await patientPage.getByTestId("confirm").click();
    await expect(patientPage.getByTestId("booking-done")).toBeVisible();
    await patientPage.getByTestId("open-my").click();
    const file = (await patientPage.locator("main p[dir=ltr]").first().textContent())!.trim();

    const { page, cdp } = await tabletSession(browser, { width: 1180, height: 820 }, 2);
    const pad = await openCheckInConsent(page, file, day);
    await drawTouch(cdp, pad, line(0.4));
    await drawTouch(cdp, pad, [
      { x: 0.2, y: 0.7 },
      { x: 0.4, y: 0.5 },
      { x: 0.6, y: 0.75 },
      { x: 0.8, y: 0.45 },
    ]);
    await page.getByRole("button", { name: "اعتماد التوقيع" }).click();
    await expect(page.getByText(/تم تسجيل الحضور/)).toBeVisible();
  });
});
