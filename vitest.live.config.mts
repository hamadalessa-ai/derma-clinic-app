import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * The AI receptionist check against the REAL model (costs a little, needs ANTHROPIC_API_KEY).
 * Not part of `pnpm check`: run by the GitHub workflow "AI receptionist check" or `pnpm test:ai-live`.
 * Same set-up as vitest.config.mts (fresh test database), only the files differ.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/empty-module.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests-live/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup-env.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
  },
});
