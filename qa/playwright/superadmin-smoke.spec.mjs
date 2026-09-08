import { test, expect } from "@playwright/test";

test.use({ storageState: "qa/.auth/superadmin.json" });

test("superadmin can open core modules without red console errors", async ({ page }) => {
  const errors = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  page.on("pageerror", (err) => {
    errors.push(err.message);
  });

  const routes = ["/clientes", "/solicitudes", "/pagos", "/reportes"];

  for (const route of routes) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await expect(page.locator("body")).toBeVisible();
  }

  const filtered = errors.filter((msg) => {
    return !msg.includes("favicon") &&
      !msg.includes("ResizeObserver") &&
      !msg.includes("Cross origin request detected") &&
      !msg.includes("Failed to load resource: the server responded with a status of 404") &&
      !msg.includes("Failed to fetch RSC payload") &&
      !msg.includes("Falling back to browser navigation");
  });

  expect(filtered).toEqual([]);
});
