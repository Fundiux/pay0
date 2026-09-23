import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: process.env.GCLOUD_PROJECT || "pay0-system",
  firestore: { rules: fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8") },
});

const scopedSolicitudDocuments = (db, rootId, solicitudId) => getDocs(query(
  collection(db, "uploads"),
  where("rootId", "==", rootId),
  where("solicitudId", "==", solicitudId),
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

    for (const [id, documentType] of [
      ["solA-pdf", "FACTURA_PDF"],
      ["solA-xml", "FACTURA_XML"],
      ["solA-oc", "ORDEN_COMPRA"],
      ["solA-quotation", "COTIZACION"],
    ]) {
      await setDoc(doc(db, "uploads", id), {
        rootId: "rootA",
        solicitudId: "solA",
        entityType: "solicitudes",
        documentType,
        active: true,
        status: "READY",
      });
    }
    await setDoc(doc(db, "uploads", "solB-pdf"), {
      rootId: "rootB",
      solicitudId: "solB",
      entityType: "solicitudes",
      documentType: "FACTURA_PDF",
      active: true,
      status: "READY",
    });
  });

  for (const uid of ["superA", "adminA", "operatorA"]) {
    const db = env.authenticatedContext(uid).firestore();
    const result = await assertSucceeds(scopedSolicitudDocuments(db, "rootA", "solA"));
    assert.equal(result.size, 4, `${uid} debe ver los cuatro documentos de la solicitud`);
  }

  for (const uid of ["adminA", "operatorA"]) {
    const db = env.authenticatedContext(uid).firestore();
    await assertFails(getDocs(query(
      collection(db, "uploads"),
      where("solicitudId", "==", "solA"),
    )));
    await assertFails(scopedSolicitudDocuments(db, "rootB", "solB"));
  }

  const superDb = env.authenticatedContext("superA").firestore();
  const globalForSuper = await assertSucceeds(getDocs(query(
    collection(superDb, "uploads"),
    where("solicitudId", "==", "solA"),
  )));
  assert.equal(globalForSuper.size, 4);

  await assertFails(scopedSolicitudDocuments(
    env.authenticatedContext("inactiveA").firestore(),
    "rootA",
    "solA",
  ));
  await assertFails(scopedSolicitudDocuments(env.unauthenticatedContext().firestore(), "rootA", "solA"));

  console.log("PASS documentos de solicitud: superadmin, admin y operador con aislamiento por rootId");
} finally {
  await env.cleanup();
}
