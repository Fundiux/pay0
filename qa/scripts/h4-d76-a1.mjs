import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const authorization = require(path.join(root, "functions/lib/modules/users/authorization.js"));

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

const allow = (user, requirement) => authorization.decideUserAuthorization({
  authenticatedUid: "actor-1",
  user,
  requirement,
});

test("rechaza llamada sin autenticacion", () => {
  assert.equal(authorization.decideUserAuthorization({ user: { role: "admin" } }).reason, "UNAUTHENTICATED");
});

test("rechaza usuario inexistente", () => {
  assert.equal(authorization.decideUserAuthorization({ authenticatedUid: "u1", user: null }).reason, "USER_NOT_FOUND");
});

test("rechaza usuario inactivo o eliminado", () => {
  assert.equal(allow({ role: "admin", isActive: false }).reason, "USER_INACTIVE");
  assert.equal(allow({ role: "admin", active: false }).reason, "USER_INACTIVE");
  assert.equal(allow({ role: "admin", isDeleted: true }).reason, "USER_INACTIVE");
});

test("rol general funciona como techo", () => {
  assert.equal(allow({ role: "operador" }, { allowedRoles: ["admin"] }).reason, "ROLE_NOT_ALLOWED");
});

test("admin obedece bloqueo individual de modulo", () => {
  const decision = allow({ role: "admin", modules: { pagos: { view: false } } }, { module: "pagos", action: "create" });
  assert.equal(decision.reason, "MODULE_NOT_ALLOWED");
});

test("admin obedece bloqueo individual de accion", () => {
  const decision = allow({ role: "admin", modules: { pagos: { view: true, create: false } } }, { module: "pagos", action: "create" });
  assert.equal(decision.reason, "ACTION_NOT_ALLOWED");
});

test("operador no puede elevar accion sobre el techo de su rol", () => {
  const modules = authorization.getEffectiveUserModules({ role: "operador", modules: { pagos: { conciliate: true } } });
  assert.equal(modules.pagos.conciliate, false);
  assert.equal(allow({ role: "operador", modules: { pagos: { conciliate: true } } }, { allowedRoles: ["admin"], module: "pagos", action: "conciliate" }).reason, "ROLE_NOT_ALLOWED");
});

test("claves desconocidas no entran al contrato efectivo", () => {
  const modules = authorization.getEffectiveUserModules({ role: "admin", modules: { constructor: { view: true }, pagos: { inventada: true } } });
  assert.equal(Object.hasOwn(modules, "constructor"), false);
  assert.equal(Object.hasOwn(modules.pagos, "inventada"), false);
});

test("usuario legacy hereda defaults deterministas", () => {
  const modules = authorization.getEffectiveUserModules({ role: "admin" });
  assert.equal(modules.pagos.view, true);
  assert.equal(modules.pagos.conciliate, false);
  assert.equal(modules.materialidad.view, false);
  assert.equal(modules.telegram.view, true);
});

test("superadmin conserva bypass explicito pero no evade estado", () => {
  assert.equal(allow({ role: "superadmin", modules: { pagos: { view: false } } }, { module: "pagos", action: "create" }).allowed, true);
  assert.equal(allow({ role: "superadmin", isDeleted: true }, { module: "pagos" }).reason, "USER_INACTIVE");
});

test("authGuard consume contrato canonico", () => {
  const source = fs.readFileSync(path.join(root, "functions/src/utils/authGuard.ts"), "utf8");
  assert.match(source, /decideUserAuthorization/);
  assert.doesNotMatch(source, /role !== "superadmin" && role !== "admin"/);
});

test("defaults backend cubren materialidad y telegram", () => {
  const source = fs.readFileSync(path.join(root, "functions/src/modules/users/defaultModules.ts"), "utf8");
  assert.match(source, /materialidad/);
  assert.match(source, /telegram/);
});

console.log(`H4-D76-A1 QA: ${passed}/${passed} pruebas OK.`);
