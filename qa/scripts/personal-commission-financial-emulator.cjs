const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHash } = require("node:crypto");
const admin = require("../../functions/node_modules/firebase-admin");
const ts = require("../../functions/node_modules/typescript");

const projectId = "demo-pay0-pr43";
if (process.env.GCLOUD_PROJECT !== projectId ||
    !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "")) {
  throw new Error("Finance test requires isolated Firestore Emulator; production forbidden.");
}
if (!admin.apps.length) admin.initializeApp({ projectId });
const db = admin.firestore();
const base = path.join(__dirname, "../../functions/src/modules/commissionDistributions");
function load(name, dependencies = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(base, name + ".ts"), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const sandboxModule = { exports: {} };
  vm.runInNewContext(code, {
    module: sandboxModule, exports: sandboxModule.exports,
    require: spec => {
      if (spec === "firebase-admin") return admin;
      if (spec === "node:crypto") return require("node:crypto");
      if (!(spec in dependencies)) throw new Error("Unmocked module dependency: " + name + ": " + spec);
      return dependencies[spec];
    },
    Date, Intl, BigInt, Number, String, JSON, Map, Set, Array, Boolean, Error, Promise, Object,
    console,
  }, { filename: name + ".js" });
  return sandboxModule.exports;
}
const domain = load("domain", { "../pagos/domain": { normalizePagoStatus: value => String(value || "") } });
const calculator = load("clientAllocation");
const basis = load("postedClientAllocationPreview");
const mirror = load("personalAllocationMirror");
const settingsId = (rootId, clientId, ownerUid) =>
  createHash("sha256").update(JSON.stringify([rootId, clientId, ownerUid])).digest("hex");
const linkId = (rootId, clientId, ownerUid, accountId) =>
  createHash("sha256").update(JSON.stringify([rootId, clientId, ownerUid, accountId])).digest("hex");
const millis = value => typeof value?.toMillis === "function" ? value.toMillis() : Number(value?.seconds || 0) * 1000;
const service = load("personalEarningDistribution", {
  "./clientAllocation": calculator,
  "./postedClientAllocationPreview": basis,
  "./domain": domain,
  "./userDestinations": { commissionMillis: millis, commissionSettingsId: settingsId,
    assertCommissionWithdrawalOwner: (_, user) => { if (!user || user.active !== true) throw Error("inactive"); } },
  "./personalAccountIqCallables": { personalCommissionIqLinkId: linkId },
  "./personalAllocationMirror": mirror,
  "../users/inheritedAuthority": { withInheritedAuthority: async user => user },
});
const now = Date.now(), rootId = "qa-root", clientId = "qa-client";
const ownerUid = rootId, actorUid = rootId, paymentId = "qa-payment", accountId = "qa-account";
const financialSnapshotId = "qa-financial-snapshot", fingerprint = "fingerprint-qa-only";
const methodId = mirror.personalCommissionMirrorId(rootId, clientId, ownerUid, accountId);
const eventHash = mirror.personalCommissionIqEvidence({
  rootId, despachoId: "qa-despacho", profileId: "qa-profile", clientIqId: "123",
  beneficiaryId: "456", accountId: "789", last4: "5678", operationTypeKey: "TRANSFERENCIA",
});
const snapshot = {
  rootId, pagoId: paymentId, clienteId: clientId, createdAt: admin.firestore.Timestamp.fromMillis(now - 10000),
  grossAmount: 100000, currency: "MXN", despachoId: "qa-despacho", operationFlags: { userEarningsEnabled: true },
  assignmentSnapshot: {
    clientCost: { rate: 2, pricingMode: "PERCENT", calculationBaseType: "TOTAL", active: true },
    despachoCost: { rate: 1, pricingMode: "PERCENT", calculationBaseType: "TOTAL", active: true },
  },
  resultSnapshot: { superadminEarningAmount: 1000 },
};
const payment = {
  rootId, clienteId: clientId, financialSnapshotId,
  status: "CONCILIADO", financialPostingStatus: "POSTED", moneda: "MXN", folio: "QA-1001",
};
const ruleKey = settingsId(rootId, clientId, ownerUid);
const rule = {
  rootId, clientId, ownerUid, version: 2, status: "ACTIVE", executionEnabled: false,
  effectiveFrom: admin.firestore.Timestamp.fromMillis(now - 20000),
  instructions: [{ accountId, pointsBps: 20 }, { accountId, earningsPercentBps: 5000 }],
  destinations: [{ accountId, methodId, beneficiaryId: methodId, fingerprint, last4: "5678",
    iqClientId: "123", iqPartnerId: "88", iqBeneficiaryId: "456", iqAccountId: "789",
    iqCredentialProfileId: "qa-profile" }],
};
const link = {
  rootId, clientId, ownerUid, accountId, accountFingerprint: fingerprint,
  last4: "5678", iqLinkStatus: "VERIFIED", iqClientId: "123", iqPartnerId: "88",
  iqBeneficiaryId: "456", iqAccountId: "789", iqCredentialProfileId: "qa-profile",
  despachoId: "qa-despacho", verifiedAt: admin.firestore.Timestamp.fromMillis(now - 5000),
};
const account = { rootId, ownerUid, active: true, instrumentType: "CLABE",
  instrumentFingerprint: fingerprint, last4: "5678", bankName: "Banco prueba",
  beneficiaryName: "Titular prueba" };
