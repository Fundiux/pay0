const assert = require("node:assert/strict");
const admin = require("firebase-admin");
const fs = require("node:fs");
const ts = require("typescript");
const { createHash } = require("node:crypto");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "") || !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_STORAGE_EMULATOR_HOST || "") || !/^demo-/.test(process.env.GCLOUD_PROJECT || "")) throw Error("ISOLATED_FIRESTORE_AND_STORAGE_EMULATORS_REQUIRED");
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT, storageBucket: `${process.env.GCLOUD_PROJECT}.appspot.com` });
const db = admin.firestore();
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { reserveRun, finishRun } = require("../../functions/lib/modules/agentOperations/engine.js");
const { verifyQuotationEvidence } = require("../../functions/lib/modules/agentOperations/quotationEvidence.js");
const { isTerminalSolicitud } = require("../../functions/lib/modules/cotizaciones/quotationPolicy.js");
const { observeSentinelEvent } = require("../../functions/lib/modules/agentOperations/sentinel.js");
const { mexicoDayKey } = require("../../functions/lib/modules/agentOperations/time.js");
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const revoked = new Set();
const failOnce = new Set();
let generated = 0;

async function syntheticQuotation(request) {
  const jobId = request.internalAutomation.quotationJobId;
  if (failOnce.delete(jobId)) throw Error("Transient isolated failure");
  const solicitudId = request.data.solicitudId;
  const existing = await db.collection("uploads").where("quotationJobId", "==", jobId).limit(1).get();
  if (!existing.empty) return { active: true, alreadyExists: true, uploadId: existing.docs[0].id };
  generated++;
  const uploadId = `upload-${jobId}`;
  const path = `roots/root/solicitudes/${solicitudId}/docs/COTIZACION/${uploadId}.pdf`;
  const pdf = Buffer.from("%PDF-1.4\nfixture\n");
  const sha256 = createHash("sha256").update(pdf).digest("hex");
  await admin.storage().bucket().file(path).save(pdf, { contentType: "application/pdf", metadata: { metadata: { sha256 } } });
  await db.doc(`uploads/${uploadId}`).set({ rootId: "root", solicitudId, quotationJobId: jobId, documentType: "COTIZACION", status: "READY", active: true, storagePath: path, sha256 });
  return { active: true, uploadId };
}

