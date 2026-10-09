// Browser verification of the visible application reference backed by local Firestore.
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "demo-pay0";
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
  throw Error("Local Firestore emulator required");
}

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { chromium, expect } = require("@playwright/test");
const admin = require("../../functions/node_modules/firebase-admin");

admin.initializeApp({ projectId: "demo-pay0" });
const db = admin.firestore();
const fixtureId = `visible-ids-${Date.now()}`;
const internalApplicationId = "internalApplicationId3xP8qR5sT9uV";

async function run() {
  await db.doc(`qaVisibleIds/${fixtureId}`).set({
    counts: { scanned: 2, detected: 2, processed: 0, pending: 2, errors: 0, excluded: 0, iq: 2, facturama: 0, emisor: 0, waitingB: 0, requestedC: 0, uncertainC: 0, attachmentAvailable: 0, exceptionBlocked: 2, otherPending: 0 },
    exceptions: [
      { applicationId: internalApplicationId, applicationFolio: "", outcome: "PENDING", provider: "IQ", reason: "WAITING_IQ_APPLICATION" },
      { applicationId: "anotherInternalApplicationId4wX", applicationFolio: "AP-042", outcome: "PENDING", provider: "IQ", reason: "WAITING_IQ_APPLICATION" },
    ],
  });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.exposeFunction("readFixture", async () => {
      const snap = await db.doc(`qaVisibleIds/${fixtureId}`).get();
      if (!snap.exists) throw Error("Missing emulator fixture");
      return { ...snap.data(), checkedAt: new Date().toISOString(), complete: true };
    });
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve("react")), "umd/react.development.js") });
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve("react-dom")), "umd/react-dom.development.js") });

    const source = fs.readFileSync("src/components/HugoComplementInventory.tsx", "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    await page.evaluate((js) => {
      const require = (name) => name === "react" ? window.React : { getHugoComplementInventoryPage: () => window.readFixture() };
      const exports = {};
      new Function("require", "exports", js)(require, exports);
      window.ReactDOM.createRoot(document.getElementById("root")).render(window.React.createElement(exports.default));
    }, compiled);

    await expect(page.getByText("Aplicación sin folio", { exact: false })).toBeVisible();
    await expect(page.getByText("AP-042", { exact: false })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(internalApplicationId);
    await expect(page.locator("body")).not.toContainText("anotherInternalApplicationId4wX");
    console.log(JSON.stringify({ ok: true, checks: ["human folio", "missing folio placeholder", "no Firestore application IDs in rendered UI"], emulator: process.env.FIRESTORE_EMULATOR_HOST }));
  } finally {
    await browser.close();
  }
}

run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
