const assert = require("node:assert/strict");
const fs = require("node:fs");
const { initializeTestEnvironment, assertFails } = require("@firebase/rules-unit-testing");
const { doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc } = require("firebase/firestore");

const projectId = "demo-pay0-pr43";
const host = process.env.FIRESTORE_EMULATOR_HOST || "";
if (process.env.GCLOUD_PROJECT !== projectId || !/^127\\.0\\.0\\.1:\\d+$/.test(host)) {
  throw new Error("Se requieren emuladores locales Firestore y proyecto demo-pay0-pr43; producción prohibida.");
}

(async () => {
  const environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: fs.readFileSync("firestore.rules", "utf8") },
  });
  try {
    await environment.withSecurityRulesDisabled(async context => {
      const database = context.firestore();
      await setDoc(doc(database, "users", "qa-owner"), { rootId: "root-qa", role: "operador", active: true });
      await setDoc(doc(database, "users", "qa-super"), { rootId: "root-qa", role: "superadmin", active: true });
      await setDoc(doc(database, "personalCommissionAccounts", "qa-account"), {
        rootId: "root-qa", ownerUid: "qa-owner", active: true,
        bankName: "Banco prueba", beneficiaryName: "Titular prueba",
        instrumentType: "CLABE", instrumentNumber: "123456789012345678", iqLinkStatus: "PENDING",
      });
    });
    for (const uid of ["qa-owner", "qa-super", "qa-other"]) {
      const database = environment.authenticatedContext(uid).firestore();
      const target = doc(database, "personalCommissionAccounts", "qa-account");
      await assertFails(getDoc(target));
      await assertFails(getDocs(collection(database, "personalCommissionAccounts")));
      await assertFails(setDoc(doc(database, "personalCommissionAccounts", uid), { ownerUid: uid }));
      await assertFails(updateDoc(target, { active: false }));
      await assertFails(deleteDoc(target));
    }
    assert.equal(3 * 5, 15);
    console.log("PASS: 15 Firestore security rule denials; callable-only bank account registry.");
  } finally {
    await environment.cleanup();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
