const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ts = require("../../functions/node_modules/typescript");
const base = path.join(__dirname, "../../functions/src/modules/commissionDistributions");
const cache = {};
function load(name) {
  if (cache[name]) return cache[name];
  const source = fs.readFileSync(path.join(base, name + ".ts"), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  const requireLocal = spec => {
    if (spec === "../pagos/domain") return { normalizePagoStatus: value => String(value || "") };
    if (!spec.startsWith("./")) throw new Error("Unexpected dependency " + spec);
    return load(spec.slice(2));
  };
  vm.runInNewContext(js, { module, exports: module.exports, require: requireLocal, BigInt, Number, String, Set, Map, Error, Array });
  return cache[name] = module.exports;
}
const { preflightClientCommissionIntegration } = load("integrationPreflight");
const account = { id: "acc1", rootId: "root", ownerUid: "user", bankName: "Banco", beneficiaryName: "Titular", instrumentType: "CLABE", instrumentNumber: "123456789012345678", active: true, iqLinkStatus: "VERIFIED", last4: "5678", iqInstrumentLast4: "5678", iqVerifiedAtMs: 100000, iqFullDigitsMatched: true, iqBeneficiaryId: "iq-beneficiary", iqAccountId: "iq-account" };
const input = { nowMs: 130000, rootId: "root", ownerUid: "user", clientId: "client", earnedMinor: 100000, operationBaseMinor: 10000000, contractRateBps: 100, accounts: [account], instructions: [{ accountId: "acc1", pointsBps: 20 }, { accountId: "acc1", earningsPercentBps: 5000 }] };
const result = preflightClientCommissionIntegration(input);
assert.equal(result.distributedMinor, 70000);
assert.equal(result.remainingMinor, 30000);
assert.equal(result.canSubmitToIq, false);
assert.throws(() => preflightClientCommissionIntegration({ ...input, accounts: [{ ...account, iqLinkStatus: "PENDING" }] }));
assert.throws(() => preflightClientCommissionIntegration({ ...input, accounts: [{ ...account, ownerUid: "other" }] }));
assert.throws(() => preflightClientCommissionIntegration({ ...input, accounts: [{ ...account, active: false }] }));
assert.throws(() => preflightClientCommissionIntegration({ ...input, instructions: [{ accountId: "acc1", earningsPercentBps: 10000 }, { accountId: "acc1", pointsBps: 20 }] }));
assert.throws(() => preflightClientCommissionIntegration({ ...input, instructions: [{ accountId: "missing", pointsBps: 20 }] }));
assert.throws(() => preflightClientCommissionIntegration({ ...input, nowMs: 100000 + 86400001 }));
assert.throws(() => preflightClientCommissionIntegration({ ...input, accounts: [{ ...account, iqInstrumentLast4: "0000" }] }));
assert.throws(() => preflightClientCommissionIntegration({ ...input, accounts: [{ ...account, iqAccountId: "" }] }));
assert.throws(() => preflightClientCommissionIntegration({ ...input, accounts: [{ ...account, iqFullDigitsMatched: false }] }));
console.log("Read-only integration preflight tests passed.");
