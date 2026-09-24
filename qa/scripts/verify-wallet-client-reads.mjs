import fs from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: "pay0-wallet-client-reads",
  firestore: { rules: fs.readFileSync("firestore.rules", "utf8") },
});

try {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", "betell"), { role: "admin", rootId: "rootA" });
    await setDoc(doc(db, "users", "outsider"), { role: "admin", rootId: "rootA" });
    await setDoc(doc(db, "clients", "clientA"), { rootId: "rootA", adminId: "betell" });
    await setDoc(doc(db, "clients", "clientB"), { rootId: "rootB", adminId: "betell" });
    for (const name of ["clientBeneficiaries", "clientBeneficiaryMethods", "clientDispersions"]) {
      await setDoc(doc(db, name, "mine"), { rootId: "rootA", clientId: "clientA", createdAt: new Date() });
      await setDoc(doc(db, name, "otherRoot"), { rootId: "rootB", clientId: "clientB", createdAt: new Date() });
    }
  });

  const mine = env.authenticatedContext("betell").firestore();
  const outsider = env.authenticatedContext("outsider").firestore();
  for (const name of ["clientBeneficiaries", "clientBeneficiaryMethods", "clientDispersions"]) {
    await assertSucceeds(getDocs(query(collection(mine, name), where("rootId", "==", "rootA"), where("clientId", "==", "clientA"))));
    await assertFails(getDocs(query(collection(mine, name), where("clientId", "==", "clientB"))));
    await assertFails(getDocs(query(collection(outsider, name), where("clientId", "==", "clientA"))));
  }
  console.log("PASS lecturas wallet del cliente propio y aislamiento de otros clientes");
} finally {
  await env.cleanup();
}
