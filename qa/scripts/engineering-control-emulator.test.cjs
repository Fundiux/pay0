// Real callable handlers and component, strictly against a local demo emulator.
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8185";
process.env.GCLOUD_PROJECT = "demo-pay0";
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw Error("Local emulator required");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { chromium, expect } = require("@playwright/test");
const ts = require("typescript");
const candidateFixture = require("./fixtures/engineering-candidate.cjs");
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
  for (const name of ["getControlCenterEngineering", "recordAgent007Observation", "listAgent007Observations", "importControlCenterEngineeringEvidence"]) {
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
  const report = candidateFixture();
  await assert.rejects(engineering.importControlCenterEngineeringEvidence.run({ auth, data: { moduleId: "pagos", observationId: foreign.observationId, report } }), error => error.code === "permission-denied");
  await assert.rejects(engineering.importControlCenterEngineeringEvidence.run({ auth, data: { moduleId: "users", observationId: own.observationId, report } }), error => error.code === "permission-denied");
  const imported = await Promise.all([1, 2].map(() => engineering.importControlCenterEngineeringEvidence.run({ auth, data: { moduleId: "pagos", observationId: own.observationId, report, rootId: `${root}-foreign`, actorUid: "forged" } })));
  assert.equal(imported[0].id, imported[1].id);
  assert.equal(imported.filter(result => result.created).length, 1);
  const recorded = (await db.doc(`agent007Observations/${imported[0].id}`).get()).data();
  assert.equal(recorded.rootId, root); assert.equal(recorded.actorUid, root);
  assert.equal(recorded.caseId, payload.caseId);
  assert.equal(recorded.engineeringEvidence.publication, "UNKNOWN");
  assert.equal(recorded.engineeringEvidence.provenance, "HUMAN_IMPORTED");
  assert.equal(recorded.agentId, undefined);
  const importLogs = await db.collection("hugoActivityLog").where("referenceId", "==", imported[0].id).get();
  assert.equal(importLogs.size, 1);
  const foreignImport = await engineering.importControlCenterEngineeringEvidence.run({ auth: { uid: `${root}-foreign`, token: {} }, data: { moduleId: "pagos", report, rootId: root } });
  assert.notEqual(foreignImport.id, imported[0].id);
  assert.equal((await db.doc(`agent007Observations/${foreignImport.id}`).get()).get("rootId"), `${root}-foreign`);
  assert.ok(!(await hugo.listAgent007Observations.run({ auth, data: {} })).observations.some(row => row.id === foreignImport.id));
  await db.doc(`users/${root}`).update({ isDeleted: true });
  await assert.rejects(engineering.importControlCenterEngineeringEvidence.run({ auth, data: { moduleId: "pagos", report } }), error => error.code === "permission-denied");
  await db.doc(`users/${root}`).update({ isDeleted: admin.firestore.FieldValue.delete() });

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
      const services = Object.fromEntries(["getControlCenterEngineering", "listAgent007Observations", "listAgent007Traces", "recordAgent007Observation", "importControlCenterEngineeringEvidence"].map(name => [name, data => window.qaCall(name, data)]));
      const require = name => name === "react" ? window.React : name === "next/link" ? { __esModule: true, default: props => window.React.createElement("a", props) } : services;
      const exports = {}; new Function("require", "exports", js)(require, exports);
      window.ReactDOM.createRoot(document.getElementById("root")).render(window.React.createElement(exports.default));
    }, compiled);
    await expect(page.getByText("Comprobante sintético", { exact: true })).toBeVisible();
    await page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Comprobante sintético", exact: true }) }).getByRole("button", { name: "Agregar avance" }).click();
    await page.getByLabel("Estado declarado").selectOption("Bloqueado");
    await page.getByLabel("Decisión, avance y evidencia").fill("Falta fixture aprobado. Sin publicación.");
    await page.getByRole("button", { name: "Registrar seguimiento" }).click();
    await expect(page.getByText("Falta fixture aprobado. Sin publicación.", { exact: true })).toBeVisible();
    const after = await hugo.listAgent007Observations.run({ auth, data: {} });
    assert.equal(after.observations.filter(row => row.caseId === payload.caseId && !row.engineeringEvidence).length, 2);
    assert.ok(after.observations.some(row => row.id === own.observationId && row.outcome === "Pendiente de desarrollo"));
    assert.ok(after.observations.some(row => row.caseId === payload.caseId && row.outcome === "Bloqueado"));
    await page.getByLabel("Incidencia o mejora", { exact: true }).fill("Nueva mejora sintética");
    await page.getByLabel("Decisión, avance y evidencia").fill("Comprobación de alta sin datos reales.");
    await page.getByRole("button", { name: "Registrar seguimiento" }).click();
    await expect(page.getByText("Nueva mejora sintética", { exact: true })).toBeVisible();
    const created = (await hugo.listAgent007Observations.run({ auth, data: {} })).observations.find(row => row.intent === "Nueva mejora sintética");
    assert.match(created.caseId, /^pagos:[a-f0-9-]{36}$/);
    assert.notEqual(created.caseId, payload.caseId);
    await page.getByLabel("Reporte local del candidato").setInputFiles({ name: "evidence.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(report)) });
    await page.getByRole("button", { name: "Importar evidencia local", exact: true }).click();
    await expect(page.getByText("Evidencia importada con tu identidad.", { exact: false })).toBeVisible();
    await expect(page.getByText("Evidencia local importada por usuario", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Importar evidencia local", exact: true }).click();
    await expect(page.getByText("Esta misma evidencia ya está registrada", { exact: false })).toBeVisible();
    const logs = await db.collection("hugoActivityLog").where("rootId", "==", root).get();
    assert.ok(logs.docs.some(doc => doc.data().event === "AGENTE_007_OBSERVACION"));
    assert.deepEqual(errors, []);
    console.log("PASS engineering: authorization, forged role denial, root isolation, real observation UI, append-only progress, audit event");
  } finally { await browser.close(); }
}
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
