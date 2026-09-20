// Component-level browser test against real callable handlers + local Firestore.
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8180";
process.env.GCLOUD_PROJECT = "demo-pay0";
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw Error("Local emulator required");
const fs = require("node:fs"), path = require("node:path");
const { chromium, expect } = require("@playwright/test");
const ts = require("typescript");
const admin = require("../../functions/node_modules/firebase-admin");
admin.initializeApp({ projectId: "demo-pay0" });
const api = require("../../functions/lib/modules/controlCenter/analyticsCallables.js");
const db = admin.firestore(), root = `cc-ui-${Date.now()}`, auth = { uid: root, token: {} };
async function run() {
  await db.doc(`users/${root}`).set({ rootId: root, role: "superadmin", active: true });
  await db.doc(`pagos/${root}`).set({ rootId: root, monto: 100, status: "CONCILIADO", createdAt: new Date("2026-09-19T18:00:00Z"), companyId: "demo-company", companyName: "Empresa de prueba", financialPostingStatus: "POSTED", superadminAmount: 5 });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.exposeFunction("qaCall", (name, data) => api[name].run({ auth, data: data || {} }));
    await page.setContent('<html><body style="background:#0b1220;color:white;font-family:Arial"><div id="root"></div></body></html>');
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve("react")), "umd/react.development.js") });
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve("react-dom")), "umd/react-dom.development.js") });
    const cssRoot = path.resolve(".next/static/css");
    if (fs.existsSync(cssRoot)) for (const css of fs.readdirSync(cssRoot).filter(f => f.endsWith(".css"))) await page.addStyleTag({ path: path.join(cssRoot, css) });
    const source = 'import * as React from "react";\n' + fs.readFileSync("src/components/control-center/ControlCenterAnalytics.tsx", "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    await page.evaluate(js => {
      const services = Object.fromEntries(["getControlCenterAnalytics", "getControlCenterEvidence", "initializeControlCenterAnalytics"].map(name => [name, data => window.qaCall(name, data)]));
      const require = name => name === "react" ? window.React : name === "next/link" ? { __esModule: true, default: p => window.React.createElement("a", p) } : services;
      const exports = {}; new Function("require", "exports", js)(require, exports);
      const root = window.ReactDOM.createRoot(document.getElementById("root"));
      window.showPeriod = day => root.render(window.React.createElement(exports.default, { from: new Date(`${day}T12:00:00`), to: new Date(`${day}T12:00:00`) }));
      window.showPeriod("2026-09-19");
    }, compiled);
    await expect(page.getByText("Histórico todavía incompleto.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Consolidar / reanudar histórico" }).click();
    await expect(page.getByText("Histórico todavía incompleto.", { exact: false })).toHaveCount(0, { timeout: 90000 });
    const payments = page.locator("a").filter({ has: page.getByText("Pagos registrados", { exact: true }) });
    await expect(payments).toContainText("$100.00");
    await page.getByLabel("Dimensión analítica").selectOption("companyId");
    await page.getByLabel("Valor del filtro").selectOption("demo-company");
    await expect(payments).toContainText("$100.00");
    await page.evaluate(() => window.showPeriod("2026-09-20"));
    await expect(payments).toContainText("$0.00");
    if (errors.length) throw Error(errors.join("\n"));
    await page.screenshot({ path: "output/control-center-emulator-ui.png", fullPage: true });
    console.log(JSON.stringify({ ok: true, checks: ["historical bootstrap UI", "company filter", "period change", "real emulator totals", "no browser exceptions"], screenshot: "output/control-center-emulator-ui.png" }));
  } finally { await browser.close(); }
}
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
