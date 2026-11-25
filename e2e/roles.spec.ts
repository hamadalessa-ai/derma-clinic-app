import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.DEMO_PASSWORD ?? "Demo-Local-2026";

async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "دخول" }).click();
}

async function loginOk(page: Page, email: string) {
  await login(page, email);
  await expect(page).toHaveURL(/\/$/);
}

test("the login page is Arabic, right-to-left, with the clinic's brand", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.getByText("عيادات ديرما").first()).toBeVisible();
  await expect(page.getByText("نسخة تجريبية")).toBeVisible();
});

test("wrong password is rejected", async ({ page }) => {
  await login(page, "admin@derma.demo", "wrong-password-123");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("a Lamsa admin cannot sign in to Derma Clinics", async ({ page }) => {
  await login(page, "admin@lamsa.demo");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("pages need a login", async ({ page }) => {
  await page.goto("/patients");
  await expect(page).toHaveURL(/\/login$/);
});

const ROLES = [
  {
    email: "admin@derma.demo",
    nameAr: "نوال",
    role: "مدير العيادة",
    notes: false, // admins only see notes if they are also a practitioner
    patients: true,
    platform: false,
  },
  {
    email: "dr.sara@derma.demo",
    nameAr: "سارة",
    role: "طبيب",
    notes: true,
    patients: true,
    platform: false,
  },
  {
    email: "dr.lina@derma.demo",
    nameAr: "لينا",
    role: "طبيب",
    notes: true,
    patients: true,
    platform: false,
  },
  {
    email: "reception.riyadh1@derma.demo",
    nameAr: "هند",
    role: "موظف استقبال",
    notes: false,
    patients: true,
    platform: false,
  },
  {
    email: "reception.jeddah@derma.demo",
    nameAr: "أمل",
    role: "موظف استقبال",
    notes: false,
    patients: true,
    platform: false,
  },
  {
    email: "owner@platform.demo",
    nameAr: "مالك المنصة",
    role: "مالك المنصة",
    notes: false,
    patients: false,
    platform: true,
  },
];

for (const r of ROLES) {
  test(`${r.email} (${r.role}) sees only what the role allows`, async ({ page }) => {
    await loginOk(page, r.email);
    await expect(page.getByText(r.role).first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(r.nameAr);

    // Patients: Derma's 40 fake patients (plus any booked online by other tests), never Lamsa's.
    await page.goto("/patients");
    if (r.patients) {
      await expect(page.getByRole("heading", { name: "المرضى" })).toBeVisible();
      await expect(page.getByText("D-0040")).toBeVisible();
      expect(await page.locator("tbody tr").count()).toBeGreaterThanOrEqual(40);
      await expect(page.getByText("D-0001")).toBeVisible();
      await expect(page.getByText(/^L-\d{4}$/)).toHaveCount(0);
    } else {
      await expect(page).toHaveURL(/\/forbidden$/);
    }

    await page.goto("/clinical-notes");
    if (r.notes)
      await expect(page.getByRole("heading", { name: "الملاحظات السريرية" })).toBeVisible();
    else await expect(page).toHaveURL(/\/forbidden$/);

    await page.goto("/platform");
    if (r.platform) await expect(page.getByText("عيادة لمسة")).toBeVisible();
    else await expect(page).toHaveURL(/\/forbidden$/);
  });
}

test("services list shows 22 services with SAR prices", async ({ page }) => {
  await loginOk(page, "reception.riyadh1@derma.demo");
  await page.goto("/services");
  await expect(page.locator("tbody tr")).toHaveCount(22);
  await expect(page.getByText("بوتوكس")).toBeVisible();
  await expect(page.getByText("ر.س").first()).toBeVisible();
});

test("the admin can switch between Riyadh and Jeddah", async ({ page }) => {
  await loginOk(page, "admin@derma.demo");
  const select = page.locator("header select");
  await expect(select).toBeVisible();
  await select.selectOption({ label: "فرع جدة" });
  await expect(page.getByText("الأجهزة · فرع جدة")).toBeVisible();
  await select.selectOption({ label: "فرع الرياض" });
  await expect(page.getByText("الأجهزة · فرع الرياض")).toBeVisible();
});

test("a Jeddah doctor has no branch switcher and sees Jeddah only", async ({ page }) => {
  await loginOk(page, "dr.lina@derma.demo");
  await expect(page.locator("header select")).toHaveCount(0);
  await expect(page.getByText("فرع جدة").first()).toBeVisible();
});

test("English toggle switches to left-to-right", async ({ page }) => {
  await loginOk(page, "admin@derma.demo");
  await page.getByTestId("user-menu").getByRole("button").first().click();
  await page.getByRole("button", { name: "تغيير اللغة" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByText("Derma Clinics").first()).toBeVisible();
  await page.getByTestId("user-menu").getByRole("button").first().click();
  await page.getByRole("button", { name: "Change language" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

test("signing out ends the session", async ({ page }) => {
  await loginOk(page, "admin@derma.demo");
  await page.getByTestId("user-menu").getByRole("button").first().click();
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/patients");
  await expect(page).toHaveURL(/\/login$/);
});
