import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");
const rates = read("functions/src/modules/rates/callables.ts");
const documents = read("functions/src/modules/entityDocuments/service.ts");
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`); };

test("catalogo de tipos exige wallet configuracion", () => assert.match(rates, /requiredModule: "wallet", requiredAction: "configuracion"/));
test("costos de Despacho exigen despachos costs", () => assert.match(rates, /requiredModule: "despachos", requiredAction: "costs"/));
test("costos de Usuario exigen usuarios costs", () => assert.match(rates, /requiredModule: "usuarios", requiredAction: "costs"/));
test("costos de Cliente exigen clientes costs", () => assert.match(rates, /requiredModule: "clientes", requiredAction: "costs"/));
test("documentos fiscales exigen superadmin activo", () => assert.match(documents, /assertAuthorized\(request\.auth, user, \{ allowedRoles: \["superadmin"\] \}\)/));
test("documentos fiscales conservan root y tipos canonicos", () => {
  assert.match(documents, /entityRootId !== rootId/);
  assert.match(documents, /getEntityCollectionName/);
});

console.log(`H4-D76-A14 QA: ${passed}/${passed} pruebas OK.`);
