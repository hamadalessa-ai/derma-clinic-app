/**
 * Phone-size checks (390 × 844), for every role:
 *  - every navigation item visible on desktop is reachable on the phone (bottom bar or "More"),
 *  - opening each one works,
 *  - no page scrolls sideways, nothing is cut off, every button/link is on screen.
 * Start from a fresh demo database: pnpm db:local && pnpm dev, then pnpm e2e.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";

const PASSWORD = process.env.DEMO_PASSWORD ?? "Demo-Local-2026";
const PHONE = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  locale: "ar-SA",
  timezoneId: "Asia/Riyadh",
};
const DESKTOP = {
  viewport: { width: 1280, height: 900 },
  locale: "ar-SA",
  timezoneId: "Asia/Riyadh",
};

const ROLES = [
  { name: "clinic admin", email: "admin@derma.demo" },
  { name: "doctor", email: "dr.sara@derma.demo" },
  { name: "receptionist", email: "reception.riyadh1@derma.demo" },
  { name: "platform owner", email: "owner@platform.demo" },
];

async function session(browser: Browser, email: string, opts: typeof PHONE | typeof DESKTOP) {
  const page = await (await browser.newContext(opts)).newPage();
  await page.goto("/login");
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة المرور").fill(PASSWORD);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/$/);
  return page;
}

/** Finds layout problems on the current page at phone width. Empty list = fine. */
async function layoutProblems(page: Page): Promise<string[]> {
  // (Not "networkidle": calendar pages poll every 15 s.) Wait for the page and fonts to settle.
  await page.waitForLoadState("load");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const problems: string[] = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1) {
      problems.push(`page scrolls sideways: ${document.documentElement.scrollWidth}px > ${vw}px`);
    }
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""} "${(el.textContent ?? "").trim().slice(0, 30)}"`;
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      // Areas that scroll sideways inside the page (content hidden off to the side).
      if (
        ["auto", "scroll"].includes(style.overflowX) &&
        el.scrollWidth > el.clientWidth + 2 &&
        el.clientWidth > 0
      ) {
        problems.push(
          `sideways scroll area: ${describe(el)} (${el.scrollWidth}px in ${el.clientWidth}px)`,
        );
      }
    }
    for (const el of document.querySelectorAll<HTMLElement>("a, button, input, select, textarea")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || el.closest("dialog:not([open])")) continue;
      if (r.left < -1 || r.right > vw + 1)
        problems.push(
          `off screen: ${describe(el)} (${Math.round(r.left)}..${Math.round(r.right)})`,
        );
    }
    return [...new Set(problems)];
  });
}

/** Opens a nav item on the phone: from the bottom bar, or via "More". */
async function openOnPhone(page: Page, href: string) {
  const bar = page.getByTestId("mobile-nav");
  const inBar = bar.locator(`a[href="${href}"]`);
  if (await inBar.count()) {
    await expect(inBar).toBeVisible();
    await inBar.click();
  } else {
    await bar.getByRole("button", { name: "المزيد" }).click();
    const item = page.getByTestId("mobile-more").locator(`a[href="${href}"]`);
    await expect(item).toBeVisible();
    await item.click();
  }
  await expect(page).toHaveURL(new RegExp(`${href === "/" ? "/$" : `${href}(\\?.*)?$`}`));
  await expect(page.getByTestId("mobile-more")).toBeHidden();
}

test.describe("phone navigation and layout", () => {
  test.skip(({ isMobile }) => isMobile, "these tests create their own phone and desktop windows");

  for (const role of ROLES) {
    test(`${role.name}: every desktop page is reachable on the phone and fits the screen`, async ({
      browser,
    }) => {
      test.setTimeout(Number(process.env.E2E_TIMEOUT ?? 300_000));
      const desktop = await session(browser, role.email, DESKTOP);
      const hrefs = await desktop
        .locator("aside nav a")
        .evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
      expect(hrefs.length).toBeGreaterThan(0);
      await desktop.context().close();

      const phone = await session(browser, role.email, PHONE);
      await expect(phone.getByTestId("mobile-nav")).toBeVisible();
      // The bottom bar plus "More" holds exactly the desktop items (nothing missing, nothing extra).
      const barLinks = await phone
        .getByTestId("mobile-nav")
        .locator("a")
        .evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
      let moreLinks: string[] = [];
      const moreButton = phone.getByTestId("mobile-nav").getByRole("button", { name: "المزيد" });
      if (await moreButton.count()) {
        await moreButton.click();
        moreLinks = await phone
          .getByTestId("mobile-more")
          .locator("a")
          .evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
        await phone.getByRole("button", { name: "إغلاق" }).click();
      }
      expect([...barLinks, ...moreLinks].sort()).toEqual([...hrefs].sort());
      expect(barLinks.length).toBeLessThanOrEqual(5);

      for (const href of hrefs) {
        await openOnPhone(phone, href);
        await expect(phone.locator("main h1").first()).toBeVisible();
        expect(await layoutProblems(phone), `layout problems on ${href}`).toEqual([]);
      }
    });
  }

  test("pages deeper than the menu also fit a phone", async ({ browser }) => {
    test.setTimeout(Number(process.env.E2E_TIMEOUT ?? 300_000));
    const reception = await session(browser, "reception.riyadh1@derma.demo", PHONE);
    await reception.goto("/patients?q=D-0002");
    await reception.locator("tbody tr").filter({ hasText: "D-0002" }).getByRole("link").click();
    await expect(reception).toHaveURL(/\/patients\/[0-9a-f-]{36}/);
    const profile = reception.url();
    for (const tab of ["overview", "visits", "packages", "consents"]) {
      await reception.goto(`${profile}?tab=${tab}`);
      expect(await layoutProblems(reception), `patient profile, tab ${tab}`).toEqual([]);
    }
    for (const path of ["/patients/new", "/calendar?view=week", "/calendar?by=room"]) {
      await reception.goto(path);
      expect(await layoutProblems(reception), path).toEqual([]);
    }
    // Dialogs: booking and appointment details.
    await reception.goto("/calendar");
    await reception.getByTestId("new-booking").click();
    expect(await layoutProblems(reception), "booking dialog").toEqual([]);
    await reception.keyboard.press("Escape");
    await reception.getByTestId("appointment").first().click();
    expect(await layoutProblems(reception), "appointment dialog").toEqual([]);

    const doctor = await session(browser, "dr.sara@derma.demo", PHONE);
    await doctor.goto(profile.replace(/^https?:\/\/[^/]+/, "") + "?tab=notes");
    expect(await layoutProblems(doctor), "patient notes").toEqual([]);

    const admin = await session(browser, "admin@derma.demo", PHONE);
    await admin.goto("/settings/consents/laser_hair_removal");
    expect(await layoutProblems(admin), "consent template editor").toEqual([]);
    await admin.goto(profile.replace(/^https?:\/\/[^/]+/, "") + "?tab=consents");
    const print = admin.getByRole("link", { name: "عرض للطباعة" }).first();
    if (await print.count()) {
      await admin.goto((await print.getAttribute("href"))!);
      expect(await layoutProblems(admin), "consent print page").toEqual([]);
    }
  });

  test("the More menu works in English too (left-to-right)", async ({ browser }) => {
    const phone = await session(browser, "admin@derma.demo", PHONE);
    await phone.getByTestId("user-menu").getByRole("button").first().click();
    await phone.getByRole("button", { name: "تغيير اللغة" }).click();
    await expect(phone.locator("html")).toHaveAttribute("dir", "ltr");
    await phone.getByTestId("mobile-nav").getByRole("button", { name: "More" }).click();
    await phone.getByTestId("mobile-more").getByRole("link", { name: "Clinic settings" }).click();
    await expect(phone).toHaveURL(/\/settings$/);
    expect(await layoutProblems(phone)).toEqual([]);
  });
});
