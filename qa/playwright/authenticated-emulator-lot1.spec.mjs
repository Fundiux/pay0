import { test, expect } from "@playwright/test";

const client = { id: "qa-client-001", name: "Cliente sintético QA", razonSocial: "Cliente sintético QA", active: true };

async function stubLocalCallables(page) {
  await page.route("http://127.0.0.1:5001/**", async (route) => {
    const operation = new URL(route.request().url()).pathname.split("/").pop();
    const data = operation === "listClientsCanonical" ? { clients: [client] }
      : operation === "listClientDispersions" ? { items: [], dispersions: [] }
      : operation === "listUsersByRole" ? { users: [] }
      : {};
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ data }),
    });
  });
}

async function screenshot(page, name) {
  await page.screenshot({ path: `test-results/authenticated-emulator/${name}-${page.viewportSize().width}.png`, fullPage: true });
}

test.beforeEach(async ({ page }) => { await stubLocalCallables(page); });

test("Modal on Usuarios restores focus after Escape", async ({ page }) => {
  await page.goto("/usuarios", { waitUntil: "domcontentloaded" });
  const opener = page.getByRole("button", { name: "+ Nuevo usuario" });
  await expect(opener).toBeVisible();
  await opener.focus();
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Nuevo usuario" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Nuevo usuario");
  await expect(dialog.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("Beneficiarios and Dispersiones use the real UiSelect inside real modals", async ({ page }) => {
  await page.goto("/wallet/beneficiarios", { waitUntil: "domcontentloaded" });
  const clientSelect = page.getByRole("button", { name: "Selecciona cliente" });
  await expect(clientSelect).toBeVisible();
  await clientSelect.click();
  await page.getByRole("option", { name: "Cliente sintético QA" }).click();
  const beneficiaryOpener = page.getByRole("button", { name: "+ Beneficiario" });
  await expect(beneficiaryOpener).toBeEnabled();
  await beneficiaryOpener.focus();
  await beneficiaryOpener.click();
  const beneficiaryDialog = page.getByRole("dialog");
  await expect(beneficiaryDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(beneficiaryOpener).toBeFocused();

  await page.goto("/wallet/dispersiones", { waitUntil: "domcontentloaded" });
  const dispersionClientSelect = page.getByRole("button", { name: "Todos los clientes" });
  await expect(dispersionClientSelect).toBeVisible();
  await dispersionClientSelect.click();
  await page.getByRole("option", { name: "Cliente sintético QA" }).click();
  const dispersionOpener = page.getByRole("button", { name: "+ Dispersion", exact: true });
  await expect(dispersionOpener).toBeEnabled();
  await dispersionOpener.focus();
  await dispersionOpener.click();
  await expect(page.getByRole("dialog", { name: "Nueva dispersión" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dispersionOpener).toBeFocused();
});

test("Clientes confirmation closes safely and DateScopeBar is operable at all target widths", async ({ page }) => {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/clientes", { waitUntil: "domcontentloaded" });
    const opener = page.getByRole("button", { name: "Reparar C00" });
    await expect(opener).toBeVisible();
    await opener.focus();
    await opener.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();

    await page.goto("/reportes", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "MES" }).click();
    const calendar = page.getByRole("button", { name: "Seleccionar periodo personalizado" });
    await calendar.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Mes anterior/ })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(calendar).toBeFocused();
    await screenshot(page, "reportes-datescope");
  }
});
