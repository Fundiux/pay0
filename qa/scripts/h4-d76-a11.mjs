import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const count = (text, regex) => (text.match(regex) || []).length;
const notes = read("functions/src/modules/notes/callables.ts");
const solicitudDocs = read("functions/src/modules/solicitudDocuments/callables.ts");
const pagoDocs = read("functions/src/modules/pagoDocuments/callables.ts");
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`); };

test("nota de Solicitud exige solicitudes comment", () => assert.match(notes, /requiredModule: "solicitudes", requiredAction: "comment"/));
test("nota de Pago exige pagos view", () => assert.match(notes, /requiredModule: "pagos", requiredAction: "view"/));
test("tres operaciones documentales de Solicitud exigen uploadDocs", () => assert.equal(count(solicitudDocs, /requiredModule: "solicitudes", requiredAction: "uploadDocs"/g), 3));
test("subir finalizar y desactivar documento de Pago exigen pagos create", () => assert.equal(count(pagoDocs, /requiredModule: "pagos", requiredAction: "create"/g), 3));
test("reintento de Pago rechazado exige conciliacion y superadmin", () => assert.match(pagoDocs, /allowedRoles: \["superadmin"\], requiredModule: "pagos", requiredAction: "conciliate"/));
test("todos los gates usan el perfil backend", () => {
  assert.equal(count(solicitudDocs, /getMyUser\(requireAuth\(request\)\)/g), 3);
  assert.equal(count(pagoDocs, /getMyUser\(requireAuth\(request\)\)/g), 4);
});

console.log(`H4-D76-A11 QA: ${passed}/${passed} pruebas OK.`);
