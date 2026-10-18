import { test as setup, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";

const fixturePath = "qa/.auth/emulator-fixtures.json";

async function loginAndSave(page, account, password, destination) {
  const startedAt = Date.now();
  console.log(`QA_AUTH_STAGE session:start role=${account.key}`);
  const diagnostics = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") diagnostics.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => diagnostics.push(`requestfailed: ${request.url()} ${request.failure()?.errorText || ""}`));
  page.on("response", (response) => {
    if (response.url().includes(":9099/")) diagnostics.push(`auth-response: ${response.status()} ${response.url()}`);
  });
  await page.route("http://127.0.0.1:5001/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ data: { ok: true } }),
  }));
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  // Next development mode serves the client login bundle after the document.
  // Wait for hydration before submitting so the React handler is attached.
  await page.waitForTimeout(2_000);
  await page.locator("#login-identifier").fill(account.email);
  await page.locator("input[type=password]").fill(password);
  await page.getByRole("button", { name: "Entrar al sistema" }).click();
  console.log(`QA_AUTH_STAGE session:submitted role=${account.key}`);
  await page.waitForTimeout(10_000);
  if (page.url().includes("/login")) {
    throw new Error(`Emulator login did not navigate: ${await page.locator("main").innerText()} | ${diagnostics.join(" | ")}`);
  }
  await page.waitForURL((url) => !url.pathname.includes("login"), { timeout: 30_000 });
  await expect(page.locator("body")).toBeVisible();
  await page.context().storageState({ path: destination, indexedDB: true });
  console.log(`QA_AUTH_STAGE session:done role=${account.key} durationMs=${Date.now() - startedAt}`);
}

setup("creates reusable authenticated emulator sessions for three roles", async ({ browser }) => {
  const fixtures = JSON.parse(await readFile(fixturePath, "utf8"));
  await mkdir("qa/.auth", { recursive: true });
  for (const account of fixtures.accounts) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAndSave(page, account, fixtures.password, `qa/.auth/emulator-${account.key}.json`);
    await context.close();
  }
});
