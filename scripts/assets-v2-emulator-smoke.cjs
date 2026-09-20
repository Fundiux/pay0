const assert = require("node:assert/strict");
const { initializeApp, deleteApp } = require("firebase/app");
const { getAuth, connectAuthEmulator, signInAnonymously, signOut } = require("firebase/auth");
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require("firebase/functions");
const { initializeApp: initializeAdminApp, deleteApp: deleteAdminApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage: getAdminStorage } = require("firebase-admin/storage");
const { createHash } = require("node:crypto");

const projectId = process.env.GCLOUD_PROJECT || "demo-pay0-assets-v2";
const adminApp = initializeAdminApp({ projectId }, `assets-v2-${Date.now()}`);
const db = getFirestore(adminApp);
const clientApp = initializeApp({
  projectId,
  apiKey: "demo-key",
  appId: "demo-app",
  storageBucket: `${projectId}.appspot.com`,
}, `assets-v2-client-${Date.now()}`);
const auth = getAuth(clientApp);
const functions = getFunctions(clientApp, "us-central1");
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
connectFunctionsEmulator(functions, "127.0.0.1", 5001);
const call = (name, data = {}) => httpsCallable(functions, name)(data).then((result) => result.data);
const storageBucket = `${projectId}.appspot.com`;

async function storageRequest(path, { method = "GET", body, contentType } = {}) {
  const token = await auth.currentUser.getIdToken();
  const url = new URL(`http://127.0.0.1:9199/v0/b/${storageBucket}/o`);
  if (method === "POST") {
    url.searchParams.set("uploadType", "media");
    url.searchParams.set("name", path);
  } else {
    url.pathname += `/${encodeURIComponent(path)}`;
    url.searchParams.set("alt", "media");
  }
  return fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(contentType ? { "Content-Type": contentType } : {}),
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
}

async function provision() {
  const credential = await signInAnonymously(auth);
  const uid = credential.user.uid;
  await db.doc(`users/${uid}`).set({ role: "superadmin", active: true, rootId: uid, systemAccess: { assets: true } });
  return uid;
}

async function main() {
  const ownerUid = await provision();
  const vehicle = await call("createAssetPosition", { kind: "VEHICLE", name: "Smoke Vehicle", counterpartyName: "U-PRO", initialMinor: 100_000, effectiveDate: "2026-09-20", idempotencyKey: "v2-vehicle" });
  await call("recordAssetMovement", { positionId: vehicle.positionId, movementType: "VEHICLE_PRINCIPAL_RETURN", amountMinor: 100_000, source: "EXTERNAL_TRANSFER", effectiveDate: "2026-09-20", idempotencyKey: "v2-return" });
  const closedVehicle = await call("closeAssetPosition", { positionId: vehicle.positionId, confirmation: "CONFIRM_ASSET_POSITION_CLOSE" });
  assert.equal(closedVehicle.status, "LIQUIDATED");
  await assert.rejects(() => call("recordAssetMovement", { positionId: vehicle.positionId, movementType: "VEHICLE_PROFIT", amountMinor: 1_000, source: "MANUAL", effectiveDate: "2026-09-20", idempotencyKey: "v2-blocked" }), /cerrada|failed-precondition/i);

  const loan = await call("createAssetPosition", { kind: "LOAN", name: "Smoke Loan", initialMinor: 200_000, interestModel: "NONE", rateBasisPoints: 0, effectiveDate: "2026-09-20", idempotencyKey: "v2-loan" });
  await call("recordAssetMovement", { positionId: loan.positionId, movementType: "PRINCIPAL_PAYMENT", amountMinor: 200_000, source: "CASH", effectiveDate: "2026-09-20", idempotencyKey: "v2-loan-payment" });
  const closedLoan = await call("closeAssetPosition", { positionId: loan.positionId, confirmation: "CONFIRM_ASSET_POSITION_CLOSE" });
  assert.equal(closedLoan.status, "PAID");
  await assert.rejects(() => call("accrueAssetLoanInterest", { positionId: loan.positionId, periodKey: "2026-09" }), /cerrada|failed-precondition/i);

  const before = await call("listAssetOverview");
  const pdf = Buffer.from("%PDF-1.4\nASSETS smoke\n%%EOF");
  const digest = createHash("sha256").update(pdf).digest("hex");
  const prepared = await call("initAssetDocumentUpload", { originalFileName: "Evidencia smoke.pdf", contentType: "application/pdf", fileSize: pdf.length, sha256: digest, documentType: "OTHER", positionId: vehicle.positionId, description: "Prueba sin interpretación" });
  assert.equal(prepared.duplicate, false);
  // The currently installed Storage emulator does not evaluate Firestore
  // cross-service lookups reliably. Upload as Admin in the isolated demo, then
  // exercise finalization plus owner/non-owner read rules below.
  await getAdminStorage(adminApp).bucket(storageBucket).file(prepared.storagePath).save(pdf, {
    contentType: "application/pdf",
  });
  await call("finalizeAssetDocumentUpload", { documentId: prepared.documentId });
  const duplicate = await call("initAssetDocumentUpload", { originalFileName: "Evidencia smoke.pdf", contentType: "application/pdf", fileSize: pdf.length, sha256: digest, documentType: "OTHER", positionId: vehicle.positionId });
  assert.equal(duplicate.duplicate, true);
  const after = await call("listAssetOverview");
  assert.equal(after.positions.length, before.positions.length, "document upload must not create positions");
  assert.equal(after.movements.length, before.movements.length, "document upload must not create movements");
  assert.equal(after.totals.workingMinor, 0, "closed positions must not count as working capital");
  assert.equal(after.documents.filter((row) => row.status === "ACTIVE").length, 1);

  const ownerResponse = await storageRequest(prepared.storagePath);
  assert.equal(ownerResponse.status, 200, "the document owner must be able to read the file");

  await signOut(auth);
  const otherUid = await provision();
  assert.notEqual(otherUid, ownerUid);
  const forbiddenResponse = await storageRequest(prepared.storagePath);
  assert.equal(forbiddenResponse.status, 403, "a second owner must not read the document");
  console.log("ASSETS V2 emulator smoke passed");
}

main().finally(async () => {
  await Promise.allSettled([deleteApp(clientApp), deleteAdminApp(adminApp)]);
}).catch((error) => { console.error(error); process.exitCode = 1; });
