import { chromium } from "@playwright/test";
const [out, email, path, w, h] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await (
  await browser.newContext({ viewport: { width: +w || 1366, height: +h || 900 }, locale: "ar-SA" })
).newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto("http://derma.localhost:3000/login");
await page.getByLabel("البريد الإلكتروني").fill(email);
await page.getByLabel("كلمة المرور").fill("Demo-Local-2026");
await page.getByRole("button", { name: "دخول" }).click();
await page.waitForURL("http://derma.localhost:3000/");
await page.goto("http://derma.localhost:3000" + path);
await page.waitForTimeout(1500);
await page.screenshot({ path: out, fullPage: false });
console.log(await page.title());
await browser.close();
