import assert from "node:assert/strict";
import fs from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: process.env.GCLOUD_PROJECT || "pay0-system",
  firestore: { rules: fs.readFileSync("firestore.rules", "utf8") },
});

const scoped = (db, field, rootId, entityId) => getDocs(query(
  collection(db, "uploads"),
  where("rootId", "==", rootId),
  where(field, "==", entityId),
));

try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [uid, role, rootId] of [
      ["superA", "superadmin", "rootA"],
      ["adminA", "admin", "rootA"],
      ["operatorA", "operador", "rootA"],
      ["adminB", "admin", "rootB"],
    ]) {
      await setDoc(doc(db, "users", uid), { role, rootId, isActive: true, active: true });
    }
    await setDoc(doc(db, "users", "inactiveA"), {
      role: "admin", rootId: "rootA", isActive: false, active: false,
    });

    await setDoc(doc(db, "solicitudes", "solA"), {
      rootId: "rootA", adminId: "adminA", createdBy: "operatorA",
    });
    await setDoc(doc(db, "solicitudes", "solB"), {
      rootId: "rootB", adminId: "adminB", createdBy: "adminB",
    });
    await setDoc(doc(db, "pagos", "pagoA"), {
      rootId: "rootA", adminId: "adminA", createdBy: "operatorA",
    });
    await setDoc(doc(db, "pagos", "pagoB"), {
      rootId: "rootB", adminId: "adminB", createdBy: "adminB",
    });
    await setDoc(doc(db, "pagoAplicaciones", "appA"), {
      rootId: "rootA",
      adminId: "adminA",
      createdBy: "operatorA",
      solicitudId: "solA",
      pagoId: "pagoA",
      status: "APLICADA",
    });
    await setDoc(doc(db, "pagoAplicaciones", "appB"), {
      rootId: "rootB",
      adminId: "adminB",
      createdBy: "adminB",
      solicitudId: "solB",
      pagoId: "pagoB",
      status: "APLICADA",
    });

    for (const [id, data] of [
      ["receiptA", { rootId: "rootA", pagoId: "pagoA", entityType: "pagos", documentType: "COMPROBANTE_PAGO" }],
      ["complementA", { rootId: "rootA", pagoId: "pagoA", solicitudId: "solA", entityType: "pagos", documentType: "COMPLEMENTO_PAGO_PDF" }],
      ["solicitudDocA", { rootId: "rootA", solicitudId: "solA", entityType: "solicitudes", documentType: "FACTURA_PDF" }],
      ["dispersionDocA", { rootId: "rootA", dispersionId: "dispersionA", entityType: "clientDispersions", documentType: "COMPROBANTE_DISPERSION" }],
      ["receiptB", { rootId: "rootB", pagoId: "pagoB", entityType: "pagos", documentType: "COMPROBANTE_PAGO" }],
      ["dispersionDocB", { rootId: "rootB", dispersionId: "dispersionB", entityType: "clientDispersions", documentType: "COMPROBANTE_DISPERSION" }],
    ]) {
      await setDoc(doc(db, "uploads", id), { ...data, active: true, status: "READY" });
    }
  });

  for (const uid of ["superA", "adminA", "operatorA"]) {
    const db = env.authenticatedContext(uid).firestore();
    const paymentDocuments = await assertSucceeds(scoped(db, "pagoId", "rootA", "pagoA"));
    assert.equal(paymentDocuments.size, 2, `${uid} debe ver comprobante y complemento del pago`);

    const solicitudDocuments = await assertSucceeds(scoped(db, "solicitudId", "rootA", "solA"));
    assert.equal(solicitudDocuments.size, 2, `${uid} debe ver factura y complemento relacionados`);

    const dispersionDocuments = await assertSucceeds(scoped(db, "dispersionId", "rootA", "dispersionA"));
    assert.equal(dispersionDocuments.size, 1, `${uid} debe ver el comprobante de dispersion`);

    const relatedApplications = await assertSucceeds(getDocs(query(
      collection(db, "pagoAplicaciones"),
      where("rootId", "==", "rootA"),
      where("solicitudId", "==", "solA"),
    )));
    assert.equal(relatedApplications.size, 1);

    const relatedPagoDocuments = await assertSucceeds(getDocs(query(
      collection(db, "uploads"),
      where("rootId", "==", "rootA"),
      where("pagoId", "in", ["pagoA"]),
    )));
    assert.equal(relatedPagoDocuments.size, 2);
  }

  for (const uid of ["adminA", "operatorA"]) {
    const db = env.authenticatedContext(uid).firestore();
    await assertFails(getDocs(query(collection(db, "uploads"), where("pagoId", "==", "pagoA"))));
    await assertFails(getDocs(query(collection(db, "uploads"), where("dispersionId", "==", "dispersionA"))));
    await assertFails(scoped(db, "pagoId", "rootB", "pagoB"));
    await assertFails(scoped(db, "dispersionId", "rootB", "dispersionB"));
  }

  const superDb = env.authenticatedContext("superA").firestore();
  assert.equal((await assertSucceeds(getDocs(query(
    collection(superDb, "uploads"),
    where("pagoId", "==", "pagoA"),
  )))).size, 2);

  await assertFails(scoped(
    env.authenticatedContext("inactiveA").firestore(),
    "pagoId",
    "rootA",
    "pagoA",
  ));
  await assertFails(scoped(env.unauthenticatedContext().firestore(), "pagoId", "rootA", "pagoA"));

  console.log("PASS documentos de pagos y dispersiones: superadmin, admin y operador con aislamiento por rootId");
} finally {
  await env.cleanup();
}