const source = fs.readFileSync("functions/src/modules/cotizaciones/queueCallables.ts", "utf8");
const ast = ts.createSourceFile("queue.ts", source, ts.ScriptTarget.Latest, true);
const names = new Set(["MAX_ATTEMPTS", "RETRY_DELAY_MS", "EXPECTED_QUOTE_MS", "clean", "upper", "processJob"]);
const parts = [];
const visit = node => { if (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) parts.push(node.getText(ast).replace(/^export\s+/, "")); if (ts.isVariableDeclaration(node) && names.has(node.name.getText(ast))) parts.push(`const ${node.getText(ast)};`); ts.forEachChild(node, visit); };
visit(ast); assert.equal(parts.length, names.size);
const code = ts.transpileModule(`${parts.join("\n")}\nexports.processJob=processJob;`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const extracted = {};
new Function("exports", "db", "FieldValue", "Timestamp", "HttpsError", "reserveRun", "finishRun", "authorizeDeferredIntent", "generateCotizacionForSolicitudCore", "verifyQuotationEvidence", "logActivity", "observeSentinelEvent", "isTerminalSolicitud", "mexicoDayKey", code)(
  extracted, db, FieldValue, Timestamp, HttpsError, reserveRun, async (...args) => {
    await finishRun(...args);
    if (args[1] === "SUCCEEDED" && (await db.doc(`agentRuns/${args[0]}`).get()).get("entityId") === "race") await db.doc("solicitudes/race").update({ iqFolio: "IQ-NEW" });
  },
  async input => { if (revoked.has(input.uid)) throw new HttpsError("permission-denied", "Authorization revoked"); },
  syntheticQuotation, verifyQuotationEvidence, async () => {}, observeSentinelEvent, isTerminalSolicitud, mexicoDayKey,
);

async function seed(id, overrides = {}) {
  await db.doc(`solicitudes/${id}`).set({ rootId: "root", iqFolio: `IQ-${id}`, ocFiscalMetadataUploadId: `OC-${id}`, clienteId: "client", status: "PROCESANDO", ...overrides });
  const ocPath = `roots/root/solicitudes/${id}/docs/ORDEN_COMPRA/OC-${id}.xlsx`;
  await admin.storage().bucket().file(ocPath).save(Buffer.from("OC fixture"));
  await db.doc(`uploads/OC-${id}`).set({ rootId: "root", solicitudId: id, documentType: "ORDEN_COMPRA", status: "READY", active: true, storagePath: ocPath });
  await db.doc(`solicitudQuotationJobs/${id}`).set({ rootId: "root", solicitudId: id, iqFolio: `IQ-${id}`, ocUploadId: `OC-${id}`, requestedBy: `user-${id}`, status: "QUEUED", attemptCount: 0 });
}

(async () => {
  await seed("success");
  await Promise.all([extracted.processJob("success"), extracted.processJob("success")]);
  assert.equal((await db.doc("solicitudQuotationJobs/success").get()).get("status"), "SUCCEEDED");
  assert.equal((await db.doc("solicitudes/success").get()).get("cotizacionAutoGenerateStatus"), "READY");
  assert.equal(generated, 1);
  assert.equal((await db.collection("agentRuns").where("entityId", "==", "success").get()).docs[0].get("status"), "SUCCEEDED");
  assert.equal((await db.collection("agentRuns").where("entityId", "==", "success").get()).docs[0].get("resolution"), "GENERATED_NORMAL");

  await seed("retry"); failOnce.add("retry");
  await extracted.processJob("retry");
  assert.equal((await db.doc("solicitudQuotationJobs/retry").get()).get("status"), "FAILED_RETRYABLE");
  await extracted.processJob("retry");
  assert.equal((await db.doc("solicitudQuotationJobs/retry").get()).get("status"), "SUCCEEDED");
  assert.equal((await db.collection("agentLedger").where("entityId", "==", "retry").get()).size, 2);
  assert.equal((await db.collection("agentRuns").where("entityId", "==", "retry").get()).docs[0].get("resolution"), "RECOVERED_MISSING");

  await seed("revoked"); revoked.add("user-revoked");
  await extracted.processJob("revoked");
  assert.equal((await db.doc("solicitudQuotationJobs/revoked").get()).get("status"), "BLOCKED");
  assert.equal((await db.collection("agentIncidents").where("entityId", "==", "revoked").get()).size >= 1, true);

  await seed("terminal", { status: "CANCELADA" });
  await extracted.processJob("terminal");
  assert.equal((await db.doc("solicitudQuotationJobs/terminal").get()).get("status"), "BLOCKED");

  await seed("existing");
  const path = "roots/root/solicitudes/existing/docs/COTIZACION/upload-existing.pdf";
  const existingPdf = Buffer.from("%PDF-1.4\nexisting\n");
  const existingSha256 = createHash("sha256").update(existingPdf).digest("hex");
  await admin.storage().bucket().file(path).save(existingPdf, { contentType: "application/pdf", metadata: { metadata: { sha256: existingSha256 } } });
  await db.doc("uploads/upload-existing").set({ rootId: "root", solicitudId: "existing", quotationJobId: "existing", documentType: "COTIZACION", status: "READY", active: true, storagePath: path, sha256: existingSha256 });
  const beforeExisting = generated;
  await extracted.processJob("existing");
  assert.equal(generated, beforeExisting);
  assert.equal((await db.doc("solicitudes/existing").get()).get("cotizacionAutoGenerateStatus"), "READY");
  assert.equal((await db.collection("agentRuns").where("entityId", "==", "existing").get()).docs[0].get("resolution"), "RECOVERED_EXISTING");

  await seed("race"); await extracted.processJob("race");
  assert.equal((await db.doc("solicitudQuotationJobs/race").get()).get("status"), "ESCALATED");
  assert.notEqual((await db.doc("solicitudes/race").get()).get("cotizacionAutoGenerateStatus"), "READY");

  await db.doc("agentControls/root").set({ killSwitch: true });
  await seed("killed"); await extracted.processJob("killed");
  assert.equal((await db.doc("solicitudQuotationJobs/killed").get()).get("status"), "BLOCKED");
  await db.doc("agentControls/root").set({ killSwitch: false, circuitOpenUntil: Timestamp.fromMillis(Date.now() + 60_000) });
  await seed("circuit"); await extracted.processJob("circuit");
  assert.equal((await db.doc("solicitudQuotationJobs/circuit").get()).get("status"), "ESCALATED");
  console.log("PASS quotation worker concurrency, isolated retry, revoked authority, terminal, existing document association, changed-IQ race, kill switch, circuit breaker");
})().catch(error => { console.error(error); process.exitCode = 1; });
