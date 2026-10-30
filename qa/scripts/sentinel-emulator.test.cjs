const assert = require("node:assert/strict");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "") || !/^demo-/.test(process.env.GCLOUD_PROJECT || "")) throw Error("ISOLATED_FIRESTORE_EMULATOR_REQUIRED");
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const { observeSentinelEvent } = require("../../functions/lib/modules/agentOperations/sentinel.js");

(async () => {
  const input = { rootId: "root", systemId: "pay0", eventId: "event-1", kind: "AUTH_DENIED", actorUid: "user", entityType: "solicitud", entityId: "sol", evidence: ["solicitudes/sol"] };
  const first = await observeSentinelEvent(input);
  assert.equal(first.decision, "RESTRICTED");
  assert.equal((await observeSentinelEvent(input)).duplicate, true);
  assert.equal((await db.collection("sentinelEvents").where("eventId", "==", "event-1").get()).size, 1);
  assert.equal((await db.collection("agentIncidents").where("sentinelEventId", "==", first.id).get()).size, 1);
  assert.equal((await db.doc(`sentinelEvents/${first.id}`).get()).get("containmentApplied"), false);
  await assert.rejects(observeSentinelEvent({ ...input, systemId: "apuestas", eventId: "event-2" }), /INVALID_SENTINEL_EVENT/);
  console.log("PASS Sentinel classification, idempotency, incident evidence, observation-only, system isolation");
})().catch(error => { console.error(error); process.exitCode = 1; });
