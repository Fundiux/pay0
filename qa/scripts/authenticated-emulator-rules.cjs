const assert = require("node:assert/strict");
const fs = require("node:fs");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { doc, getDoc } = require("firebase/firestore");

const projectId = "demo-pay0-ui-qa";
if (process.env.GCLOUD_PROJECT !== projectId || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "") || !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || "")) {
  throw new Error("Authenticated emulator rules require only local demo emulators.");
}

(async () => {
  const env = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync("firestore.rules", "utf8") } });
  try {
    const superadmin = env.authenticatedContext("qa-superadmin").firestore();
    const limited = env.authenticatedContext("qa-limited").firestore();
    await assertSucceeds(getDoc(doc(superadmin, "users", "qa-superadmin")));
    await assertSucceeds(getDoc(doc(superadmin, "clients", "qa-client-001")));
    await assertFails(getDoc(doc(limited, "users", "qa-admin")));
    await assertFails(getDoc(doc(limited, "users", "qa-superadmin")));
    console.log(JSON.stringify({ ok: true, suite: "authenticated-emulator-rules", productionCalls: 0 }));
  } finally {
    await env.cleanup();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
