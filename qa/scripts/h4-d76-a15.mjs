import assert from "node:assert/strict";
import fs from "node:fs";

const telegram = fs.readFileSync("functions/src/modules/telegram/callables.ts", "utf8");
const security = fs.readFileSync("functions/src/modules/activityLog/callables.ts", "utf8");
const count = (text, regex) => (text.match(regex) || []).length;
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`); };

test("Telegram usa contrato canonico con perfil backend", () => {
  assert.match(telegram, /getMyUser\(uid\)/);
  assert.match(telegram, /requiredModule: "telegram"/);
});
test("tres lecturas exigen telegram view", () => assert.equal(count(telegram, /assertTelegramAccess\(request, "view"\)/g), 3));
test("seis cambios y pruebas exigen telegram link", () => assert.equal(count(telegram, /assertTelegramAccess\(request, "link"\)/g), 6));
test("los nueve callables Firebase de Telegram quedan protegidos", () => assert.equal(count(telegram, /assertTelegramAccess\(request, /g), 9));
test("alerta automatica Hugo Sanchez permanece independiente", () => {
  assert.match(security, /sendSecurityTelegramAlert/);
  assert.match(security, /HUGO SANCHEZ \| ACCESO BLOQUEADO/);
});

console.log(`H4-D76-A15 QA: ${passed}/${passed} pruebas OK.`);