const method = { rootId, clientId, clienteId: clientId, beneficiaryId: methodId,
  sourceType: "PERSONAL_COMMISSION", personalCommissionAccountId: accountId,
  commissionOwnerUid: ownerUid, active: true, personalAccountFingerprint: fingerprint,
  iqEvidenceFingerprint: eventHash, bankName: "Banco prueba", masked: "••5678",
  iqBeneficiaryId: "456", iqAccountId: "789", last4: "5678",
  iqCredentialProfileId: "qa-profile", iqDespachoId: "qa-despacho" };
(async () => {
  // No network calls or third-party IQ. All documents exist only in demo emulator.
  const data = [
    ["pagos/" + paymentId, payment],
    ["paymentFinancialSnapshots/" + financialSnapshotId, snapshot],
    ["clients/" + clientId, { rootId, iqLink: { clientId: "123" } }],
    ["users/" + ownerUid, { rootId, active: true, role: "superadmin" }],
    ["clientCommissionAllocationRules/" + ruleKey, rule],
    ["personalCommissionAccounts/" + accountId, account],
    ["personalCommissionIqLinks/" + linkId(rootId, clientId, ownerUid, accountId), link],
    ["clientBeneficiaryMethods/" + methodId, method],
    ["clientBeneficiaries/" + methodId, { rootId, clientId, active: true, nombre: "Titular prueba" }],
    ["balanceAccounts/USER_" + ownerUid, { amount: 100000 }],
  ];
  for (const [name, value] of data) await db.doc(name).set(value);
  const params = {
    paymentId, ownerUid, actorUid, rootId, clientId,
    distributionId: createHash("sha256").update(JSON.stringify(["USER_EARNINGS", rootId, paymentId, ownerUid])).digest("hex").slice(0, 40),
    paymentRef: db.doc("pagos/" + paymentId),
    snapshotRef: db.doc("paymentFinancialSnapshots/" + financialSnapshotId),
    snapshotId: financialSnapshotId, payment, snapshot,
    earning: domain.canonicalUserCommission(snapshot, ownerUid),
    postedAtMs: millis(snapshot.createdAt), rule, ruleKey,
  };
  const first = await service.materializePersonalEarningDistribution(params);
  assert.equal(first.data.totalCommissionMinor, 70000);
  assert.equal(first.data.sourceEarningMinor, 100000);
  assert.equal(first.data.remainingMinor, 30000);
  assert.equal(first.data.legs.length, 2);
  assert.equal(first.data.legs[0].amountMinor, 20000);
  assert.equal(first.data.legs[1].amountMinor, 50000);
  assert.notEqual(first.data.legs[0].canonicalDispersionId, first.data.legs[1].canonicalDispersionId);
  assert.equal((await service.materializePersonalEarningDistribution(params)).idempotent, true);
  const current = await db.collection("commissionDistributions").get();
  assert.equal(current.docs.filter(doc => doc.id === params.distributionId).length, 1);
  assert.equal((await db.doc("balanceAccounts/USER_" + ownerUid).get()).data().amount, 100000);
  const preflight = await service.preflightPersonalEarningDistribution(params.distributionId, actorUid, now);
  assert.equal(preflight.status, "READY_FOR_EXECUTION");
  assert.equal(preflight.executionAllowed, false);
  await db.doc("personalCommissionAccounts/" + accountId).update({ active: false });
  const blocked = await service.preflightPersonalEarningDistribution(params.distributionId, actorUid, now);
  assert.equal(blocked.status, "BLOCKED");
  assert.ok(blocked.legs.some(leg => leg.preflightReasons.includes("PERSONAL_IQ_DESTINATION_CHANGED")));
  assert.equal((await db.doc("balanceAccounts/USER_" + ownerUid).get()).data().amount, 100000);
  console.log("PASS financial emulator: partial distribution, 2 modes, idempotency, no debit before reservation, IQ revocation block");
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => admin.app().delete());
