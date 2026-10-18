import assert from "node:assert/strict";
import fs from "node:fs";

const backend = fs.readFileSync("functions/src/modules/activityLog/callables.ts", "utf8");
const guard = fs.readFileSync("src/components/RouteAccessGuard.tsx", "utf8");
const service = fs.readFileSync("src/services/security.ts", "utf8");
const index = fs.readFileSync("functions/src/index.ts", "utf8");
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };

test("mensaje Telegram corto usa folio y nombre", () => {
  assert.match(backend, /HUGO SANCHEZ \| ACCESO BLOQUEADO/);
  assert.match(backend, /Usuario: \$\{userFolio\} - \$\{actorName\}/);
});
test("mensaje no expone UID", () => assert.doesNotMatch(backend, /`UID:/));
test("mensaje contiene ruta modulo permiso e incidente", () => {
  for (const marker of ["`Ruta:", "`Modulo:", "`Permiso faltante:", "`Incidente:"]) assert.match(backend, new RegExp(marker));
});
test("codigo de desbloqueo solo se envia por canal de seguridad", () => {
  assert.match(backend, /`Codigo desbloqueo: \$\{unlockCode\}`/);
  assert.doesNotMatch(guard, /unlockCodeHash/);
});
test("perfil almacena hash y no codigo plano", () => {
  assert.match(backend, /unlockCodeHash: hashUnlockCode/);
  assert.doesNotMatch(backend, /securityLock:\s*\{[\s\S]{0,300}unlockCode,/);
});
test("bloqueo ocurre antes de renderizar children", () => {
  assert.ok(guard.indexOf("if (isSecurityLocked)") < guard.lastIndexOf("return <>{children}</>"));
});
test("pantalla muestra folio de incidente", () => assert.match(guard, /securityLock\?\.incidentCode/));
test("usuario puede ingresar codigo recibido", () => {
  assert.match(guard, /Codigo enviado por superadmin/);
  assert.match(service, /redeemMySecurityUnlockCode/);
});
test("codigo es de un solo uso", () => {
  assert.match(backend, /unlockCodeUsedAt/);
  assert.match(backend, /El codigo ya fue utilizado/);
  assert.match(backend, /unlockCodeHash: null/);
});
test("codigo se valida por hash ligado al usuario", () => assert.match(backend, /update\(`\$\{uid\}:\$\{cleanText\(code\)/));
test("desbloqueo redirige antes de reabrir ruta prohibida", () => assert.match(guard, /await redeemMySecurityUnlockCode[\s\S]*router\.replace\(getFirstAllowedRoute\(profile\)\)/));
test("alerta y notificacion reciben estado Telegram", () => assert.match(backend, /statusRefs: \[notificationRef, alertRef\]/));
test("callable de canje esta exportada", () => assert.match(index, /redeemMySecurityUnlockCode/));

console.log(`H4-D76-A3 QA: ${passed}/${passed} pruebas OK.`);
