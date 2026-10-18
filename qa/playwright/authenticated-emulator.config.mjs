import { defineConfig } from "@playwright/test";

const projectId = "demo-pay0-ui-qa";
const emulatorEnv = {
  NEXT_PUBLIC_USE_EMULATORS: "true",
  NEXT_PUBLIC_FIREBASE_EMULATOR_HOST: "127.0.0.1",
  NEXT_PUBLIC_FIREBASE_API_KEY: "qa-emulator-only",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "127.0.0.1",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: projectId,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${projectId}.appspot.com`,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "000000000000",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:000000000000:web:qa-emulator",
};

export default defineConfig({
  testDir: ".",
  testMatch: "authenticated-emulator-*.spec.mjs",
  timeout: 60_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "test-results/authenticated-emulator-html", open: "never" }]],
  globalSetup: "./authenticated-emulator.global-setup.mjs",
  use: {
    baseURL: "http://127.0.0.1:3100",
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: "authenticated-emulator.auth.setup.spec.mjs" },
    { name: "chromium", dependencies: ["setup"], testMatch: "authenticated-emulator-lot1.spec.mjs", use: { storageState: "qa/.auth/emulator-superadmin.json" } },
  ],
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120_000,
    env: emulatorEnv,
  },
});
