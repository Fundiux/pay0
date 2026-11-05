const assert = require("node:assert/strict");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "")) throw new Error("Firestore emulator requerido");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_STORAGE_EMULATOR_HOST || "")) throw new Error("Storage emulator requerido");
process.env.FACTURAMA_SANDBOX_USERNAME = "emulator-only";
process.env.FACTURAMA_SANDBOX_PASSWORD = "emulator-only";
const admin = require("../../functions/node_modules/firebase-admin");
admin.initializeApp({ projectId: "demo-pay0", storageBucket: "demo-pay0.appspot.com" });
const facturama = require("../../functions/lib/modules/facturama/sandboxCallables.js");
const iq = require("../../functions/lib/modules/iq/cancellationReceiptImport.js");

const db = admin.firestore();
const root = "Ab4z0RttIqXbZFT0NuWsDjBkt6J2";
const dispatch = "vjq4SEnucenerXvoLqtK";
const uuid = "11111111-1111-4111-8111-111111111111";
const auth = { uid: root, token: {} };
const calls = { delete: 0, status: 0 };
let deleteResponse = () => ({ Status: "pending" });
let satStatus = "Vigente";

global.fetch = async (url, init = {}) => {
  const text = String(url);
  const reply = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
  if (init.method === "DELETE") { calls.delete++; await new Promise(resolve => setTimeout(resolve, 50)); return reply(200, deleteResponse()); }
  if (text.includes("/cfdi/status")) { calls.status++; return reply(200, { Status: satStatus }); }
  if (text.includes("/api/Acuse/pdf/")) return reply(200, { Content: Buffer.from("%PDF-1.7 acuse").toString("base64") });
  throw new Error(`EXTERNAL_NETWORK_FORBIDDEN ${text}`);
};

async function seed(id, solicitud = {}, invoice = {}) {
  await Promise.all([
    db.doc(`solicitudes/${id}`).set({ rootId: root, folio: id, companyId: root, despachoId: dispatch, facturamaInvoiceId: id, facturamaEnvironment: "PRODUCTION", facturaUuid: uuid, clienteRfc: "XAXX010101000", facturaTotal: 116, status: "COMPLETADA", ...solicitud }),
    db.doc(`facturamaInvoices/${id}`).set({ rootId: root, environment: "PRODUCTION", facturamaCfdiId: `cfdi-${id}`, companyId: root, sourceSolicitudId: id, uuid, total: 116, ...invoice }),
  ]);
}
const cancel = (id, motive = "02", extra = {}) => facturama.cancelFacturamaProductionInvoice.run({ auth, data: { solicitudId: id, motive, ...extra } });
const refresh = id => facturama.refreshFacturamaProductionCancellationStatus.run({ auth, data: { solicitudId: id } });
const activity = async id => (await Promise.all(["activityLog", "pay0ActivityLog"].map(name => db.collection(name).where("referenceId", "==", id).get()))).flatMap(snap => snap.docs.map(doc => doc.data().event));

(async () => {
  await Promise.all([
    db.doc(`users/${root}`).set({ rootId: root, role: "superadmin", active: true }),
    db.doc(`despachos/${dispatch}`).set({ rootId: root, active: true }),
    db.doc(`companies/${root}`).set({ rootId: root, despachoId: dispatch, isOwnCompany: true, facturamaEnabled: true, rfc: "TRO230717L64", active: true }),
    db.doc(`facturamaIssuerConfigs/${root}`).set({ rootId: root, companyId: root, csdRegistrationStatus: "REGISTERED_API_MULTIISSUER", csdRfc: "TRO230717L64" }),
  ]);

  await seed("con-abono", { totalAbonado: 50 });
  await assert.rejects(cancel("con-abono"), /abonos/);
  await seed("con-aplicacion");
  await db.doc("pagoAplicaciones/ap-1").set({ rootId: root, solicitudId: "con-aplicacion", status: "APLICADA" });
  await assert.rejects(cancel("con-aplicacion", "03"), /abonos/);
  assert.equal(calls.delete, 0, "con abonos no se llama a Facturama");

  await seed("doble");
  const results = await Promise.allSettled([cancel("doble"), cancel("doble")]);
  assert.equal(calls.delete, 1, "dos clics llegan una sola vez");
  assert.equal(results.filter(row => row.status === "fulfilled").length, 1);
  assert.ok((await activity("doble")).includes("FACTURAMA_CANCELACION_SOLICITADA"));

  await refresh("doble");
  assert.equal((await db.doc("solicitudes/doble").get()).data().facturamaCancellationStatus, "PENDING", "Vigente no pierde el seguimiento");
  assert.equal((await db.doc("solicitudes/doble").get()).data().status, "COMPLETADA");

  satStatus = "Cancelado";
  await refresh("doble");
  const closed = (await db.doc("solicitudes/doble").get()).data();
  assert.equal(closed.status, "CANCELADA");
  assert.ok(closed.cancellationReceiptUploadId, "guarda el acuse");
  assert.equal((await db.doc("facturamaInvoices/doble").get()).data().cancellationStatus, "CANCELED", "el control factura-pago la excluye");
  assert.ok((await activity("doble")).includes("FACTURAMA_CANCELACION_CONFIRMADA"));
  await assert.rejects(cancel("doble"), /ya está cancelada/);

  await seed("falla");
  deleteResponse = () => { throw new Error("TRANSPORT_LOST"); };
  await assert.rejects(cancel("falla"), /TRANSPORT_LOST/);
  assert.equal((await db.doc("facturamaInvoices/falla").get()).data().cancellationStatus, "REQUEST_FAILED");
  assert.ok((await activity("falla")).includes("FACTURAMA_CANCELACION_FALLIDA"));
  deleteResponse = () => ({ Status: "pending" });
  await cancel("falla");

  const old = admin.firestore.Timestamp.fromMillis(Date.now() - 2 * 3600000);
  const iqCase = async (id, cancellationStatus, operationStatus, comment) => {
    const ref = db.doc(`solicitudes/${id}`);
    await ref.set({ rootId: root, folio: id, status: "COMPLETADA", iqCancellationStatus: cancellationStatus, iqCancellationRequestedAt: old });
    await iq.applyIqCancellationReconcile(ref, { operation_status: operationStatus, rejection_comments: comment }, "123");
    return (await ref.get()).data();
  };
  const confirmed = await iqCase("iq-confirma", "REQUESTED", "Cancelada");
  assert.equal(confirmed.status, "CANCELADA");
  assert.equal(confirmed.iqCancellationStatus, "CONFIRMED");
  const rejected = await iqCase("iq-rechaza", "REQUESTED", "En Operacion", "No procede");
  assert.equal(rejected.iqCancellationStatus, "REJECTED");
  assert.equal(rejected.status, "COMPLETADA", "un rechazo no cancela la solicitud");
  assert.equal(rejected.iqCancellationRejectionComment, "No procede");
  assert.equal((await iqCase("iq-promueve", "OUTCOME_UNKNOWN", "Pendiente Cancelación")).iqCancellationStatus, "REQUESTED");
  assert.equal((await iqCase("iq-noaplica", "OUTCOME_UNKNOWN", "En Operacion")).iqCancellationStatus, "NOT_APPLIED");
  assert.equal((await iqCase("iq-espera", "REQUESTED", "Pendiente Cancelacion")).iqCancellationStatus, "REQUESTED");
  assert.ok((await activity("iq-rechaza")).includes("IQ_CANCELACION_RECHAZADA"));

  console.log("PASS cancelaciones: un solo envio, abonos protegidos, seguimiento hasta el SAT y desenlaces IQ.");
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
