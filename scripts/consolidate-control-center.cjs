// Administrative maintenance using the already-authorized Firebase CLI account.
// Default is read-only inspection. --apply touches derived analytics and recovery
// queues only; it never invokes invoice issuance, payments or external messages.
const path = require("node:path");
const args = process.argv.slice(2);
const cliPath = args[args.indexOf("--cli-lib") + 1];
if (!args.includes("--cli-lib") || !cliPath) throw Error("Supply the installed Firebase CLI lib path");
if (process.env.FIRESTORE_EMULATOR_HOST) throw Error("This maintenance command is not an emulator test");
process.env.DEBUG = "";
const cliAuth = require(path.join(cliPath, "auth.js"));
const cliScopes = require(path.join(cliPath, "scopes.js"));
const account = cliAuth.getProjectDefaultAccount(process.cwd());
if (!account?.tokens?.refresh_token) throw Error("Firebase CLI authorization required");
const admin = require("../functions/node_modules/firebase-admin");
admin.initializeApp({ projectId: "pay-0-system" });
const db = admin.firestore();
async function run() {
  const { OAuth2Client, GoogleAuth } = require("../functions/node_modules/google-auth-library");
  const token = await cliAuth.getAccessToken(account.tokens.refresh_token, [cliScopes.CLOUD_PLATFORM, cliScopes.FIREBASE_PLATFORM]);
  const authClient = new OAuth2Client();
  authClient.setCredentials({ access_token: token.access_token, expiry_date: token.expires_at || Date.now() + 50 * 60000 });
  db.settings({ auth: new GoogleAuth({ authClient, projectId: "pay-0-system" }) });
  const roots = await db.collection("controlCenterSnapshots").limit(2).get();
  if (roots.size !== 1) throw Error("Expected exactly one existing Control Center root; do not infer a tenant");
  const rootId = roots.docs[0].id;
  if (roots.docs[0].data().rootId !== rootId) throw Error("Snapshot ownership mismatch");
  const before = (await db.doc(`analyticsRoots/${rootId}`).get()).data() || {};
  console.log(JSON.stringify({ mode: args.includes("--apply") ? "APPLY_DERIVED_ANALYTICS" : "INSPECT", roots: 1, status: before.bootstrapStatus || "NOT_STARTED", processed: before.processed || 0, previousSourceCounts: roots.docs[0].data().sourceCounts || null }));
  if (args.includes("--verify")) {
    const { createHash } = require("node:crypto");
    const contributions = await db.collection("analyticsContributions").where("rootId", "==", rootId).select("source", "metrics").get();
    const totals = {}, sources = {};
    for (const doc of contributions.docs) {
      const row = doc.data(); sources[row.source] = (sources[row.source] || 0) + 1;
      for (const [key, value] of Object.entries(row.metrics || {})) totals[key] = (totals[key] || 0) + value;
    }
    const bucketId = createHash("sha256").update("all:all:all").digest("hex");
    const bucket = (await db.doc(`analyticsRoots/${rootId}/buckets/${bucketId}`).get()).data()?.metrics || {};
    const mismatches = [...new Set([...Object.keys(totals), ...Object.keys(bucket)])].filter(key => (totals[key] || 0) !== (bucket[key] || 0));
    const snapshot = roots.docs[0].data();
    const ok = before.bootstrapStatus === "COMPLETE" && snapshot.version === 2 && mismatches.length === 0;
    console.log(JSON.stringify({ verification: ok ? "PASS" : "NOT_READY_OR_CHANGED_DURING_READ", overviewVersion: snapshot.version, contributions: contributions.size, sources, metricsChecked: Object.keys(totals).length, mismatches }));
    if (!ok) throw Error("ANALYTICS_VERIFICATION_INCOMPLETE");
    return;
  }
  if (!args.includes("--apply")) return;
  const { initializeAnalyticsRoot } = require("../functions/lib/modules/controlCenter/analyticsCallables.js");
  const { buildControlCenterSnapshot } = require("../functions/lib/modules/controlCenter/callables.js");
  let complete = false;
  while (!complete) {
    const result = await initializeAnalyticsRoot(rootId); complete = result.complete;
    console.log(JSON.stringify({ complete, source: result.source, processed: result.processed }));
  }
  const snapshot = await buildControlCenterSnapshot(rootId, "ADMINISTRATIVE_ANALYTICS_BACKFILL");
  if (snapshot.version !== 2) throw Error("Incremental overview not active");
  console.log(JSON.stringify({ ok: true, overviewVersion: snapshot.version, coverageComplete: true, financialOperationsExecuted: 0 }));
}
run().then(() => process.exit(0)).catch(error => { console.error(String(error?.code || error?.message || "Maintenance failed")); process.exit(1); });
