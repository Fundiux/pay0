const assert = require("node:assert/strict");

const { resolveDispersionDespachoIdForRole } = require(
  "../../functions/lib/modules/financing/dispersionDispatchResolver.js",
);
const { decideIqDispersionExecutionAccess } = require(
  "../../functions/lib/modules/iq/dispersionExecutionAccess.js",
);

const dispatch = {
  id: "iq-root-a",
  rootId: "rootA",
  active: true,
  automationMode: "ERP",
  erpProvider: "IQ",
};
const iqAccess = {
  rootId: "rootA",
  active: true,
  iqEnabled: true,
  allowedModules: { dispersiones: true },
};

for (const role of ["admin", "operador", "operator"]) {
  assert.equal(resolveDispersionDespachoIdForRole({ role, dispatches: [dispatch] }), dispatch.id);
  assert.deepEqual(decideIqDispersionExecutionAccess({
    uid: `${role}A`, role, rootId: "rootA", despacho: dispatch, iqAccess,
  }), { allowed: true });
}

assert.deepEqual(decideIqDispersionExecutionAccess({
  uid: "adminA", role: "admin", rootId: "rootA", despacho: dispatch,
  iqAccess: { ...iqAccess, allowedModules: { dispersiones: false } },
}).code, "IQ_MODULE_DENIED");
assert.deepEqual(decideIqDispersionExecutionAccess({
  uid: "operatorA", role: "operador", rootId: "rootA", despacho: dispatch,
  iqAccess: { ...iqAccess, active: false },
}).code, "IQ_ACCESS_INACTIVE");
assert.deepEqual(decideIqDispersionExecutionAccess({
  uid: "adminA", role: "admin", rootId: "rootB", despacho: dispatch, iqAccess,
}).code, "DISPATCH_OUT_OF_ROOT");
assert.deepEqual(decideIqDispersionExecutionAccess({
  uid: "adminA", role: "admin", rootId: "rootA",
  despacho: { ...dispatch, active: false }, iqAccess,
}).code, "DISPATCH_INACTIVE");

console.log("PASS dispersion IQ autorizada por rol, modulo, root y acceso IQ sin depender de una asignacion manual de despacho");
