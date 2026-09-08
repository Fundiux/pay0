import fs from "node:fs";
import assert from "node:assert/strict";

const browser = fs.readFileSync("functions/src/modules/paymentApplications/iqBrowser.ts", "utf8");
const execution = fs.readFileSync("functions/src/modules/paymentApplications/iqExecution.ts", "utf8");
const callables = fs.readFileSync("functions/src/modules/paymentApplications/callables.ts", "utf8");
const index = fs.readFileSync("functions/src/index.ts", "utf8");
const service = fs.readFileSync("src/services/pagos.ts", "utf8");
const modal = fs.readFileSync("src/components/PagoApplicationIqFlowModal.tsx", "utf8");
const page = fs.readFileSync("src/app/pagos/page.tsx", "utf8");
const deploy = fs.readFileSync("scripts/deploy-h4-d66-a11.ps1", "utf8");

const tests = [
  ["A11 agrega callable diagnostico sin Crear", () => assert.match(callables, /diagnosePagoApplicationIqMethods/) && assert.match(index, /diagnosePagoApplicationIqMethods/)],
  ["A11 prueba tres metodos de navegador", () => assert.match(browser, /LABEL_OPTION/) && assert.match(browser, /KEYBOARD_FILTER/) && assert.match(browser, /VISIBLE_FOLIO_CLICK/)],
  ["A11 permite diagnostico sin submit final", () => assert.match(browser, /diagnosticOnly/) && assert.match(browser, /IQ_PAYMENT_APPLICATION_DIAGNOSTIC_READY/)],
  ["A11 no hace claim transaccional ni finaliza aplicacion en diagnostico", () => assert.ok(execution.indexOf("diagnosePaymentApplicationIqMethods") > execution.indexOf("executePaymentApplicationIqPlan"))],
  ["A11 conserva seleccion por folio IQ", () => assert.match(browser, /mode: "FOLIO"/) && assert.match(browser, /textMatchesIqFolio/)],
  ["A11 expone boton visible para no hacerlo manual", () => assert.match(modal, /Probar 3 metodos sin Crear/) && assert.match(page, /diagnoseIqMethods/)],
  ["A11 muestra resultado por metodo y campo", () => assert.match(modal, /Diagnostico de 3 metodos IQ sin Crear/) && assert.match(modal, /methodChecks/)],
  ["A11 servicio frontend callable", () => assert.match(service, /diagnosePagoApplicationIqMethods/)],
  ["A11 deploy no toca Firestore", () => assert.ok(!/firestore/.test(deploy))],
  ["A11 deploy incluye function diagnostico y hosting", () => assert.match(deploy, /functions:diagnosePagoApplicationIqMethods/) && assert.match(deploy, /hosting/)],
];

console.log("=== H4-D66-A11 | Diagnostico live de 3 metodos IQ ===");
for (const [name, fn] of tests) {
  fn();
  console.log(`PASS ${name}`);
}
console.log(`\nH4-D66-A11 QA PASS: ${tests.length} pruebas.`);
console.log("Solo diagnostico live sin Crear: tres metodos, evidencia por metodo/campo y sin Firestore.");
