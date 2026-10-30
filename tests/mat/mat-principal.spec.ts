import { expect, test, type Page } from "@playwright/test";

const baseUrl = process.env.MAT_BASE_URL || "http://localhost:3000";

type RouteCase = {
  path: string;
  identity: string;
  bottomNav: Array<{ label: string; hash: string; target: string }>;
  quickAction: { label: string; hash: string; target: string };
};

const commonForbidden = [
  "MAT Usuarios",
  "MAT Clientes",
  "Modo local preview",
  "local preview",
  "Mock local",
  "backend pendiente",
  "Oil Spill Control Solutions",
  "Beneficiario validado",
  "Factura XML recibida",
  "Pago aplicado",
  "Solicitud S1C1U1E28",
  "Dispersion D1C1U1E09",
  "$150,000.00",
  "$50,000.00",
  "$25,000.00",
  "Ã",
  "V2",
  "Beta",
];

const cases: RouteCase[] = [
  {
    path: "/mat/usuarios",
    identity: "Usuario",
    bottomNav: [
      { label: "Inicio", hash: "inicio", target: "inicio" },
      { label: "Solicitudes", hash: "solicitudes", target: "solicitudes" },
      { label: "Pagos", hash: "pagos", target: "pagos" },
      { label: "Disp.", hash: "dispersiones", target: "dispersiones" },
      { label: "Movs.", hash: "docs", target: "docs" },
    ],
    quickAction: { label: "Solicitudes", hash: "solicitudes", target: "solicitudes" },
  },
  {
    path: "/mat/clientes",
    identity: "Cliente",
    bottomNav: [
      { label: "Inicio", hash: "inicio", target: "inicio" },
      { label: "Solicitudes", hash: "solicitudes", target: "solicitudes" },
      { label: "Pagos", hash: "pagos", target: "pagos" },
      { label: "Disp.", hash: "dispersiones", target: "dispersiones" },
      { label: "Movs.", hash: "docs", target: "docs" },
    ],
    quickAction: { label: "Solicitudes", hash: "solicitudes", target: "solicitudes" },
  },
];

async function attachConsoleGuards(page: Page) {
  const errors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });

  page.on("pageerror", (error) => {
    errors.push(error.message);
  });

  return errors;
}

async function gotoMat(page: Page, path: string) {
  await page.goto(`${baseUrl}${path}`, { waitUntil: "load" });
  await expect(page.getByLabel("Secciones MAT")).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(750);
}

test.describe("MAT experiencia principal", () => {
  test.setTimeout(60000);

  for (const route of cases) {
    test(`${route.path} permite cambiar de sección con un gesto horizontal`, async ({ page }) => {
      await gotoMat(page, route.path);
      await page.locator("#carrusel").evaluate((element) => {
        const verticalStart = new Touch({ identifier: 2, target: element, clientX: 220, clientY: 600 });
        const verticalEnd = new Touch({ identifier: 2, target: element, clientX: 205, clientY: 250 });
        element.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [verticalStart] }));
        element.dispatchEvent(new TouchEvent("touchend", { bubbles: true, changedTouches: [verticalEnd] }));
      });
      await expect(page.locator("#inicio")).toBeVisible();
      await page.locator("#carrusel").evaluate((element) => {
        const begin = new Touch({ identifier: 1, target: element, clientX: 320, clientY: 400 });
        const end = new Touch({ identifier: 1, target: element, clientX: 80, clientY: 405 });
        element.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [begin] }));
        element.dispatchEvent(new TouchEvent("touchend", { bubbles: true, changedTouches: [end] }));
      });
      await expect(page).toHaveURL(/#solicitudes$/);
      await expect(page.locator("#solicitudes")).toBeVisible();
    });

    test(`${route.path} carga operativo`, async ({ page }) => {
      const consoleErrors = await attachConsoleGuards(page);

      await gotoMat(page, route.path);

      await expect(page.getByTestId("mat-identity")).toHaveCount(0);
      await expect(page.getByLabel(/Estado MAT/i)).toHaveCount(0);
      await expect(page.locator("#inicio")).toHaveAttribute("aria-label", "Operacion PAY0");
      await expect(page.locator("#solicitudes")).toHaveCount(0);
      await expect(page.locator("#pagos")).toHaveCount(0);
      await expect(page.locator("#dispersiones")).toHaveCount(0);
      await expect(page.locator("#docs")).toHaveCount(0);
      await expect(page.locator("nav")).toBeVisible();

      for (const forbidden of commonForbidden) {
        await expect(page.locator("body")).not.toContainText(forbidden);
      }

      expect(consoleErrors, "Consola sin errores rojos").toEqual([]);
    });

    test(`${route.path} bottom nav funciona`, async ({ page }) => {
      const consoleErrors = await attachConsoleGuards(page);

      await gotoMat(page, route.path);

      for (const item of route.bottomNav) {
        await page.locator("nav").getByRole("button", { name: new RegExp(item.label, "i") }).click();
        await expect(page).toHaveURL(new RegExp(`#${item.hash}$`));
        await expect(page.locator(`#${item.target}`)).toBeVisible();
      }

      expect(consoleErrors, "Consola sin errores rojos").toEqual([]);
    });

    test(`${route.path} quick action navega a slide`, async ({ page }) => {
      const consoleErrors = await attachConsoleGuards(page);

      await gotoMat(page, route.path);

      await page
        .locator("#inicio")
        .getByRole("button", { name: new RegExp(route.quickAction.label, "i") })
        .click();

      await expect(page).toHaveURL(new RegExp(`#${route.quickAction.hash}$`));
      await expect(page.locator(`#${route.quickAction.target}`)).toBeVisible();

      expect(consoleErrors, "Consola sin errores rojos").toEqual([]);
    });
  }

  test("/mat/usuarios reserva el formulario de pago para la sesión vinculada", async ({ page }) => {
    await gotoMat(page, "/mat/usuarios");
    await page.locator("nav").getByRole("button", { name: /Pagos/i }).click();
    await expect(page.getByRole("link", { name: "Abrir pagos en PAY0" })).toHaveAttribute("href", "/pagos");
    await expect(page.getByRole("button", { name: "Nuevo pago" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Subir pago" })).toHaveCount(0);
  });

  test("/mat/clientes muestra consultas sin prometer mutaciones", async ({ page }) => {
    await gotoMat(page, "/mat/clientes");
    await page.locator("nav").getByRole("button", { name: /Pagos/i }).click();
    await expect(page.locator("#pagos")).toBeVisible();
    await expect(page.getByRole("button", { name: /Subir pago|Solicitar retorno|Subir archivo/i })).toHaveCount(0);
  });
});
