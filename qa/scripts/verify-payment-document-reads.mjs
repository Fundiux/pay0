import assert from "node:assert/strict";
import fs from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: process.env.GCLOUD_PROJECT || "pay0-payment-document-reads",
  firestore: { rules: fs.readFileSync("firestore.rules", "utf8") },
});

try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", "betell"), {
      role: "admin",
      rootId: "rootA",
      isActive: true,
    });
    await setDoc(doc(db, "users", "otherAdmin"), {
      role: "admin",
      rootId: "rootB",
      isActive: true,
    });
    await setDoc(doc(db, "solicitudes", "solA"), {
      rootId: "rootA",
      adminId: "betell",
      createdBy: "betell",
    });
    await setDoc(doc(db, "solicitudes", "solB"), {
      rootId: "rootB",
      adminId: "otherAdmin",
      createdBy: "otherAdmin",
    });
    await setDoc(doc(db, "pagos", "pagoA"), {
      rootId: "rootA",
      adminId: "betell",
      createdBy: "betell",
    });
    await setDoc(doc(db, "pagos", "pagoB"), {
      rootId: "rootB",
      adminId: "otherAdmin",
      createdBy: "otherAdmin",
    });
    await setDoc(doc(db, "pagoAplicaciones", "appA"), {
      rootId: "rootA",
      adminId: "betell",
      createdBy: "betell",
      solicitudId: "solA",
      pagoId: "pagoA",
      status: "APLICADA",
    });
    await setDoc(doc(db, "pagoAplicaciones", "appB"), {
      rootId: "rootB",
      adminId: "otherAdmin",
      createdBy: "otherAdmin",
      solicitudId: "solB",
      pagoId: "pagoB",
      status: "APLICADA",
    });
    await setDoc(doc(db, "uploads", "receiptA"), {
      rootId: "rootA",
      pagoId: "pagoA",
      entityType: "pagos",
      documentType: "COMPROBANTE_PAGO",
      active: true,
    });
    await setDoc(doc(db, "uploads", "complementA"), {
      rootId: "rootA",
      pagoId: "pagoA",
      solicitudId: "solA",
      entityType: "pagos",
      documentType: "COMPLEMENTO_PAGO_PDF",
      active: true,
    });
    await setDoc(doc(db, "uploads", "solicitudDocA"), {
      rootId: "rootA",
      solicitudId: "solA",
      entityType: "solicitudes",
      documentType: "FACTURA_PDF",
      active: true,
    });
    await setDoc(doc(db, "uploads", "receiptB"), {
      rootId: "rootB",
      pagoId: "pagoB",
      entityType: "pagos",
      documentType: "COMPROBANTE_PAGO",
      active: true,
    });
  });

  const db = env.authenticatedContext("betell").firestore();
  const uploads = collection(db, "uploads");
  const applications = collection(db, "pagoAplicaciones");

  const paymentDocuments = await assertSucceeds(getDocs(query(
    uploads,
    where("rootId", "==", "rootA"),
    where("pagoId", "==", "pagoA"),
  )));
  assert.equal(paymentDocuments.size, 2);

  const solicitudDocuments = await assertSucceeds(getDocs(query(
    uploads,
    where("rootId", "==", "rootA"),
    where("solicitudId", "==", "solA"),
  )));
  assert.equal(solicitudDocuments.size, 2);

  const relatedApplications = await assertSucceeds(getDocs(query(
    applications,
    where("rootId", "==", "rootA"),
    where("solicitudId", "==", "solA"),
  )));
  assert.equal(relatedApplications.size, 1);

  const relatedPagoDocuments = await assertSucceeds(getDocs(query(
    uploads,
    where("rootId", "==", "rootA"),
    where("pagoId", "in", ["pagoA"]),
  )));
  assert.equal(relatedPagoDocuments.size, 2);

  await assertFails(getDocs(query(uploads, where("pagoId", "==", "pagoA"))));
  await assertFails(getDocs(query(
    uploads,
    where("rootId", "==", "rootB"),
    where("pagoId", "==", "pagoB"),
  )));

  console.log("PASS documentos de pagos, solicitudes y complementos acotados por rootId");
} finally {
  await env.cleanup();
}
