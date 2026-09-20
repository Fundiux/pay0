const assert = require("node:assert/strict");
const { allocatePayment, canRegisterFinancialMovement, interestForPeriod, projectAsset, remainingLinkableAmount } = require("../functions/lib/modules/assets/domain.js");

const movement = (movementType, amountMinor) => ({ movementType, amountMinor, source: "MANUAL", effectiveDate: "2026-09-20" });

// A: simple interest keeps its principal base.
assert.equal(interestForPeriod({ model: "SIMPLE_ON_OUTSTANDING_PRINCIPAL", outstandingPrincipalMinor: 10_000_000, rateBasisPoints: 1_000 }), 1_000_000);
assert.equal(interestForPeriod({ model: "SIMPLE_ON_OUTSTANDING_PRINCIPAL", outstandingPrincipalMinor: 10_000_000, rateBasisPoints: 1_000 }), 1_000_000);

// B: capitalized interest changes the next base.
let capitalized = projectAsset("LOAN", [movement("LOAN_ORIGINATED", 10_000_000), movement("INTEREST_ACCRUED", 1_000_000), movement("INTEREST_CAPITALIZED", 1_000_000)]);
assert.equal(capitalized.outstandingPrincipalMinor, 11_000_000);
assert.equal(interestForPeriod({ model: "CAPITALIZED", outstandingPrincipalMinor: capitalized.outstandingPrincipalMinor, rateBasisPoints: 1_000 }), 1_100_000);

// C/D: principal payment changes the base; NONE generates zero.
const reduced = projectAsset("LOAN", [movement("LOAN_ORIGINATED", 30_000_000), movement("PRINCIPAL_PAYMENT", 10_000_000)]);
assert.equal(reduced.outstandingPrincipalMinor, 20_000_000);
assert.equal(interestForPeriod({ model: "SIMPLE_ON_OUTSTANDING_PRINCIPAL", outstandingPrincipalMinor: reduced.outstandingPrincipalMinor, rateBasisPoints: 500 }), 1_000_000);
assert.equal(interestForPeriod({ model: "NONE", outstandingPrincipalMinor: 50_000_000, rateBasisPoints: 900 }), 0);

// E: recovered capital is never profit.
const vehicle = projectAsset("VEHICLE", [movement("VEHICLE_INVESTMENT", 30_000_000), movement("VEHICLE_PRINCIPAL_RETURN", 10_000_000), movement("VEHICLE_PROFIT", 4_500_000)]);
assert.equal(vehicle.outstandingPrincipalMinor, 20_000_000); assert.equal(vehicle.recoveredPrincipalMinor, 10_000_000); assert.equal(vehicle.realizedProfitMinor, 4_500_000);

// F: mixed payment must reconcile exactly and respect both ceilings.
assert.deepEqual(allocatePayment({ amountMinor: 5_000_000, pendingInterestMinor: 2_100_000, outstandingPrincipalMinor: 10_000_000, rule: "MANUAL", interestMinor: 2_100_000, principalMinor: 2_900_000 }), { interestMinor: 2_100_000, principalMinor: 2_900_000 });
assert.throws(() => allocatePayment({ amountMinor: 5_000_000, pendingInterestMinor: 2_100_000, outstandingPrincipalMinor: 10_000_000, rule: "MANUAL", interestMinor: 2_100_000, principalMinor: 2_800_000 }), /ALLOCATION/);

// U-PRO acceptance values.
const duster = projectAsset("VEHICLE", [movement("VEHICLE_INVESTMENT", 12_000_000), movement("VEHICLE_PRINCIPAL_RETURN", 12_000_000), movement("VEHICLE_PROFIT", 1_200_000)]);
const kwid = projectAsset("VEHICLE", [movement("VEHICLE_INVESTMENT", 7_500_000)]);
const arkana = projectAsset("VEHICLE", [movement("VEHICLE_INVESTMENT", 16_250_000), movement("VEHICLE_PRINCIPAL_RETURN", 16_250_000), movement("VEHICLE_PROFIT", 1_293_000)]);
assert.equal(duster.roi, 0.1); assert.equal(Math.round(arkana.roi * 1_000_000), 79_569);
assert.equal(duster.outstandingPrincipalMinor + kwid.outstandingPrincipalMinor + arkana.outstandingPrincipalMinor, 7_500_000);
assert.equal(duster.recoveredPrincipalMinor + arkana.recoveredPrincipalMinor, 28_250_000);
assert.equal(duster.realizedProfitMinor + arkana.realizedProfitMinor, 2_493_000);

// H: the same PAY0 payment cannot be linked beyond its canonical total.
assert.equal(remainingLinkableAmount(1_500_000, 1_500_000), 0);
assert.throws(() => remainingLinkableAmount(1_500_000, 3_000_000), /LINK_BALANCE/);

// Terminal positions preserve history but reject ordinary financial changes.
assert.equal(canRegisterFinancialMovement("VEHICLE", "ACTIVE"), true);
assert.equal(canRegisterFinancialMovement("VEHICLE", "LIQUIDATED"), false);
assert.equal(canRegisterFinancialMovement("VEHICLE", "CANCELLED"), false);
assert.equal(canRegisterFinancialMovement("LOAN", "ACTIVE"), true);
assert.equal(canRegisterFinancialMovement("LOAN", "PAID"), false);
assert.equal(canRegisterFinancialMovement("LOAN", "CANCELLED"), false);

console.log("ASSETS domain smoke passed");
