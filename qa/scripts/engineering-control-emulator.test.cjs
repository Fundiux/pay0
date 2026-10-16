// Real callable handlers and component, strictly against a local demo emulator.
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8185";
process.env.GCLOUD_PROJECT = "demo-pay0";
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw Error("Local emulator required");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { chromium, expect } = require("@playwright/test");
const ts = require("typescript");
const admin = require("../../functions/node_modules/firebase-admin");
admin.initializeApp({ projectId: "demo-pay0" });
const engineering = require("../../functions/lib/modules/controlCenter/engineeringCallables.js");
const hugo = require("../../functions/lib/modules/agent007/callables.js");
const api = { ...engineering, ...hugo };
const db = admin.firestore(), root = `engineering-${Date.now()}`, auth = { uid: root, token: {} };

async function run() {
  await Promise.all([
    db.doc(`users/${root}`).set({ rootId: root, role: "superadmin", active: true }),
    db.doc(`users/${root}-foreign`).set({ rootId: `${root}-foreign`, role: "superadmin", active: true }),
    db.doc(`users/${root}-operator`).set({ rootId: root, role: "operador", active: true }),
  ]);
  const payload = { caseType: "ENGINEERING", caseId: "pagos:synthetic", intent: "Comprobante sintético", humanDecision: "Fixture sin datos reales", outcome: "Pendiente de desarrollo" };
  for (const name of ["getControlCenterEngineering", "recordAgent007Observation", "listAgent007Observations"]) {
    await assert.rejects(api[name].run({ data: payload }), error => error.code === "unauthenticated");
    await assert.rejects(api[name].run({ auth: { uid: `${root}-operator`, token: { role: "superadmin" } }, data: payload }), error => error.code === "permission-denied");
  }
  const foreign = await hugo.recordAgent007Observation.run({ auth: { uid: `${root}-foreign`, token: {} }, data: { ...payload, rootId: root } });
  const own = await hugo.recordAgent007Observation.run({ auth, data: { ...payload, rootId: `${root}-foreign` } });
  const listed = await hugo.listAgent007Observations.run({ auth, data: { rootId: `${root}-foreign` } });
  assert.ok(listed.observations.some(row => row.id === own.observationId));
  assert.ok(!listed.observations.some(row => row.id === foreign.observationId));
  assert.equal((await db.doc(`agent007Observations/${own.observationId}`).get()).data().actorUid, root);
  const catalog = await engineering.getControlCenterEngineering.run({ auth, data: {} });
  assert.equal(catalog.release.deployedVersion, null);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.exposeFunction("qaCall", (name, data) => api[name].run({ auth, data: data || {} }));
    await page.route("http://localhost/engineering-test", route => route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div></body></html>' }));
    await page.goto("http://localhost/engineering-test");
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve("react")), "umd/react.development.js") });
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve("react-dom")), "umd/react-dom.development.js") });
    const source = 'import * as React from "react";\n' + fs.readFileSync("src/components/control-center/EngineeringControl.tsx", "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    await page.evaluate(js => {
      const services = Object.fromEntries(["getControlCenterEngineering", "listAgent007Observations", "listAgent007Traces", "recordAgent007Observation"].map(name => [name, data => window.qaCall(name, data)]));
      const require = name => name === "react" ? window.React : name === "next/link" ? { __esModule: true, default: props => window.React.createElement("a", props) } : services;
      const exports = {}; new Function("require", "exports", js)(require, exports);
      window.ReactDOM.createRoot(document.getElementById("root")).render(window.React.createElement(exports.default));
    }, compiled);
    await expect(page.getByText("Comprobante sintético", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Agregar avance" }).click();
    await page.getByLabel("Estado declarado").selectOption("Bloqueado");
    await page.getByLabel("Decisión, avance y evidencia").fill("Falta fixture aprobado. Sin publicación.");
    await page.getByRole("button", { name: "Registrar seguimiento" }).click();
    await expect(page.getByText("Falta fixture aprobado. Sin publicación.", { exact: true })).toBeVisible();
    const after = await hugo.listAgent007Observations.run({ auth, data: {} });
    assert.equal(after.observations.filter(row => row.caseId === payload.caseId).length, 2);
    assert.ok(after.observations.some(row => row.id === own.observationId && row.outcome === "Pendiente de desarrollo"));
    assert.ok(after.observations.some(row => row.caseId === payload.caseId && row.outcome === "Bloqueado"));
    await page.getByLabel("Incidencia o mejora", { exact: true }).fill("Nueva mejora sintética");
    await page.getByLabel("Decisión, avance y evidencia").fill("Comprobación de alta sin datos reales.");
    await page.getByRole("button", { name: "Registrar seguimiento" }).click();
    await expect(page.getByText("Nueva mejora sintética", { exact: true })).toBeVisible();
    const created = (await hugo.listAgent007Observations.run({ auth, data: {} })).observations.find(row => row.intent === "Nueva mejora sintética");
    assert.match(created.caseId, /^pagos:[a-f0-9-]{36}$/);
    assert.notEqual(created.caseId, payload.caseId);
    const logs = await db.collection("hugoActivityLog").where("rootId", "==", root).get();
    assert.ok(logs.docs.some(doc => doc.data().event === "AGENTE_007_OBSERVACION"));
    assert.deepEqual(errors, []);
    console.log("PASS engineering: authorization, forged role denial, root isolation, real observation UI, append-only progress, audit event");
  } finally { await browser.close(); }
}
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
