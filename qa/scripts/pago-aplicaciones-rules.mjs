import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";

const projectId = process.env.GCLOUD_PROJECT || "pay0-pago-aplicaciones-rules";
const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
});

try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [uid, rootId, role, create] of [
      ["adminA", "rootA", "admin", true],
      ["operatorA", "rootA", "operador", true],
      ["viewerA", "rootA", "operador", false],
      ["adminB", "rootB", "admin", true],
    ]) {
      await setDoc(doc(db, "users", uid), {
        rootId,
        role,
        modules: { pagos: { view: true, create } },
      });
    }
    await setDoc(doc(db, "solicitudes", "solA"), {
      rootId: "rootA", adminId: "adminA", createdBy: "operatorA",
    });
    await setDoc(doc(db, "solicitudes", "solB"), {
      rootId: "rootB", adminId: "adminB", createdBy: "adminB",
    });
    await setDoc(doc(db, "pagoAplicaciones", "appA"), {
      rootId: "rootA", adminId: "adminA", createdBy: "operatorA", solicitudId: "solA",
    });
    await setDoc(doc(db, "pagoAplicaciones", "appB"), {
      rootId: "rootB", adminId: "adminB", createdBy: "adminB", solicitudId: "solB",
    });
  });

  const list = (uid, rootId, ownerField, ownerId) => {
    const db = env.authenticatedContext(uid).firestore();
    return getDocs(query(
      collection(db, "pagoAplicaciones"),
      where("rootId", "==", rootId),
      where(ownerField, "==", ownerId),
    ));
  };

  assert.equal((await assertSucceeds(list("adminA", "rootA", "adminId", "adminA"))).size, 1);
  assert.equal((await assertSucceeds(list("operatorA", "rootA", "createdBy", "operatorA"))).size, 1);
  await assertFails(list("adminA", "rootB", "adminId", "adminB"));
  await assertFails(list("operatorA", "rootA", "adminId", "adminA"));
  await assertFails(list("viewerA", "rootA", "adminId", "adminA"));
  console.log("PASS pagoAplicaciones: lectura propia y rechazo de acceso ajeno");
} finally {
  await env.cleanup();
}
