import { test, expect } from "@playwright/test";

test("PAY0 public route loads without blocking console errors", async ({ page }) => {
  const errors = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  page.on("pageerror", (err) => {
    errors.push(err.message);
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toBeVisible();
  await page.waitForTimeout(2000);

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
