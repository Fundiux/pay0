import assert from "node:assert/strict";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Esta prueba solo puede correr contra Firestore Emulator.");
}
const projectId = process.env.GCLOUD_PROJECT || "pay0-local-fixtures";
if (!getApps().length) initializeApp({ projectId });
const db = getFirestore();
const rootId = "whatsapp-auto-fixtures";
const missingClientId = "whatsapp-auto-client-missing";
const missingSolicitudId = "whatsapp-auto-solicitud-missing";
const routedClientId = "whatsapp-auto-client-routed";
const routedSolicitudId = "whatsapp-auto-solicitud-routed";

await db.doc(`clients/${missingClientId}`).set({ rootId, active: true, name: "Cliente sin destino" });
await db.doc(`clients/${routedClientId}`).set({
  rootId,
  active: true,
  name: "Cliente con destino",
  whatsapp: "+52 55 1234 5678",
});
await db.doc(`whatsappAutomationConfigs/${rootId}`).set({ rootId, enabled: true });
await db.doc("whatsappQrConnectors/default").set({ status: "DISCONNECTED", sendEnabled: false });

async function createInvoicePair(solicitudId, clientId) {
  for (const type of ["FACTURA_PDF", "FACTURA_XML"]) {
    await db.collection("uploads").doc(`${solicitudId}-${type}`).set({
      rootId, solicitudId, clienteId: clientId, entityId: solicitudId,
      entityType: "SOLICITUDES", documentType: type, active: true, status: "READY",
      storagePath: `fixtures/${solicitudId}/${type}`, originalName: `${type}.fixture`,
      version: 1, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
  }
}

async function waitForJob(solicitudId, predicate) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const snap = await db.collection("documentDeliveryJobs").where("sourceId", "==", solicitudId).get();
    const job = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).find((row) => row.rootId === rootId);
    if (job && predicate(job)) return job;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

await createInvoicePair(missingSolicitudId, missingClientId);
const missingJob = await waitForJob(
  missingSolicitudId,
  (job) => job.targetResolutionStatus === "CLIENT_GROUP_MISSING"
);

assert.ok(missingJob, "La automatizacion no creo el job sin destino esperado.");
assert.equal(missingJob.origin, "AUTOMATIC");
assert.equal(missingJob.targetResolutionStatus, "CLIENT_GROUP_MISSING");
assert.equal(missingJob.targetDestinationsCount, 0);
assert.notEqual(missingJob.status, "READY_FOR_SEND");

// A client with only a private WhatsApp number is not a destination either: documents go only to a group.
await createInvoicePair(routedSolicitudId, routedClientId);
const phoneOnlyJob = await waitForJob(
  routedSolicitudId,
  (job) => job.targetResolutionStatus === "CLIENT_GROUP_MISSING"
);

assert.ok(phoneOnlyJob, "El cliente con solo telefono privado debio quedar esperando grupo.");
assert.equal(phoneOnlyJob.targetDestinationsCount, 0);
assert.notEqual(phoneOnlyJob.status, "READY_FOR_SEND");

console.log("PASS WhatsApp automatico: sin grupo asignado el envio espera y nunca usa el telefono privado.");
