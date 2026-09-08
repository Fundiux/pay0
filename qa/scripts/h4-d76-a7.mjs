import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const materiality = read("functions/src/modules/materiality/callables.ts");
const reports = read("functions/src/modules/reports/callables.ts");
const count = (text, regex) => (text.match(regex) || []).length;
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`); };

test("materialidad usa contrato canonico", () => assert.match(materiality, /import \{ assertAuthorized \}/));
test("sincronizar carpeta de materialidad exige sync", () => {
  const part = materiality.slice(materiality.indexOf("export const ensureMaterialityClientCompany"));
  assert.match(part, /requiredModule: "materialidad", requiredAction: "sync"/);
});
test("vincular solicitud a materialidad exige sync", () => {
  const part = materiality.slice(materiality.indexOf("export const linkSolicitudToMaterialityOperation"));
  assert.match(part, /requiredModule: "materialidad", requiredAction: "sync"/);
});
test("tres lecturas de materialidad exigen view", () => assert.equal(count(materiality, /requiredModule: "materialidad", requiredAction: "view"/g), 3));
test("reportes usan contrato canonico", () => assert.match(reports, /import \{ assertAuthorized \}/));
test("los tres reportes exigen reportes view", () => assert.equal(count(reports, /requiredModule: "reportes", requiredAction: "view"/g), 3));
test("los gates se ejecutan con perfil backend", () => {
  assert.ok(count(materiality, /await getMyUser\(requireAuth\(request\)\)/g) === 5);
  assert.ok(count(reports, /assertAuthorized\(request\.auth, user/g) === 3);
});

console.log(`H4-D76-A7 QA: ${passed}/${passed} pruebas OK.`);
