import assert from "node:assert/strict";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Esta prueba solo puede correr contra Firestore Emulator.");
}
if (!getApps().length) initializeApp({ projectId: "pay0-local-fixtures" });
const db = getFirestore();
const rootId = "whatsapp-auto-fixtures";
const clientId = "whatsapp-auto-client";
const solicitudId = "whatsapp-auto-solicitud";

await db.doc(`clients/${clientId}`).set({ rootId, active: true, name: "Cliente sin destino" });
await db.doc(`whatsappAutomationConfigs/${rootId}`).set({ rootId, enabled: true });
await db.doc("whatsappQrConnectors/default").set({ status: "DISCONNECTED", sendEnabled: false });

for (const type of ["FACTURA_PDF", "FACTURA_XML"]) {
  await db.collection("uploads").doc(`${solicitudId}-${type}`).set({
    rootId, solicitudId, clienteId: clientId, entityId: solicitudId,
    entityType: "SOLICITUDES", documentType: type, active: true, status: "READY",
    storagePath: `fixtures/${solicitudId}/${type}`, originalName: `${type}.fixture`,
    version: 1, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}

let job;
for (let attempt = 0; attempt < 20; attempt += 1) {
  const snap = await db.collection("documentDeliveryJobs").where("sourceId", "==", solicitudId).get();
  job = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).find((row) => row.rootId === rootId);
  if (job?.targetResolutionStatus) break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

assert.ok(job, "La automatizacion no creo el job esperado.");
assert.equal(job.origin, "AUTOMATIC");
assert.equal(job.targetResolutionStatus, "CLIENT_WHATSAPP_MISSING");
assert.equal(job.targetDestinationsCount, 0);
console.log("PASS WhatsApp automatico: PDF/XML genera un job unico y cliente sin destino queda marcado para configuracion.");
