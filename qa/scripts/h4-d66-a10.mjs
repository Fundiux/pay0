import fs from "node:fs";
import assert from "node:assert/strict";

const browser = fs.readFileSync("functions/src/modules/paymentApplications/iqBrowser.ts", "utf8");
const execution = fs.readFileSync("functions/src/modules/paymentApplications/iqExecution.ts", "utf8");
const modal = fs.readFileSync("src/components/PagoApplicationIqFlowModal.tsx", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

const tests = [
  ["A10 elimina match amplio por folio dentro del contenedor", () => assert.ok(!browser.includes("new RegExp(`(^|\\\\D)${expectedNorm"))],
  ["A10 no usa div generico como opcion de dropdown", () => assert.ok(!browser.includes("[role='option'],[data-radix-collection-item],li,div"))],
  ["A10 conserva seleccion por etiqueta cercana", () => assert.match(browser, /labelTextForControl/) && assert.match(browser, /data-pay0-iq-field-token/)],
  ["A10 selecciona deposito y factura por modo FOLIO", () => assert.match(browser, /field: "DEPOSITO"[\s\S]*mode: "FOLIO"/) && assert.match(browser, /field: "FACTURA"[\s\S]*mode: "FOLIO"/)],
  ["A10 conserva mensaje de deposito no coincidente antes del clic final", () => assert.match(browser, /IQ_PAYMENT_APPLICATION_DEPOSIT_NOT_MATCHED/)],
  ["A10 persiste fieldChecks en evidencia backend", () => assert.match(execution, /fieldChecks: result\.fieldChecks/)],
  ["A10 muestra verificacion de campos en modal", () => assert.match(modal, /Verificacion de campos IQ/) && assert.match(modal, /fieldChecks\.map/)],
  ["A10 muestra detalle navegador responseMessage", () => assert.match(modal, /Detalle navegador/) && assert.match(modal, /browserResponseMessage/)],
  ["A10 queda registrado en package.json", () => assert.equal(pkg.scripts["qa:pay0:h4-d66-a10"], "powershell -ExecutionPolicy Bypass -File scripts/run-h4-d66-a10-qa.ps1")],
  ["A10 no agrega scheduler ni trigger", () => assert.ok(!browser.includes("onSchedule(") && !browser.includes("onDocument"))],
];

console.log("=== H4-D66-A10 | Seleccion por folio IQ y evidencia por campo ===");
for (const [name, fn] of tests) {
  fn();
  console.log(`PASS ${name}`);
}
console.log(`\nH4-D66-A10 QA PASS: ${tests.length} pruebas.`);
console.log("Deposito/Factura por folio IQ y evidencia visible OK/NO por campo.");
