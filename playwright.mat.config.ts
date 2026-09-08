import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/mat",
  testMatch: "**/*.spec.ts",
  timeout: 30000,
  expect: {
    timeout: 7000,
  },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "qa/reports/mat-playwright-html", open: "never" }],
  ],
  use: {
    baseURL: process.env.MAT_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});