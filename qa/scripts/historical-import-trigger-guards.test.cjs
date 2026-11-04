// Contract test: every Firestore trigger that reacts to pagos, solicitudes or
// pagoAplicaciones must ignore IQ historical imports before producing effects.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const src = (file) => fs.readFileSync(path.join(root, "functions/src/modules", file), "utf8");
const guardPath = path.join(root, "functions/lib/modules/iq/historicalImportGuard.js");

// [file, trigger anchor, guard call, first effect after the guard]
const CONTRACTS = [
  ["paymentApplications/automaticApplication.ts", "export const applyPaymentAutomaticallyOnReconciliation", "shouldSuppressIqHistoricalImport(before, after)", "applyAutomaticPayment("],
  ["paymentApplications/automaticApplication.ts", "export const applyPaymentAutomaticallyOnReceipt", "isIqHistoricalImport(pago)", "applyAutomaticPayment("],
  ["paymentApplications/automaticApplication.ts", "export const applyPaymentsAutomaticallyOnInvoice", "shouldSuppressIqHistoricalImport(before, after)", "applyAutomaticPayment"],
  ["paymentApplications/callables.ts", "export const enqueuePaymentApplicationImmediately", "shouldSuppressIqHistoricalImport(before, after)", "continuePaymentApplicationImmediately("],
  ["materiality/triggers.ts", "export const refreshMaterialityFromPaymentApplication", "shouldSuppressIqHistoricalImport(before, after)", "refreshOrSkipInvalidSource("],
  ["commissionDistributions/triggers.ts", "export const onPaymentReadyForCommissionDistribution", "shouldSuppressIqHistoricalImport(before, after)", "materializeCommissionDistribution("],
  ["agent007/reconciliationMaintenance.ts", "export async function reconcileForPay0Change", "shouldSuppressIqHistoricalImport(before, after)", "reconcileAgent007Recommendations("],
  ["controlCenter/automation.ts", "export async function markControlCenterDirty", "shouldSuppressIqHistoricalImport(before, after)", "rootId"],
  ["controlCenter/recovery.ts", "isIqHistoricalImport(row)", "isIqHistoricalImport(row)", "return"],
  ["paymentApplications/complementAutomation.ts", "shouldSuppressIqHistoricalImport(event.data?.before.data(), app)", "shouldSuppressIqHistoricalImport(event.data?.before.data(), app)", "return"],
  ["paymentApplications/complementFollowup.ts", "shouldSuppressIqHistoricalImport(before, after)", "shouldSuppressIqHistoricalImport(before, after)", "return"],
];

for (const [file, anchor, guard, effect] of CONTRACTS) {
  test(`${file}: ${anchor.replace(/^export (const|async function) /, "")} ignores historical imports`, () => {
    const source = src(file);
    assert.match(source, /historicalImportGuard"/, `${file} must import the historical import guard`);
    const start = source.indexOf(anchor);
    assert.ok(start >= 0, `anchor missing: ${anchor}`);
    const guardAt = source.indexOf(guard, start);
    assert.ok(guardAt >= start, `guard missing after anchor: ${guard}`);
    const effectAt = source.indexOf(effect, guardAt);
    assert.ok(effectAt > guardAt, `effect must follow the guard: ${effect}`);
  });
}

const HISTORICAL = Object.freeze({
  source: "IQ_IMPORT", importRunId: "p4run_0123456789", importVersion: 1,
  canonicalIqProfileId: "bEGPMuplqNHMZ3lvYkeb", originalIqEntityId: "176838",
});

test("compiled guard recognises complete historical provenance only", { skip: !fs.existsSync(guardPath) && "functions/lib not built" }, () => {
  const guard = require(guardPath);
  assert.equal(guard.isIqHistoricalImport({ rootId: "r", ...HISTORICAL }), true);
  assert.equal(guard.isIqHistoricalImport({ ...HISTORICAL, source: "USER" }), false);
  assert.equal(guard.isIqHistoricalImport({ ...HISTORICAL, importRunId: "short" }), false);
  assert.equal(guard.isIqHistoricalImport({ ...HISTORICAL, originalIqEntityId: "" }), false);
  assert.equal(guard.isIqHistoricalImport({ source: "IQ_IMPORT" }), false);
  assert.equal(guard.shouldSuppressIqHistoricalImport({}, { ...HISTORICAL }), true, "historical after suppresses");
  assert.equal(guard.shouldSuppressIqHistoricalImport({ ...HISTORICAL }, undefined), true, "deleted historical row suppresses");
  assert.equal(guard.shouldSuppressIqHistoricalImport({ ...HISTORICAL }, { status: "CONCILIADO" }), false, "ordinary after is never suppressed");
  assert.equal(guard.shouldSuppressIqHistoricalImport({}, { status: "CONCILIADO" }), false);
});
