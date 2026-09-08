import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const count = (text, regex) => (text.match(regex) || []).length;
const auth = read("functions/src/modules/iq/authorization.ts");
const sync = read("functions/src/modules/iq/solicitudSyncCallables.ts");
const form = read("functions/src/modules/iq/solicitudFormCallables.ts");
const creation = read("functions/src/modules/iq/solicitudCreationCallables.ts");
const queue = read("functions/src/modules/iq/solicitudCreateQueueCallables.ts");
const pagos = read("functions/src/modules/iq/pagoDepositCallables.ts");
const similar = read("functions/src/modules/iq/pay0SimilarOperationPrecheckCallables.ts");
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`); };

test("IQ consume contrato canonico con perfil backend", () => {
  assert.match(auth, /getMyUser\(uid\)/);
  assert.match(auth, /assertAuthorized\(request\.auth, profile, requirement\)/);
});
test("prevalidar Solicitud IQ exige solicitudes create", () => assert.match(sync, /requiredModule: "solicitudes", requiredAction: "create"/));
test("preparar formulario IQ exige solicitudes create", () => assert.match(form, /requiredModule: "solicitudes", requiredAction: "create"/));
test("crear y encolar Solicitud IQ exigen solicitudes create", () => {
  assert.match(creation, /requiredModule: "solicitudes", requiredAction: "create"/);
  assert.match(queue, /requiredModule: "solicitudes", requiredAction: "create"/);
});
test("prevalidar preparar y crear Pago IQ exigen pagos create", () => assert.equal(count(pagos, /requiredModule: "pagos", requiredAction: "create"/g), 3));
test("conciliar Pago IQ exige pagos conciliate", () => assert.match(pagos, /requiredModule: "pagos", requiredAction: "conciliate"/));
test("precheck y confirmacion aplican modulo segun operacion", () => assert.equal(count(similar, /requiredModule: type === "PAGO" \? "pagos" : "solicitudes"/g), 2));
test("asignacion tecnica IQ permanece obligatoria", () => {
  assert.match(creation, /collection\("iqUserAccess"\)/);
  assert.match(pagos, /collection\("iqUserAccess"\)/);
  assert.match(creation, /verifyDespachoAccess/);
});

console.log(`H4-D76-A8 QA: ${passed}/${passed} pruebas OK.`);
