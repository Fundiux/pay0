const assert = require("node:assert/strict");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "") || !/^demo-/.test(process.env.GCLOUD_PROJECT || "")) throw Error("ISOLATED_FIRESTORE_EMULATOR_REQUIRED");
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const { reserveRun, finishRun, runIdFor, mexicoDayKey } = require("../../functions/lib/modules/agentOperations/engine.js");
const db = admin.firestore();
const input = revision => ({ rootId: "root", agentId: "expediente", toolId: "quotation-recovery", entityType: "solicitud", entityId: "sol-1", revision, actorUid: "user-1", evidence: ["IQ-1", "OC-1"], correlationId: `corr-${revision}` });

(async () => {
  assert.equal(mexicoDayKey(new Date("2026-10-26T03:00:00Z")), "2026-10-25");
  const first = await Promise.all(Array.from({ length: 8 }, () => reserveRun(input("one"))));
  assert.equal(first.filter(row => row.claimed).length, 1);
  assert.equal(new Set(first.map(row => row.id)).size, 1);
  assert.equal(runIdFor(input("one")), first[0].id);
  await finishRun(first[0].id, "SUCCEEDED", { reason: "Documento activo verificado", uploadId: "upload-1", evidence: ["upload-1"] });
  assert.equal((await reserveRun(input("one"))).claimed, false);
  assert.equal((await db.collection("agentLedger").where("runId", "==", first[0].id).get()).size, 1);

  const failed = await reserveRun(input("retry"));
  await finishRun(failed.id, "FAILED_RETRYABLE", { reason: "Fallo aislado", evidence: ["error"] });
  const retried = await reserveRun(input("retry"));
  assert.equal(retried.claimed, true);
  assert.equal(retried.attempt, 2);
  await finishRun(retried.id, "FAILED_RETRYABLE", { reason: "Reintento agotado", evidence: ["error"] });
  assert.equal((await reserveRun(input("retry"))).status, "BLOCKED");

  await db.doc("agentControls/root").set({ killSwitch: true });
  assert.equal((await reserveRun(input("killed"))).status, "BLOCKED");
  assert.equal((await db.collection("agentIncidents").where("runId", "==", runIdFor(input("killed"))).get()).size, 1);
  await db.doc("agentControls/root").set({ killSwitch: false, circuitOpenUntil: admin.firestore.Timestamp.fromMillis(Date.now() + 60_000) });
  assert.equal((await reserveRun(input("circuit"))).status, "BLOCKED");
  await db.doc("agentControls/root").set({ circuitOpenUntil: null });
  const blocked = await reserveRun(input("incident"));
  await finishRun(blocked.id, "ESCALATED", { reason: "Origen ambiguo", evidence: ["pending-upload"] });
  assert.equal((await db.collection("agentIncidents").where("runId", "==", blocked.id).get()).size, 1);
  console.log("PASS transactional claim, deduplication, ledger, retry limit, kill switch, escalation");
})().catch(error => { console.error(error); process.exitCode = 1; });
