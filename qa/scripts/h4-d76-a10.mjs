import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const count = (text, regex) => (text.match(regex) || []).length;
const reconciliation = read("functions/src/modules/iq/solicitudReconciliationCallables.ts");
const status = read("functions/src/modules/iq/solicitudStatusMonitorCallables.ts");
const invoices = read("functions/src/modules/iq/solicitudInvoiceImportCallables.ts");
const pagos = read("functions/src/modules/iq/pagoDepositCallables.ts");
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`); };
const superGate = /assertIqAuthorized\(request, \{ allowedRoles: \["superadmin"\] \}\)/g;

test("conciliacion manual de Solicitud IQ exige superadmin activo", () => assert.equal(count(reconciliation, superGate), 1));
test("sincronizacion manual de estado IQ exige superadmin activo", () => assert.equal(count(status, superGate), 1));
test("sincronizar e importar facturas IQ exige superadmin activo", () => assert.equal(count(invoices, superGate), 2));
test("cuatro acciones administrativas de depositos exigen superadmin activo", () => assert.equal(count(pagos, superGate), 4));
test("los controles de rol superadmin existentes permanecen", () => {
  assert.match(reconciliation, /assertSuperAdmin\(auth\)/);
  assert.match(status, /assertSuperAdmin\(auth\)/);
  assert.ok(count(pagos, /Solo [Ss]uper ?[Aa]dmin/g) >= 4);
});

console.log(`H4-D76-A10 QA: ${passed}/${passed} pruebas OK.`);
