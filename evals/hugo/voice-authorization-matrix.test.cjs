const test = require("node:test");
const assert = require("node:assert/strict");
const { decideUserAuthorization } = require("../../functions/lib/modules/users/authorization");
const { isUserVisibleToCaller, userQueryMatchLevel } = require("../../functions/lib/modules/agent007/platformReadConnector");

const requirement = { allowedRoles: ["superadmin", "admin"], module: "clientes", action: "view" };
const decide = user => decideUserAuthorization({ authenticatedUid: "caller", user, requirement });

test("canonical role and module matrix fails closed", () => {
  assert.equal(decide({ role: "superadmin", active: true }).allowed, true);
  assert.equal(decide({ role: "admin", active: true }).allowed, true);
  assert.equal(decide({ role: "operador", active: true }).reason, "ROLE_NOT_ALLOWED");
  assert.equal(decide({ role: "admin", active: false }).reason, "USER_INACTIVE");
  assert.equal(decide({ role: "admin", active: true, modules: { clientes: { view: false } } }).reason, "MODULE_NOT_ALLOWED");
});

test("root and hierarchy scope cannot be expanded by a supplied name", () => {
  const admin = { uid: "admin-a", rootId: "root-a", role: "admin" };
  assert.equal(isUserVisibleToCaller(admin, "child", { rootId: "root-a", parentUserId: "admin-a", displayName: "Betel" }), true);
  assert.equal(isUserVisibleToCaller(admin, "other-admin-child", { rootId: "root-a", parentUserId: "admin-b", displayName: "Betel" }), false);
  assert.equal(isUserVisibleToCaller(admin, "cross-root", { rootId: "root-b", parentUserId: "admin-a", displayName: "Betel" }), false);
});

test("an individual grant cannot raise the role ceiling", () => {
  const result = decideUserAuthorization({ authenticatedUid: "caller", user: { role: "operador", active: true, modules: { usuarios: { view: true } } }, requirement: { module: "usuarios", action: "view" } });
  assert.equal(result.reason, "MODULE_NOT_ALLOWED");
});

test("browser source never owns Hugo tool execution", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../../src/components/hugo/HugoRealtimeVoice.tsx"), "utf8");
  assert.equal(source.includes("delegateHugoVoiceTurn"), false);
  assert.equal(source.includes("response.function_call_arguments.done"), false);
  assert.equal(source.includes('if (requestedNow && !gatewayUrl) throw'), true);
  assert.equal(source.includes('window.sessionStorage.setItem("hugoVoiceCanary", "1")'), true);
  assert.equal(source.includes("Canary server-side"), true);
});

test("user lookup accepts a unique short prefix without hardcoding a person", () => {
  assert.equal(userQueryMatchLevel("Betel", ["BETELL", "betell@example.test"]), "UNIQUE_PREFIX");
  assert.equal(userQueryMatchLevel("BETELL", ["BETELL"]), "EXACT");
  assert.equal(userQueryMatchLevel("Be", ["BETELL"]), "NONE");
});
