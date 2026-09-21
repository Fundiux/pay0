import fs from "node:fs";
import path from "node:path";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: "pay0-solicitud-documents-read",
  firestore: { rules: fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8") },
});

try {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", "betell"), { role: "admin", rootId: "rootA" });
    await setDoc(doc(db, "uploads", "mine"), {
      rootId: "rootA", solicitudId: "solA", entityType: "solicitudes", createdBy: "otherUser",
    });
    await setDoc(doc(db, "uploads", "other"), {
      rootId: "rootB", solicitudId: "solB", entityType: "solicitudes", createdBy: "otherUser",
    });
  });

  const uploads = collection(env.authenticatedContext("betell").firestore(), "uploads");
  const mine = await assertSucceeds(getDocs(query(
    uploads, where("rootId", "==", "rootA"), where("solicitudId", "==", "solA"),
  )));
  if (mine.size !== 1) throw new Error("La solicitud propia debe devolver un documento.");

  await assertFails(getDocs(query(uploads, where("solicitudId", "==", "solA"))));
  await assertFails(getDocs(query(uploads, where("rootId", "==", "rootB"))));
  console.log("PASS lectura de documentos de solicitud acotada por rootId");
} finally {
  await env.cleanup();
}
