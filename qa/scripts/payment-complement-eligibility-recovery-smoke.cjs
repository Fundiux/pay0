const assert = require("node:assert/strict");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "") || process.env.GCLOUD_PROJECT !== "demo-pay0") throw Error("Local Firestore emulator required");
global.fetch = async () => { throw Error("EXTERNAL_NETWORK_FORBIDDEN"); };
const crypto = require("node:crypto");
const admin = require("../../functions/node_modules/firebase-admin");
admin.initializeApp({ projectId: "demo-pay0", storageBucket: "demo-pay0.appspot.com" });
const db = admin.firestore();
const api = require("../../functions/lib/modules/paymentApplications/complementAutomation");
const follow = require("../../functions/lib/modules/paymentApplications/complementFollowup");

async function run() {
  const root = `rep-eligibility-${Date.now()}`, applicationId = `${root}-app`, jobId = `${root}-job`;
  const uuid = "11111111-1111-4111-8111-111111111111", repUuid = "22222222-2222-4222-8222-222222222222";
  const requestId = follow.complementRequestId(root, applicationId);
  await Promise.all([
    db.doc(`users/${root}`).set({ rootId: root, role: "superadmin", active: true }),
    db.doc(`clients/${root}`).set({ rootId: root, adminId: root, active: true }),
    db.doc(`iqIntegrationConfigs/${root}`).set({ rootId: root, enabled: true, automation: { aplicacionPagos: true } }),
    db.doc(`paymentComplementConfigs/${root}`).set({ rootId: root, iqEnabled: true, iqLookupEnabled: true, activatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1000) }),
    db.doc(`iqUserAccess/${root}`).set({ rootId: root, active: true, iqEnabled: true, iqCredentialProfileId: "profile", allowedModules: { pagos: true } }),
    db.doc("iqCredentialProfiles/profile").set({ rootId: root, active: true, hasPassword: true, username: "smoke" }),
    db.doc(`solicitudes/${root}`).set({ rootId: root, folio: "S1", iqFolio: "123", facturaUuid: uuid, status: "COMPLETADA" }),
    db.doc(`pagos/${root}`).set({ rootId: root, folio: "P1", moneda: "MXN", status: "APLICADO_TOTAL" }),
    db.doc(`pagoAplicaciones/${applicationId}`).set({ rootId: root, solicitudId: root, pagoId: root, folio: "AP1", invoiceType: "PPD", status: "APLICADA", montoAplicado: 58, numeroParcialidad: 1, saldoAnterior: 116, saldoInsoluto: 58, iqApplicationStatus: "IQ_APPLIED", iqActionExecuted: true }),
    db.doc(`paymentComplementJobs/${jobId}`).set({ rootId: root, provider: "IQ", applicationId, profileId: "profile", actorUid: root, clientId: root, depositId: "220486", status: "BLOCKED", error: "IQ_REP_REQUEST_ELIGIBILITY_UNVERIFIED" }),
  ]);
  const documents = { uuid: repUuid, xmlUploadId: `${root}-xml`, pdfUploadId: `${root}-pdf` };
  const xml = Buffer.from(`<Comprobante TipoDeComprobante="P"><TimbreFiscalDigital UUID="${repUuid}"/><DoctoRelacionado IdDocumento="${uuid}" NumParcialidad="1" ImpPagado="58" ImpSaldoAnt="116" ImpSaldoInsoluto="58" MonedaDR="MXN"/></Comprobante>`);
  const pdf = Buffer.from("%PDF-1.4\n% eligibility recovery smoke");
  await db.doc(`paymentComplementRequests/${requestId}`).set({ rootId: root, applicationId, solicitudId: root, pagoId: root, invoiceUuid: uuid, amountMinor: 5800, installment: 1, balanceBefore: 116, balanceAfter: 58, provider: "IQ", automationJobId: jobId, status: "PENDING_PROVIDER_CONTRACT" });
  for (const [type, uploadId, bytes] of [["COMPLEMENTO_PAGO_XML", documents.xmlUploadId, xml], ["COMPLEMENTO_PAGO_PDF", documents.pdfUploadId, pdf]]) {
    const storagePath = `roots/${root}/pagos/${root}/docs/${type}/${uploadId}`;
    await admin.storage().bucket().file(storagePath).save(bytes);
    await db.doc(`uploads/${uploadId}`).set({ rootId: root, pagoId: root, solicitudId: root, applicationId, documentType: type, complementKey: repUuid, storagePath, status: "READY", active: true, integritySealStatus: "SEALED", sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
  }
  const adapter = { iqSession: async () => ({}), availableIqComplement: async () => "https://iq.test/already-generated.zip", importIqComplement: async (_url, sources) => sources.map(source => ({ source, documents })) };
  await api.checkComplementDaily(jobId, new Date(), adapter);
  const finalJob = (await db.doc(`paymentComplementJobs/${jobId}`).get()).data();
  if (finalJob.status !== "RECEIVED") console.error("FINAL_JOB", finalJob);
  assert.equal(finalJob.status, "RECEIVED");
  assert.equal((await db.doc(`paymentComplementRequests/${requestId}`).get()).data().status, "RECEIVED");
  console.log(JSON.stringify({ ok: true, checks: ["eligibility-blocked IQ job keeps safe lookup", "generated REP closes job without another request"], externalActions: 0 }));
}
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
