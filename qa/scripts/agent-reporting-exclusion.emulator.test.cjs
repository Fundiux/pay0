const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "") || !/^demo-/.test(process.env.GCLOUD_PROJECT || "")) throw Error("ISOLATED_FIRESTORE_EMULATOR_REQUIRED");
const functionRequire = createRequire(resolve("functions/package.json"));
const admin = functionRequire("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const { loadAgentOperations } = require("../../functions/lib/modules/agentOperations/callables.js");
const { mexicoDayKey } = require("../../functions/lib/modules/agentOperations/time.js");

(async () => {
  const rootId = "root-report-exclusion", reportDay = mexicoDayKey();
  await Promise.all([
    db.doc("agentIncidents/visible").set({ rootId, reportDay, status: "OPEN", cause: "Visible", createdAt: admin.firestore.Timestamp.now() }),
    db.doc("agentIncidents/excluded").set({ rootId, reportDay, status: "DISMISSED_DEPLOYMENT_SCOPE", cause: "Excluded", reportingExcluded: true, createdAt: admin.firestore.Timestamp.now() }),
    db.doc("agentProposals/visible").set({ rootId, status: "DRAFT", problem: "Visible", createdAt: admin.firestore.Timestamp.now() }),
    db.doc("agentProposals/excluded").set({ rootId, status: "WITHDRAWN_DEPLOYMENT_SCOPE", problem: "Excluded", reportingExcluded: true, createdAt: admin.firestore.Timestamp.now() }),
  ]);
  const data = await loadAgentOperations(rootId);
  assert.equal(data.report.incidents, 1);
  assert.deepEqual(data.incidents.map(x => x.id), ["visible"]);
  assert.deepEqual(data.proposals.map(x => x.id), ["visible"]);
  assert.deepEqual(data.report.causes, [{ cause: "Visible", count: 1 }]);
  assert.equal((await db.collection("agentIncidents").get()).size, 2);
  assert.equal((await db.collection("agentProposals").get()).size, 2);
  console.log("PASS excluded incident/proposal retained as evidence but omitted from operations reporting");
})().catch(error => { console.error(error); process.exitCode = 1; });
