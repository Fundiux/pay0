import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");
const count = (s, r) => (s.match(r) || []).length;
const companies = read("functions/src/modules/companies/callables.ts");
const dispatches = read("functions/src/modules/dispatches/callables.ts");
const users = read("functions/src/modules/users/access.ts");
const index = read("functions/src/index.ts");
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`); };

test("tres mutaciones de Empresa exigen empresas view y superadmin", () => assert.equal(count(companies, /allowedRoles: \["superadmin"\], requiredModule: "empresas", requiredAction: "view"/g), 3));
test("activar Despacho exige despachos view y superadmin", () => assert.match(dispatches, /toggleDespachoActive[\s\S]*requiredModule: "despachos", requiredAction: "view"/));
test("eliminar y restaurar Usuario exigen usuarios activate", () => assert.equal(count(users, /requiredModule: "usuarios", requiredAction: "activate"/g), 2));
test("crear Admin exige usuarios create y superadmin", () => assert.match(index, /createAdmin[\s\S]*allowedRoles: \["superadmin"\], requiredModule: "usuarios", requiredAction: "create"/));
test("crear Operador exige usuarios create", () => assert.match(index, /createOperador[\s\S]*requiredModule: "usuarios", requiredAction: "create"/));
test("tres herramientas financieras exigen pagos conciliate", () => assert.equal(count(index, /allowedRoles: \["superadmin"\], requiredModule: "pagos", requiredAction: "conciliate"/g), 3));
test("cargas genericas y abono directo permanecen deshabilitados", () => {
  assert.match(index, /Carga generica deshabilitada/);
  assert.match(index, /Abono directo deshabilitado/);
});

console.log(`H4-D76-A16 QA: ${passed}/${passed} pruebas OK.`);
