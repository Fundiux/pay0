import assert from "node:assert/strict";
import fs from "node:fs";

const backend = fs.readFileSync("functions/src/modules/activityLog/callables.ts", "utf8");
const guard = fs.readFileSync("src/components/RouteAccessGuard.tsx", "utf8");
const service = fs.readFileSync("src/services/security.ts", "utf8");
const index = fs.readFileSync("functions/src/index.ts", "utf8");
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };

test("reportes cliente son observaciones sin autoridad", () => {
  assert.match(backend, /origin: "CLIENT_REPORTED"/);
  assert.match(backend, /decision: "OBSERVE_ONLY"/);
  assert.doesNotMatch(backend, /HUGO SANCHEZ \| ACCESO BLOQUEADO/);
});
test("guard no consume secretos ni codigos legacy", () => {
  assert.doesNotMatch(guard, /unlockCodeHash|redeemMySecurityUnlockCode/);
  assert.doesNotMatch(service, /locationHref|referrer|userAgent/);
});
test("bloqueo ocurre antes de renderizar children", () => {
  assert.ok(guard.indexOf("if (restrictionBlocks)") >= 0);
  assert.ok(guard.indexOf("if (restrictionBlocks)") < guard.lastIndexOf("return <>{children}</>"));
});
test("pantalla usa estado confiable sin folio legacy", () => { assert.match(guard, /getMyRestrictionStatus/); assert.doesNotMatch(guard, /securityLock|incidentCode/); });
test("recuperacion consulta estado y conserva servicio legacy", () => {
  assert.match(guard, /Actualizar estado/);
  assert.doesNotMatch(guard, /redeemMySecurityUnlockCode/);
  assert.match(service, /redeemMySecurityUnlockCode/);
});
test("codigo es de un solo uso", () => {
  assert.match(backend, /unlockCodeUsedAt/);
  assert.match(backend, /El codigo ya fue utilizado/);
  assert.match(backend, /unlockCodeHash: null/);
});
test("codigo se valida por hash ligado al usuario", () => assert.match(backend, /update\(`\$\{uid\}:\$\{cleanText\(code\)/));
test("estado confiable bloquea redirect hasta validacion", () => assert.match(guard, /if \(!profileReady \|\| !user \|\| restrictionBlocks\) return/));
test("consulta propia exportada sin writers", () => {
  assert.match(index, /export \{ getMyRestrictionStatus \} from/);
  assert.doesNotMatch(index, /export \{[^}]*\b(?:issueTrustedUserRestriction|revokeTrustedUserRestriction)\b/);
});
test("callable de canje esta exportada", () => assert.match(index, /redeemMySecurityUnlockCode/));

console.log(`H4-D76-A3 QA: ${passed}/${passed} pruebas OK.`);
