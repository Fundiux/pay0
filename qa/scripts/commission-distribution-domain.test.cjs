const assert = require("node:assert/strict");
const { calculateCommissionDistribution, validateCommissionRule } = require("../../functions/lib/modules/commissionDistributions/domain.js");

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

assert.throws(() => validateCommissionRule({ totalRateBps: 600, legs: legs.slice(0, 2) }), /suma configurada/i);
assert.throws(() => validateCommissionRule({ totalRateBps: 600, legs: legs.map((row) => ({ ...row, kind: "COMMISSIONER" })) }), /exactamente una BASE/i);

const historical = JSON.parse(JSON.stringify(validateCommissionRule({ totalRateBps: 600, legs })));
legs[1].rateBps = 250;
assert.equal(historical.legs[1].rateBps, 300);

console.log("commission-distribution-domain: ok");

