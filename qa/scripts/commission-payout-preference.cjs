// Run from repository root: node qa/scripts/commission-payout-preference.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("../../functions/node_modules/typescript");
const file = path.join(__dirname, "../../functions/src/modules/commissionDistributions/payoutPreference.ts");
const js = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
vm.runInNewContext(js, { exports });
const { resolveCommissionPayoutMode, mayAutomaticallyProcessCommission } = exports;
for (const value of [undefined, null, "", "manual", "AUTO", "AUTOMATIC ", false, 1]) assert.equal(resolveCommissionPayoutMode(value), "MANUAL");
assert.equal(resolveCommissionPayoutMode("AUTOMATIC"), "AUTOMATIC");
for (const ownerPreference of [undefined, "MANUAL", "INVALID"]) {
  assert.deepEqual({ ...mayAutomaticallyProcessCommission({ ownerPreference, organizationEnabled: true, organizationExecutionEnabled: true }) }, { prepare: false, execute: false });
}
assert.deepEqual({ ...mayAutomaticallyProcessCommission({ ownerPreference: "AUTOMATIC", organizationEnabled: false, organizationExecutionEnabled: true }) }, { prepare: false, execute: false });
assert.deepEqual({ ...mayAutomaticallyProcessCommission({ ownerPreference: "AUTOMATIC", organizationEnabled: true, organizationExecutionEnabled: false }) }, { prepare: true, execute: false });
assert.deepEqual({ ...mayAutomaticallyProcessCommission({ ownerPreference: "AUTOMATIC", organizationEnabled: true, organizationExecutionEnabled: true }) }, { prepare: true, execute: true });
console.log("Commission payout preference policy: Policy assertions passed");
