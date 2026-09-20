process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8180";
process.env.GCLOUD_PROJECT = "demo-pay0";
process.env.FACTURAMA_SANDBOX_USERNAME = "local-test-only";
process.env.FACTURAMA_SANDBOX_PASSWORD = "local-test-only";
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw Error("Local emulator required");
const assert = require("node:assert/strict");
const admin = require("../../functions/node_modules/firebase-admin");
admin.initializeApp({ projectId: "demo-pay0", storageBucket: "demo-pay0.appspot.com" });
const db = admin.firestore();
let posts = 0, filesSaved = 0;
// All PAC and Storage I/O is substituted in-process. No outbound requests.
global.fetch = async (url, options) => {
  if (String(url).endsWith("/api-lite/3/cfdis")) { posts++; return new Response(JSON.stringify({ Id: "mock-cfdi" })); }
  if (String(url).includes("/api/Cfdi/xml/")) return new Response(JSON.stringify({ Content: Buffer.from('<cfdi:Comprobante Total="116.00" Serie="T" Folio="1" Fecha="2026-09-19T12:00:00"><tfd:TimbreFiscalDigital UUID="11111111-2222-3333-4444-555555555555"/></cfdi:Comprobante>').toString("base64") }));
  if (String(url).includes("/api/Cfdi/pdf/")) return new Response(JSON.stringify({ Content: Buffer.from("mock-pdf-local").toString("base64") }));
  throw Error(`Unexpected mocked PAC path: ${new URL(url).pathname}`);
};
admin.storage().bucket = () => ({ file: () => ({ save: async () => { filesSaved++; } }) });
const moduleUnderTest = require("../../functions/lib/modules/facturama/sandboxCallables.js");
async function run() {
  const uid = `fiscal-cc-${Date.now()}`, invoiceId = `${uid}-invoice`, solicitudId = `${uid}-s`, companyId = `${uid}-company`;
  const auth = { uid, token: {} };
  await db.doc(`users/${uid}`).set({ rootId: uid, role: "superadmin", active: true });
  await db.doc(`companies/${companyId}`).set({ rootId: uid, razonSocial: "Emisor local", rfc: "AAA010101AAA", fiscalRegime: "601", postalCode: "01000" });
  await db.doc(`solicitudes/${solicitudId}`).set({ rootId: uid, companyId, folio: "TEST-CC", status: "PROCESANDO", createdBy: uid });
  await db.doc(`facturamaInvoices/${invoiceId}`).set({ rootId: uid, companyId, sourceSolicitudId: solicitudId, fiscalValidation: { status: "VALID" }, status: "DRAFT", environment: "SANDBOX", receiver: { rfc: "XAXX010101000", name: "Local", cfdiUse: "S01", fiscalRegime: "616", postalCode: "01000" }, concepts: [{ productCode: "84111506", description: "Sólo prueba local", unitCode: "E48", unit: "Servicio", quantity: 1, unitPrice: 100, taxObject: "02" }], paymentForm: "03", paymentMethod: "PUE" });
  const request = { auth, data: { invoiceId, confirmation: "EMITIR_CFDI_REAL" } };
  const originalBatch = db.batch.bind(db);
  db.batch = () => { const batch = originalBatch(); batch.commit = async () => { throw Error("Injected atomic publication failure"); }; return batch; };
  await assert.rejects(moduleUnderTest.issueFacturamaProductionInvoice.run(request));
  db.batch = originalBatch;
  assert.equal((await db.doc(`facturamaInvoices/${invoiceId}`).get()).data().facturamaCfdiId, "mock-cfdi");
  assert.equal((await db.doc(`solicitudes/${solicitudId}`).get()).data().facturaUuid, undefined);
  assert.equal((await db.doc(`materialityOperations/${solicitudId}`).get()).exists, false);
  const success = await moduleUnderTest.issueFacturamaProductionInvoice.run(request);
  assert.equal(success.ok, true); assert.equal(posts, 1); assert.equal(filesSaved, 2);
  const [invoice, solicitud, materiality] = await Promise.all([db.doc(`facturamaInvoices/${invoiceId}`).get(), db.doc(`solicitudes/${solicitudId}`).get(), db.doc(`materialityOperations/${solicitudId}`).get()]);
  assert.equal(invoice.data().total, 116); assert.equal(invoice.data().uuid, solicitud.data().facturaUuid);
  assert.equal(materiality.data().facturamaUuid, invoice.data().uuid);
  const uploads = await db.collection("uploads").where("rootId", "==", uid).get(); assert.equal(uploads.size, 2);
  const reused = await moduleUnderTest.issueFacturamaProductionInvoice.run(request); assert.equal(reused.reused, true); assert.equal(posts, 1);
  const observations = await db.collection("agent007Observations").where("rootId", "==", uid).get(); assert.equal(observations.size, 1);
  await db.doc(`facturamaInvoices/${invoiceId}`).update({ status: "DRAFT", facturamaCfdiId: null });
  await db.doc(`companies/${companyId}`).update({ rootId: "foreign" });
  await assert.rejects(moduleUnderTest.issueFacturamaProductionInvoice.run(request), /ámbito/); assert.equal(posts, 1);
  console.log(JSON.stringify({ ok: true, mockedPAC: true, realInvoicesIssued: 0, checks: ["atomic failure leaves links untouched", "retry reuses accepted CFDI", "documents not duplicated", "XML total", "Hugo audit", "foreign company denied before PAC"] }));
}
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
