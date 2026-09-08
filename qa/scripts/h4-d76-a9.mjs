import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const count = (text, regex) => (text.match(regex) || []).length;
const admin = read("functions/src/modules/iq/callables.ts");
const calendar = read("functions/src/modules/iq/operatingCalendarCallables.ts");
const dashboard = read("functions/src/modules/iq/automationDashboardCallables.ts");
const control = read("functions/src/modules/iq/automationControlCallables.ts");
const diagnostic = read("functions/src/modules/iq/dispersionDiagnosticCallables.ts");
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`); };

test("todos los callables base IQ validan perfil PAY0 activo", () => {
  assert.match(admin, /async function assertAuth[\s\S]*assertIqAuthorized\(request, \{ allowedRoles: \["superadmin", "admin", "operador"\] \}\)/);
});
test("credenciales y asignaciones IQ conservan techo superadmin", () => {
  assert.ok(count(admin, /await assertSuperAdmin\(request\)/g) >= 8);
  assert.match(admin, /if \(auth\.role !== "superadmin"\)/);
});
test("lectura y cambio de calendario exigen superadmin activo", () => assert.equal(count(calendar, /assertIqAuthorized\(request, \{ allowedRoles: \["superadmin"\] \}\)/g), 2));
test("dashboard de automatizacion exige superadmin activo", () => assert.match(dashboard, /assertIqAuthorized\(request, \{ allowedRoles: \["superadmin"\] \}\)/));
test("omitir seguimiento IQ exige superadmin activo", () => assert.match(control, /assertIqAuthorized\(request, \{ allowedRoles: \["superadmin"\] \}\)/));
test("diagnostico de dispersion IQ exige superadmin activo", () => assert.match(diagnostic, /requireSuperadmin[\s\S]*assertIqAuthorized\(request, \{ allowedRoles: \["superadmin"\] \}\)/));

console.log(`H4-D76-A9 QA: ${passed}/${passed} pruebas OK.`);
