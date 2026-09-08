import { defineConfig } from "@playwright/test";
import fs from "node:fs";

const operaCandidates = [
  process.env.PAY0_QA_BROWSER_PATH,
  process.env.LOCALAPPDATA + "\\Programs\\Opera GX\\opera.exe",
  process.env.PROGRAMFILES + "\\Opera GX\\opera.exe",
  process.env["PROGRAMFILES(X86)"] + "\\Opera GX\\opera.exe"
].filter(Boolean);

const operaPath = operaCandidates.find((p) => fs.existsSync(p));

if (!operaPath) {
  console.warn("Opera GX no encontrado. Define PAY0_QA_BROWSER_PATH con la ruta de opera.exe.");
}

export default defineConfig({
  testDir: "./qa/playwright",
  testMatch: "**/*.spec.mjs",
  timeout: 45000,
  expect: { timeout: 7000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "qa/reports/playwright-html", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    browserName: "chromium",
    headless: false,
    launchOptions: operaPath ? { executablePath: operaPath } : {},
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    { name: "opera-gx" }
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 120000
  }
});
