import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");
const dispatches = read("functions/src/modules/dispatches/callables.ts");
const access = read("functions/src/modules/users/access.ts");
const modules = read("functions/src/modules/users/modules.ts");
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };

test("crear o editar despacho queda exclusivo de superadmin", () => {
  const block = dispatches.slice(dispatches.indexOf("export const saveDespachoCallable"), dispatches.indexOf("export const setUserDespachos"));
  assert.match(block, /requireRole\(caller, \["superadmin"\]\)/);
  assert.doesNotMatch(block, /"operador"/);
});
test("asignar despachos exige permiso individual", () => assert.match(dispatches, /requiredModule: "usuarios"[\s\S]*requiredAction: "permissions"/));
test("admin no puede asignarse despachos", () => assert.match(dispatches, /userId === callerUid/));
test("admin solo gestiona operadores hijos", () => {
  assert.match(dispatches, /targetParentUserId !== callerUid/);
  assert.match(dispatches, /targetRole !== "operador"/);
});
test("despacho asignado debe estar activo", () => assert.match(dispatches, /Despacho inactivo/));
test("admin solo propaga despachos propios", () => assert.match(dispatches, /Despacho fuera del alcance del admin/));
test("asignar empresas exige permiso individual", () => assert.match(access, /requiredModule: "usuarios"[\s\S]*requiredAction: "permissions"/));
test("empresa y despacho deben estar activos", () => {
  assert.match(access, /Empresa inactiva/);
  assert.match(access, /Despacho inexistente o inactivo/);
});
test("empresa debe estar habilitada en dispatchCompanyAccess", () => assert.match(access, /dispatchCompanyAccess\/\$\{companyDespachoId\}\/companies\/\$\{companyId\}/));
test("usuario debe pertenecer al despacho de la empresa", () => assert.match(access, /userDespachoAccess\/\$\{targetUid\}\/despachos\/\$\{companyDespachoId\}/));
test("editar modulos exige permiso individual", () => assert.match(modules, /requiredModule: "usuarios"[\s\S]*requiredAction: "permissions"/));

console.log(`H4-D76-A2 QA: ${passed}/${passed} pruebas OK.`);
