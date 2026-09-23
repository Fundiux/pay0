const assert = require("node:assert/strict");
const { aggregateCommissionStatus, allocatePostedCommission, calculateCommissionDistribution, decideCommissionPreflight, evaluateCommissionLegSubmission, evaluateIqLink, recoverCommissionLegFolio, validateCommissionRule } = require("../../functions/lib/modules/commissionDistributions/domain.js");
const { selectUniqueIqAccountForLink, selectUniqueIqBeneficiaryForLink } = require("../../functions/lib/modules/iq/dispersionHttpCreateCore.js");
const { stableCommissionId } = require("../../functions/lib/modules/commissionDistributions/service.js");

const legs = [
  { kind: "BASE", alias: "BASE", rateBps: 200, beneficiaryId: "b0", methodId: "m0" },
  { kind: "COMMISSIONER", alias: "EJCT", rateBps: 300, beneficiaryId: "b1", methodId: "m1" },
  { kind: "COMMISSIONER", alias: "JFCC", rateBps: 100, beneficiaryId: "b2", methodId: "m2" },
];

const standard = calculateCommissionDistribution(10_000_000, { totalRateBps: 600, legs });
assert.equal(standard.totalAmountMinor, 600_000);
assert.deepEqual(standard.legs.map((row) => row.amountMinor), [200_000, 300_000, 100_000]);
assert.equal(standard.differenceMinor, 0);

const rounded = calculateCommissionDistribution(101, { totalRateBps: 300, legs: [
  { kind: "BASE", alias: "BASE", rateBps: 100, beneficiaryId: "b0", methodId: "m0" },
  { kind: "COMMISSIONER", alias: "A", rateBps: 100, beneficiaryId: "b1", methodId: "m1" },
  { kind: "COMMISSIONER", alias: "B", rateBps: 100, beneficiaryId: "b2", methodId: "m2" },
] });
assert.equal(rounded.totalAmountMinor, 3);
assert.equal(rounded.legs.reduce((sum, row) => sum + row.amountMinor, 0), 3);
const posted = allocatePostedCommission(301724, { totalRateBps: 350, legs: [{ kind: "BASE", alias: "BASE", rateBps: 200, beneficiaryId: "b0", methodId: "m0" }, { kind: "COMMISSIONER", alias: "A", rateBps: 150, beneficiaryId: "b1", methodId: "m1" }] });
assert.equal(posted.totalAmountMinor, 301724);
assert.equal(posted.legs.reduce((sum, row) => sum + row.amountMinor, 0), 301724);

assert.throws(() => validateCommissionRule({ totalRateBps: 600, legs: legs.slice(0, 2) }), /suma configurada/i);
assert.throws(() => validateCommissionRule({ totalRateBps: 600, legs: legs.map((row) => ({ ...row, kind: "COMMISSIONER" })) }), /exactamente una BASE/i);

const historical = JSON.parse(JSON.stringify(validateCommissionRule({ totalRateBps: 600, legs })));
legs[1].rateBps = 250;
assert.equal(historical.legs[1].rateBps, 300);

assert.throws(() => selectUniqueIqBeneficiaryForLink([{ id: 1, name: "MISMO NOMBRE" }, { id: 2, name: "MISMO NOMBRE" }], ["MISMO NOMBRE"]), /AMBIGUOUS/);
assert.equal(selectUniqueIqBeneficiaryForLink([{ id: 1, name: "BENEFICIARIO UNO" }], ["BENEFICIARIO UNO"]).id, "1");
assert.throws(() => selectUniqueIqAccountForLink([{ id: 1, account: "****1234" }, { id: 2, account: "CLABE 1234" }], "1234"), /AMBIGUOUS/);
assert.equal(selectUniqueIqAccountForLink([{ id: 9, account: "****9876" }, { id: 8, account: "****1111" }], "9876").id, "9");

const now = Date.now();
assert.equal(evaluateIqLink({ status: "VERIFIED", verifiedAtMs: now - 1000, nowMs: now, maxAgeMs: 5000, storedLast4: "1234", currentLast4: "1234" }).ready, true);
assert.deepEqual(evaluateIqLink({ status: "VERIFIED", verifiedAtMs: now - 6000, nowMs: now, maxAgeMs: 5000, storedLast4: "1234", currentLast4: "1234" }).reasons, ["IQ_LINK_STALE"]);
assert.ok(evaluateIqLink({ status: "VERIFIED", verifiedAtMs: now, nowMs: now, maxAgeMs: 5000, storedLast4: "1234", currentLast4: "9999" }).reasons.includes("IQ_INSTRUMENT_CHANGED"));
assert.equal(aggregateCommissionStatus(["COMPLETED", "BLOCKED", "COMPLETED"]), "PARTIALLY_COMPLETED");
assert.equal(aggregateCommissionStatus(["COMPLETED", "UNCERTAIN"]), "UNCERTAIN");
assert.equal(aggregateCommissionStatus(["READY", "READY", "READY"]), "READY");
assert.equal(evaluateCommissionLegSubmission({ status: "COMPLETED", iqFolio: "IQ-1" }).allowed, false);
assert.equal(evaluateCommissionLegSubmission({ status: "UNCERTAIN", postAccepted: true }).reason, "OUTCOME_RECONCILIATION_REQUIRED");
assert.equal(evaluateCommissionLegSubmission({ status: "READY" }).allowed, true);
assert.deepEqual(recoverCommissionLegFolio({ status: "UNCERTAIN", recoveredIqFolio: "IQ-RECOVERED" }), { status: "COMPLETED", iqFolio: "IQ-RECOVERED", retryBlocked: true });
assert.equal(stableCommissionId("root|payment|1"), stableCommissionId("root|payment|1"));
assert.notEqual(stableCommissionId("root|payment|1"), stableCommissionId("root|payment|2"));
assert.deepEqual(decideCommissionPreflight([], [[], [], []]), { status: "READY_FOR_EXECUTION", ready: true });
assert.deepEqual(decideCommissionPreflight(["CLIENT_RULE_MISSING"], [[]]), { status: "BLOCKED", ready: false });
assert.deepEqual(decideCommissionPreflight([], [["IQ_LINK_STALE"]]), { status: "BLOCKED", ready: false });

console.log("commission-distribution-domain: ok");
