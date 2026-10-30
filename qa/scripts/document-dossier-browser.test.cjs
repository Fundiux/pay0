// Real component + real authorized handlers. Only the final URL signer is synthetic.
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8185";
process.env.GCLOUD_PROJECT = "demo-pay0-dossier-browser";
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw Error("Local Firestore emulator required");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { chromium, expect } = require("@playwright/test");
const ts = require("typescript");
const admin = require("../../functions/node_modules/firebase-admin");
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const { listOperationalDocumentsCore } = require("../../functions/lib/modules/canonicalCenter/documentDossier");
const { getAuthorizedDocumentDownloadUrlCore } = require("../../functions/lib/modules/documents/authorizedDownload");
const prefix = `dossier-browser-${Date.now()}`, auth = { uid: prefix, token: {} }, seeded = [];
let signerCalls = 0;
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;

async function run() {
  const batch = db.batch();
  const seed = (location, value) => { seeded.push(location); batch.set(db.doc(location), value); };
  seed(`users/${prefix}`, { rootId: prefix, role: "superadmin", active: true });
  seed(`pagos/${prefix}`, { rootId: prefix, folio: "P-SINTETICO", empresaNombre: "Empresa de prueba", clienteNombre: "Cliente de prueba", active: true });
  for (let index = 0; index < 55; index++) seed(`uploads/${prefix}-${String(index).padStart(2, "0")}`, {
    rootId: prefix, entityType: "pagos", pagoId: prefix, entityId: prefix, active: true, status: "READY", version: 1,
    originalName: index === 54 ? "Cierre final.pdf" : `Recibo ${String(index).padStart(2, "0")}.pdf`, documentType: "COMPROBANTE_PAGO",
    source: index === 0 || index === 54 ? "IQ_INVOICE_ZIP" : "MANUAL", iqFolio: `IQ-SINTETICO-${index}`,
    storagePath: `roots/${prefix}/pagos/${prefix}/docs/${index}.pdf`,
  });
  seed(`uploads/${prefix}-foreign`, { rootId: "foreign-root", entityType: "pagos", pagoId: prefix, originalName: "NO MOSTRAR.pdf", active: true, status: "READY" });
  seed(`uploads/${prefix}-zz-pending`, { rootId: prefix, entityType: 'pagos', pagoId: prefix, originalName: 'Pendiente antiguo.pdf' });
  await batch.commit();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.route("http://localhost/dossier-test", route => route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div></body></html>' }));
    await context.route("https://signed.invalid/**", route => route.fulfill({ contentType: "text/plain", body: "Synthetic authorized download; no Storage access." }));
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.exposeFunction("qaList", cursor => listOperationalDocumentsCore({ auth, data: cursor ? { cursor } : {} }));
    await page.exposeFunction("qaDownload", uploadId => getAuthorizedDocumentDownloadUrlCore({ auth, data: { uploadId } }, async storagePath => {
      signerCalls++;
      assert.ok(storagePath.startsWith(`roots/${prefix}/pagos/${prefix}/`));
      return `https://signed.invalid/${uploadId}.pdf`;
    }));
    await page.goto("http://localhost/dossier-test");
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve("react")), "umd/react.development.js") });
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve("react-dom")), "umd/react-dom.development.js") });
    const component = compile('import * as React from "react";\n' + fs.readFileSync("src/components/corporate-resources/DocumentDossier.tsx", "utf8"));
    const downloadService = compile(fs.readFileSync("src/services/authorizedDocuments.ts", "utf8"));
    await page.evaluate(({ component, downloadService }) => {
      const serviceExports = {};
      const serviceRequire = name => name === "firebase/functions" ? { httpsCallable: () => async data => ({ data: await window.qaDownload(data.uploadId) }) } : { functions: {} };
      new Function("require", "exports", downloadService)(serviceRequire, serviceExports);
      const require = name => name === "react" ? window.React : name === "@/services/documentDossier" ? { listOperationalDocuments: cursor => window.qaList(cursor) } : serviceExports;
      const exports = {}; new Function("require", "exports", component)(require, exports);
      window.ReactDOM.createRoot(document.getElementById("root")).render(window.React.createElement(exports.default));
    }, { component, downloadService });
    await page.getByRole("button", { name: "Consultar expediente", exact: true }).click();
    await expect(page.getByRole("article")).toHaveCount(50);
    await expect(page.getByText("NO MOSTRAR.pdf", { exact: true })).toHaveCount(0);
    await page.getByLabel("Procedencia documental").selectOption("IQ");
    await expect(page.getByRole("article")).toHaveCount(1);
    await page.getByLabel("Buscar en documentos cargados").fill("Cierre final");
    await expect(page.getByRole("article")).toHaveCount(0);
    await page.getByRole("button", { name: "Cargar más registros", exact: true }).click();
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(page.getByRole("status")).toContainText("56 documentos cargados");
    await expect(page.getByRole("button", { name: "Cargar más registros", exact: true })).toHaveCount(0);
    const popupReady = context.waitForEvent("page");
    await page.getByRole("button", { name: "Descargar", exact: true }).click();
    const popup = await popupReady;
    await popup.waitForURL("https://signed.invalid/**");
    assert.equal(signerCalls, 1);
    assert.equal(await popup.evaluate(() => window.opener), null);
    await popup.close();
    await page.getByLabel('Procedencia documental').selectOption('');
    await page.getByLabel('Buscar en documentos cargados').fill('Pendiente antiguo');
    await page.getByLabel('Estado de incorporación').selectOption('PENDING_REVIEW');
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Descargar', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Ver pagos' })).toHaveAttribute('href', '/pagos?q=P-SINTETICO');
    await page.getByLabel('Estado de incorporación').selectOption('AVAILABLE');
    await page.getByLabel('Procedencia documental').selectOption('IQ');
    await page.getByLabel('Buscar en documentos cargados').fill('Cierre final');
    await db.doc(`users/${prefix}`).update({ modules: { pagos: { view: false } } });
    await page.getByRole("button", { name: "Actualizar expediente", exact: true }).click();
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText("0 documentos cargados");
    await db.doc(`users/${prefix}`).update({ modules: admin.firestore.FieldValue.delete() });
    await page.getByRole("button", { name: "Actualizar expediente", exact: true }).click();
    await page.getByRole("button", { name: "Cargar más registros", exact: true }).click();
    await expect(page.getByRole("article")).toHaveCount(1);
    await db.doc(`users/${prefix}`).update({ active: false });
    await page.getByRole("button", { name: "Descargar", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("No fue posible generar temporalmente");
    assert.equal(signerCalls, 1, "Revoked user must never reach URL signer");
    await page.getByRole("button", { name: "Actualizar expediente", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("No se pudo consultar el expediente");
    assert.deepEqual(errors, []);
    console.log("PASS dossier browser: real query/pagination, IQ/search filters, root isolation, authorized signer, isolated popup, revoked download/query denied; no external services");
  } finally { await browser.close(); }
}
run().then(async () => { await Promise.all(seeded.map(location => db.doc(location).delete())); await admin.app().delete(); process.exit(0); }).catch(async error => { console.error(error); await Promise.all(seeded.map(location => db.doc(location).delete())).catch(() => {}); await admin.app().delete(); process.exit(1); });
