import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");
const active = read("functions/src/modules/users/active.ts");
const list = read("functions/src/modules/users/list.ts");
const repair = read("functions/src/modules/users/repairNumbers.ts");
const delegations = read("functions/src/modules/clientDelegations/service.ts");
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`); };

test("activar usuario exige usuarios activate", () => assert.match(active, /requiredModule: "usuarios", requiredAction: "activate"/));
test("listar usuarios exige usuarios view", () => assert.match(list, /requiredModule: "usuarios", requiredAction: "view"/));
test("reparar folios de usuario exige permissions y superadmin", () => assert.match(repair, /allowedRoles: \["superadmin"\], requiredModule: "usuarios", requiredAction: "permissions"/));
test("delegar clientes exige clientDelegations", () => assert.match(delegations, /requiredModule: "usuarios", requiredAction: "clientDelegations"/));
test("delegacion conserva limites de root y rol objetivo", () => {
  assert.match(delegations, /callerRootId !== targetRootId/);
  assert.match(delegations, /targetRole === "superadmin"/);
});
test("admin solo activa operadores hijos", () => {
  assert.match(active, /target\.parentUserId/);
  assert.match(active, /Admin solo puede activar\/desactivar operadores/);
});

console.log(`H4-D76-A13 QA: ${passed}/${passed} pruebas OK.`);
