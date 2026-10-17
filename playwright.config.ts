import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests in a real browser. Start the app first (`pnpm db:local && pnpm dev`),
 * then run `pnpm e2e`. Uses DEMO_PASSWORD from the environment (default: local demo password).
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://derma.localhost:3000",
    locale: "ar-SA",
    timezoneId: "Asia/Riyadh",
    // Optional: use a pre-installed Chromium instead of Playwright's download.
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : undefined,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
