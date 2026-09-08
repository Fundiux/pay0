import { test as setup, expect } from "@playwright/test";

const authFile = "qa/.auth/superadmin.json";

setup("login superadmin with firebase email password", async ({ page }) => {
  const email = process.env.PAY0_QA_EMAIL;
  const password = process.env.PAY0_QA_PASSWORD;

  if (!email || !password) {
    throw new Error("Missing PAY0_QA_EMAIL or PAY0_QA_PASSWORD env vars");
  }

  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.locator("input[type=email], input[name=email], input[placeholder*=correo i], input[placeholder*=email i]").first().fill(email);
  await page.locator("input[type=password], input[name=password], input[placeholder*=password i], input[placeholder*=contrasena i]").first().fill(password);
  await page.locator("button[type=submit], button:has-text(\"Entrar\"), button:has-text(\"Login\"), button:has-text(\"Iniciar\")").first().click();

  await page.waitForURL((url) => !url.pathname.includes("login"), { timeout: 30000 });
  await expect(page.locator("body")).toBeVisible();
  await page.context().storageState({ path: authFile });
});
