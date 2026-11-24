import { randomUUID } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    extraHTTPHeaders: {
      "x-test-client-id":
        process.env.E2E_TEST_CLIENT_ID ?? `playwright-${randomUUID()}`,
    },
    ...devices["Desktop Chrome"],
  },
});
