const assert = require("node:assert/strict");
const admin = require("../../functions/node_modules/firebase-admin");

if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "")) {
  throw new Error("FIRESTORE_EMULATOR_HOST requerido");
}

admin.initializeApp({ projectId: "demo-pay0" });
const db = admin.firestore();
const api = require("../../functions/lib/modules/assets/callables.js");
const ownerUid = "qa-assets-owner";
const foreignUid = "qa-assets-foreign";
const deniedUid = "qa-assets-denied";
const ownerAuth = { uid: ownerUid, token: {} };
const foreignAuth = { uid: foreignUid, token: {} };
const deniedAuth = { uid: deniedUid, token: {} };

async function main() {
  await db.doc(`users/${ownerUid}`).set({ rootId: ownerUid, role: "superadmin", active: true });
  await db.doc(`users/${foreignUid}`).set({ rootId: foreignUid, role: "superadmin", active: true });
  await db.doc(`users/${deniedUid}`).set({ rootId: deniedUid, role: "operador", active: true });
  await assert.rejects(
    api.listAssetOverview.run({ auth: deniedAuth, data: {} }),
    /no tiene acceso al sistema assets/i,
  );

  const created = await api.createAssetPosition.run({
    auth: ownerAuth,
    data: {
      kind: "LOAN",
      name: "Préstamo smoke",
      initialMinor: 10_000_000,
      effectiveDate: "2026-09-01",
      interestModel: "SIMPLE_ON_OUTSTANDING_PRINCIPAL",
      rateBasisPoints: 1_000,
      paymentRule: "MANUAL",
      idempotencyKey: "loan-smoke",
    },
  });
  const positionId = created.positionId;
  const accrued = await api.accrueAssetLoanInterest.run({ auth: ownerAuth, data: { positionId, periodKey: "2026-09" } });
  assert.equal(accrued.amountMinor, 1_000_000);
  const duplicate = await api.accrueAssetLoanInterest.run({ auth: ownerAuth, data: { positionId, periodKey: "2026-09" } });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.amountMinor, 1_000_000);

  await db.doc("pagos/qa-assets-payment").set({ rootId: ownerUid, createdBy: ownerUid, folio: "P1C1U1E1", montoTotal: 15000 });
  const linked = await api.linkPay0PaymentToAsset.run({
    auth: ownerAuth,
    data: {
      pagoId: "qa-assets-payment",
      positionId,
      amountMinor: 1_500_000,
      rule: "MANUAL",
      interestMinor: 1_000_000,
      principalMinor: 500_000,
      effectiveDate: "2026-09-20",
      idempotencyKey: "payment-smoke-1",
    },
  });
  assert.equal(linked.remainingLinkableAmount, 0);
  await assert.rejects(
    api.linkPay0PaymentToAsset.run({ auth: ownerAuth, data: { pagoId: "qa-assets-payment", positionId, amountMinor: 1, rule: "MANUAL", interestMinor: 0, principalMinor: 1, idempotencyKey: "payment-smoke-2" } }),
    /saldo suficiente/i,
  );

  await assert.rejects(
    api.previewAssetPaymentAllocation.run({ auth: foreignAuth, data: { positionId, amountMinor: 100, rule: "MANUAL", interestMinor: 0, principalMinor: 100 } }),
    /no encontrada/i,
  );

  const seeded = await api.seedUproAssetPortfolio.run({ auth: ownerAuth, data: {} });
  assert.equal(seeded.alreadySeeded, false);
  const seededAgain = await api.seedUproAssetPortfolio.run({ auth: ownerAuth, data: {} });
  assert.equal(seededAgain.alreadySeeded, true);

  const draft = await api.createAssetDocumentDraft.run({ auth: ownerAuth, data: { positionId, documentType: "SPEI", originalName: "evidencia.pdf" } });
  const draftRow = (await db.doc(`assetDocuments/${draft.documentId}`).get()).data();
  assert.equal(draftRow.status, "DRAFT_REVIEW_REQUIRED");
  assert.equal(draftRow.extraction.status, "NOT_STARTED");

  const overview = await api.listAssetOverview.run({ auth: ownerAuth, data: {} });
  assert.equal(overview.positions.length, 4);
  const loan = overview.positions.find((position) => position.id === positionId);
  assert.equal(loan.snapshot.pendingInterestMinor, 0);
  assert.equal(loan.snapshot.outstandingPrincipalMinor, 9_500_000);
  assert.equal(overview.positions.some((position) => position.name === "Arkana Esprit Alpine 2025"), true);

  await db.doc("assetPositions/qa-demo-vehicle").set({ ownerUid, rootId: ownerUid, kind: "VEHICLE", name: "Vehículo sin confirmar", status: "ACTIVE" });
  await db.doc("assetMovements/qa-demo-opening").set({ ownerUid, rootId: ownerUid, positionId: "qa-demo-vehicle", movementType: "VEHICLE_INVESTMENT", amountMinor: 99_000_000, source: "MANUAL", effectiveDate: "2026-09-20", sequence: 0 });
  const overviewWithDemo = await api.listAssetOverview.run({ auth: ownerAuth, data: {} });
  const demo = overviewWithDemo.positions.find((position) => position.id === "qa-demo-vehicle");
  assert.equal(demo.includedInMetrics, false);
  assert.equal(demo.dataClassification, "REVIEW_REQUIRED");
  assert.equal(overviewWithDemo.totals.workingMinor, overview.totals.workingMinor);

  console.log(JSON.stringify({
    ok: true,
    positionId,
    checks: [
      "owner isolation",
      "interest idempotency",
      "capital and interest allocation",
      "PAY0 payment cannot be linked twice",
      "U-PRO seed idempotency",
      "document import remains review-only",
      "ASSETS system permission is enforced",
      "unconfirmed vehicles do not contaminate metrics",
    ],
  }));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
