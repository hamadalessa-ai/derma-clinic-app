import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config.mts";

/**
 * The AI receptionist check against the REAL model (costs a little, needs ANTHROPIC_API_KEY).
 * Not part of `pnpm check`: run by the GitHub workflow "AI receptionist check" or `pnpm test:ai-live`.
 */
export default mergeConfig(
  base,
  defineConfig({
    test: { include: ["tests-live/**/*.test.ts"], testTimeout: 120_000 },
  }),
  false,
);
