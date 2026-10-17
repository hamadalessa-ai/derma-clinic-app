import type { TestProject } from "vitest/node";
import { createLocalDatabase } from "../src/db/local-setup";

export const TEST_DEMO_PASSWORD = "Test-Demo-Password-1";

/** Builds a fresh "derma_test" database from db/setup.sql before the test run. */
export default async function setup(project: TestProject) {
  const adminUrl =
    process.env.DATABASE_URL_ADMIN ?? "postgresql://postgres:localdev@127.0.0.1:5432/postgres";
  const { appUrl, adminUrl: testAdminUrl } = await createLocalDatabase({
    adminUrl,
    dbName: "derma_test",
    demoPassword: TEST_DEMO_PASSWORD,
  });
  project.provide("appUrl", appUrl);
  project.provide("adminUrl", testAdminUrl);
}

declare module "vitest" {
  export interface ProvidedContext {
    appUrl: string;
    adminUrl: string;
  }
}
