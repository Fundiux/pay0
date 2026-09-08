import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("functions/src/modules/paymentApplications/callables.ts", "utf8");
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`); };

test("aplicaciones de Pago usan contrato canonico", () => assert.match(source, /import \{ assertAuthorized \}/));
test("actor de aplicaciones exige pagos conciliate", () => assert.match(source, /requiredModule: "pagos", requiredAction: "conciliate"/));
test("los ocho callables resuelven actor protegido", () => assert.equal((source.match(/await resolveActor\(request\)/g) || []).length, 8));
test("desbloqueo de falso submit conserva limite de rol", () => assert.match(source, /\["superadmin", "admin"\]\.includes\(actor\.role\)/));

console.log(`H4-D76-A12 QA: ${passed}/${passed} pruebas OK.`);
