import { test, expect } from "@playwright/test";

const client = { id: "qa-client-001", name: "Cliente sintÃ©tico QA", razonSocial: "Cliente sintÃ©tico QA", active: true };

async function stubLocalCallables(page) {
  await page.route("http://127.0.0.1:5001/**", async (route) => {
    const operation = new URL(route.request().url()).pathname.split("/").pop();
    const data = operation === "listClientsCanonical" ? { clients: [client] }
      : operation === "listClientDispersions" ? { items: [], dispersions: [] }
      : operation === "listUsersByRole" ? { users: [] }
      : operation === "listPaymentComplementFollowup" ? {
        ok: true,
        rows: [],
        truncated: false,
        automation: { iqEnabled: false, iqLookupEnabled: false, facturamaEnabled: false },
      }
      : operation === "getControlCenterOverview" || operation === "refreshControlCenterOverview" ? { snapshot: { generatedAt: "2026-01-31T00:00:00.000Z", totals: {}, alerts: [] } }
      : operation === "getControlCenterAnalytics" ? {
        ok: true,
        from: "2026-01-01",
        to: "2026-01-31",
        timezone: "America/Mexico_City",
        totals: {},
        previous: {},
        daily: [],
        current: {},
        coverage: { complete: true, source: 0, processed: 0, expensesComplete: true },
      }
      : operation === "getControlCenterEvidence" ? {
        rows: [],
        incidents: [],
        facets: [],
        incidentsTruncated: false,
        facetsTruncated: false,
      }
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

async function expectModalViewportAndKeyboard(page, dialog) {
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
  await page.keyboard.press("Tab");
  await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
}

test.beforeEach(async ({ page }, testInfo) => {
  console.log(`QA_AUTH_STAGE scenario:start name=${testInfo.title}`);
  await stubLocalCallables(page);
});

test.afterEach(async ({}, testInfo) => {
  console.log(`QA_AUTH_STAGE scenario:done name=${testInfo.title} status=${testInfo.status} durationMs=${testInfo.duration}`);
});

test("Modal on Usuarios restores focus after Escape", async ({ page }) => {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/usuarios", { waitUntil: "domcontentloaded" });
    const opener = page.getByRole("button", { name: "+ Nuevo usuario" });
    await expect(opener).toBeVisible();
    await opener.focus();
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Nuevo usuario" });
    await expect(dialog).toContainText("Nuevo usuario");
    await expectModalViewportAndKeyboard(page, dialog);
    await expect(dialog.locator("input").nth(1)).toBeVisible();
    await screenshot(page, "usuarios-modal");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  }
});

test("Beneficiarios use UiSelect inside the real modal", async ({ page }) => {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/wallet/beneficiarios", { waitUntil: "domcontentloaded" });
    const clientSelect = page.getByRole("button", { name: "Selecciona cliente" });
    await clientSelect.click();
    await page.getByRole("option", { name: /Cliente sint/ }).click();
    const beneficiaryOpener = page.getByRole("button", { name: "+ Beneficiario" });
    await expect(beneficiaryOpener).toBeEnabled();
    await beneficiaryOpener.focus();
    await beneficiaryOpener.click();
    const beneficiaryDialog = page.getByRole("dialog");
    await expectModalViewportAndKeyboard(page, beneficiaryDialog);
    const nameInput = beneficiaryDialog.getByPlaceholder("Nombre del beneficiario");
    await nameInput.fill("Beneficiario QA");
    await expect(nameInput).toHaveValue("BENEFICIARIO QA");
    await screenshot(page, "beneficiarios-modal");
    await page.keyboard.press("Escape");
    await expect(beneficiaryDialog).toBeHidden();
    await expect(beneficiaryOpener).toBeFocused();
  }
});
test("Dispersiones use UiSelect inside the real modal", async ({ page }) => {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/wallet/dispersiones", { waitUntil: "domcontentloaded" });
    const dispersionClientSelect = page.getByRole("button", { name: "Todos los clientes" });
    await dispersionClientSelect.click();
    await page.getByRole("option", { name: /Cliente sint/ }).click();
    const dispersionOpener = page.getByRole("button", { name: "+ Dispersion", exact: true });
    await expect(dispersionOpener).toBeEnabled();
    await dispersionOpener.focus();
    await dispersionOpener.click();
    const dialog = page.getByRole("dialog");
    await expectModalViewportAndKeyboard(page, dialog);
    const reference = dialog.getByPlaceholder("Referencia operativa");
    await reference.fill("QA responsive");
    await expect(reference).toHaveValue("QA responsive");
    await screenshot(page, "dispersiones-modal");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(dispersionOpener).toBeFocused();
  }
});
test("Clientes no expone Reparar C00 en todos los anchos", async ({ page }) => {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/clientes", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Reparar C00" })).toHaveCount(0);

  }
});

test("DateScopeBar es operable en todos los anchos", async ({ page }) => {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/activity-log", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "MES" }).click();
    const calendar = page.getByRole("button", { name: "Seleccionar periodo personalizado" });
    await calendar.click();
    const calendarDialog = page.getByRole("dialog");
    await expect(calendarDialog).toBeVisible();
    await expect(calendarDialog).toHaveAttribute("aria-modal", "false");
    await expect(page.getByRole("button", { name: /Mes anterior/ })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(calendar).toBeFocused();
    await screenshot(page, "activity-datescope");
  }
});
test("DateScopeBar es operable en Reportes en todos los anchos", async ({ page }) => {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const browserDiagnostics = [];
    page.on("console", message => { if (["error", "warning"].includes(message.type())) browserDiagnostics.push(`${message.type()}:${message.text()}`); });
    page.on("pageerror", error => browserDiagnostics.push(`pageerror:${error.message}`));
    await page.goto("/reportes", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const rendered = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 1600);
    console.log(`QA_AUTH_REPORTES_STATE url=${page.url()} body=${JSON.stringify(rendered)} diagnostics=${JSON.stringify(browserDiagnostics)}`);
    await expect(page.getByText("No tienes acceso a Reportes.")).toHaveCount(0);
    const month = page.getByRole("button", { name: "MES" });
    await expect(month).toBeVisible();
    await month.click();
    const calendar = page.getByRole("button", { name: "Seleccionar periodo personalizado" });
    await calendar.click();
    const calendarDialog = page.getByRole("dialog");
    await expect(calendarDialog).toBeVisible();
    await expect(calendarDialog).toHaveAttribute("aria-modal", "false");
    await expect(page.getByRole("button", { name: /Mes anterior/ })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(calendar).toBeFocused();
    await screenshot(page, "reportes-datescope");
  }
});