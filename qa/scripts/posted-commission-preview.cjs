const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("../../functions/node_modules/typescript");
const source = fs.readFileSync(path.join(__dirname, "../../functions/src/modules/commissionDistributions/postedClientAllocationPreview.ts"), "utf8");
const moduleExports = {};
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
vm.runInNewContext(compiled, { exports: moduleExports, Number, String, Error });
const { postedClientOperationBaseMinor: basis, hasExactPersonalCommissionIqLink: exactLink,
  postedClientIqOrigin: iqOrigin } = moduleExports;
const payment = { rootId: "r", clientId: "c", financialSnapshotId: "s", moneda: "MXN", despachoId: "d" };
const snapshot = { rootId: "r", clienteId: "c", pagoId: "p", currency: "MXN", despachoId: "d" };
const origin = { rootId: "r", clientId: "c", paymentId: "p", payment, snapshot };
assert.equal(iqOrigin(origin), "d", "posted immutable origin is authoritative");
assert.equal(iqOrigin({ ...origin, payment: { ...payment, despachoId: "" } }), "d");
assert.equal(iqOrigin({ ...origin, payment: { ...payment, despachoId: "another" } }), null,
  "mutable payment origin may not contradict financial posting");
assert.equal(iqOrigin({ ...origin, snapshot: { ...snapshot, despachoId: "" } }), null);
assert.equal(iqOrigin({ ...origin, snapshot: { ...snapshot, rootId: "other" } }), null);
assert.equal(iqOrigin({ ...origin, snapshot: { ...snapshot, clienteId: "other" } }), null);
assert.equal(iqOrigin({ ...origin, snapshot: { ...snapshot, pagoId: "other" } }), null);
assert.equal(iqOrigin({ ...origin, snapshot: { ...snapshot, currency: "USD" } }), null);
assert.equal(iqOrigin({ ...origin, payment: { ...payment, rootId: "other" } }), null);
assert.equal(iqOrigin({ ...origin, payment: { ...payment, clientId: "other" } }), null);
assert.equal(iqOrigin({ ...origin, snapshot: null }), null);
assert.equal(basis({ grossAmount: 116.00 }, "TOTAL"), 11600);
assert.equal(basis({ grossAmount: 116.00, baseAmount: 100.00, assignmentSnapshot: { despachoCost: { calculationBaseType: "SUBTOTAL" } } }, "SUBTOTAL"), 10000);
assert.equal(basis({ grossAmount: 116.00, baseAmount: 100.00, assignmentSnapshot: { despachoCost: { calculationBaseType: "TOTAL" } } }, "SUBTOTAL"), null);
assert.equal(basis({ grossAmount: 116.00 }, "SUBTOTAL"), null);
assert.equal(basis({ grossAmount: 116.00 }, null), null);
assert.equal(basis({ grossAmount: -1 }, "TOTAL"), null);
assert.equal(basis({ grossAmount: Number.NaN }, "TOTAL"), null);
assert.equal(basis({ grossAmount: Number.MAX_SAFE_INTEGER }, "TOTAL"), null);

const account = { rootId: "r", ownerUid: "u", active: true,
  instrumentFingerprint: "HMAC-1", last4: "1234" };
const link = { rootId: "r", clientId: "c", ownerUid: "u", accountId: "a",
  iqLinkStatus: "VERIFIED", iqFullDigitsMatched: true, accountFingerprint: "HMAC-1",
  last4: "1234", iqClientId: "101", despachoId: "d", iqPartnerId: "201",
  iqBeneficiaryId: "301", iqAccountId: "401", iqCredentialProfileId: "p" };
const matching = { rootId: "r", clientId: "c", ownerUid: "u", accountId: "a",
  clientIqId: "101", despachoId: "d", account, link };
assert.equal(exactLink(matching), true, "exact account, client, origin, fingerprint and IQ IDs");
for (const field of ["rootId", "clientId", "ownerUid", "accountId", "iqClientId",
  "despachoId", "accountFingerprint", "last4", "iqPartnerId", "iqBeneficiaryId",
  "iqAccountId", "iqLinkStatus"]) {
  assert.equal(exactLink({ ...matching, link: { ...link, [field]: "WRONG" } }), false,
    "wrong IQ proof field: " + field);
}
assert.equal(exactLink({ ...matching, link: { ...link, iqFullDigitsMatched: false } }), false);
assert.equal(exactLink({ ...matching, link: { ...link, iqCredentialProfileId: "" } }), false);
assert.equal(exactLink({ ...matching, link: { ...link, iqAccountId: "9007199254740993" } }), false);
assert.equal(exactLink({ ...matching, account: { ...account, active: false } }), false);
assert.equal(exactLink({ ...matching, account: { ...account, ownerUid: "other" } }), false);
assert.equal(exactLink({ ...matching, clientIqId: "" }), false);
assert.equal(exactLink({ ...matching, despachoId: "" }), false);
assert.equal(exactLink({ ...matching, link: undefined }), false);
console.log("Posted basis + exact client-scoped IQ identity tests passed (no external calls).");
