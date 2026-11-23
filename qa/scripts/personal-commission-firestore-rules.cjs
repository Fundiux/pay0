const assert = require("node:assert/strict");
const fs = require("node:fs");
const { initializeTestEnvironment, assertFails } = require("@firebase/rules-unit-testing");
const { doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc } = require("firebase/firestore");

const projectId = "demo-pay0-pr43";
const host = process.env.FIRESTORE_EMULATOR_HOST || "";
if (process.env.GCLOUD_PROJECT !== projectId || !/^127\.0\.0\.1:\d+$/.test(host)) {
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
      await setDoc(doc(database, "clientCommissionAllocationDrafts", "qa-draft"), {
        rootId: "root-qa", clientId: "qa-client", ownerUid: "qa-owner", instructions: [], status: "DRAFT", version: 1,
      });
      await setDoc(doc(database, "clientCommissionAllocationDraftHistory", "qa-history"), {
        rootId: "root-qa", clientId: "qa-client", ownerUid: "qa-owner", instructions: [], status: "DRAFT", version: 1,
      });
      await setDoc(doc(database, "clientCommissionAllocationRules", "qa-rule"), {
        rootId: "root-qa", clientId: "qa-client", ownerUid: "qa-owner", instructions: [], status: "CONFIGURED", executionEnabled: false, version: 1,
      });
      await setDoc(doc(database, "clientCommissionAllocationHistory", "qa-published-history"), {
        rootId: "root-qa", clientId: "qa-client", ownerUid: "qa-owner", instructions: [], status: "CONFIGURED", executionEnabled: false, version: 1,
      });
      await setDoc(doc(database, "personalCommissionIqLinks", "qa-iq-link"), {
        rootId: "root-qa", clientId: "qa-client", ownerUid: "qa-owner", accountId: "qa-account", iqLinkStatus: "VERIFIED",
      });
      await setDoc(doc(database, "clientCommissionAllocationCalculations", "qa-calculation"), {
        rootId: "root-qa", clientId: "qa-client", ownerUid: "qa-owner", paymentId: "qa-payment",
        status: "CALCULATED_NOT_EXECUTABLE", executionEnabled: false, version: 1,
      });
    });
    const protectedDocuments = [
      ["personalCommissionAccounts", "qa-account"],
      ["clientCommissionAllocationDrafts", "qa-draft"],
      ["clientCommissionAllocationDraftHistory", "qa-history"],
      ["clientCommissionAllocationRules", "qa-rule"],
      ["clientCommissionAllocationHistory", "qa-published-history"],
      ["personalCommissionIqLinks", "qa-iq-link"],
      ["clientCommissionAllocationCalculations", "qa-calculation"],
    ];
    let denials = 0;
    for (const uid of ["qa-owner", "qa-super", "qa-other"]) {
      const database = environment.authenticatedContext(uid).firestore();
      for (const [collectionName, documentId] of protectedDocuments) {
        const target = doc(database, collectionName, documentId);
        await assertFails(getDoc(target));
        await assertFails(getDocs(collection(database, collectionName)));
        await assertFails(setDoc(doc(database, collectionName, uid), { ownerUid: uid }));
        await assertFails(updateDoc(target, { active: false }));
        await assertFails(deleteDoc(target));
        denials += 5;
      }
    }
    assert.equal(denials, 105);
    console.log("PASS: 105 Firestore rule denials across accounts, IQ links, drafts, published rules and calculations.");
  } finally {
    await environment.cleanup();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
