// The orange label on /wallet/beneficiarios is shown only while an account is pending in IQ.
const assert = require("node:assert/strict");
const ts = require("../../node_modules/typescript");
const fs = require("node:fs");
const source = fs.readFileSync(require("node:path").join(__dirname, "../../src/lib/iqMethodReadiness.ts"), "utf8");
const mod = { exports: {} };
new Function("module", "exports", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(mod, mod.exports);
const { isIqReconciled } = mod.exports;
let n = 0; const check = (name, fn) => { fn(); n += 1; console.log("ok -", name); };
check("no IQ link: pending, so orange with the PENDIENTE label", () => assert.equal(isIqReconciled({}), false));
check("NOT_CONCILIATED or PENDING_RETRY: still pending", () => {
  assert.equal(isIqReconciled({ iqLinksByCatalog: { "iq-group-pay0": { status: "NOT_CONCILIATED" } } }), false);
  assert.equal(isIqReconciled({ iqLinksByCatalog: { "iq-group-pay0": { status: "PENDING_RETRY" } } }), false);
});
check("once LINKED in IQ the row is no longer pending (normal color, Activo)", () => {
  assert.equal(isIqReconciled({ iqLinksByCatalog: { "iq-group-pay0": { status: "NOT_CONCILIATED" } } }), false);
  assert.equal(isIqReconciled({ iqLinksByCatalog: { "iq-group-pay0": { status: "LINKED", iqBeneficiaryId: 1, iqAccountId: 2 } } }), true);
});
check("a LINKED entry whose IQ name differs stays pending", () => assert.equal(isIqReconciled({ iqLinksByCatalog: { x: { status: "LINKED", nameDiffers: true } } }), false));
console.log(`iq-method-readiness-ui: ${n} checks passed`);
