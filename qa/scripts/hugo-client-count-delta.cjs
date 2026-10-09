const assert = require("node:assert/strict");
const { applicationDefault, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getUserRole } = require("../../functions/lib/utils/authGuard");
const { resolveClientOperationalAccess } = require("../../functions/lib/modules/clientDelegations/access");
const { userQueryMatchLevel } = require("../../functions/lib/modules/agent007/platformReadConnector");

const projectId = String(process.env.GOOGLE_CLOUD_PROJECT || "pay-0-system").trim();
const actorQuery = String(process.env.HUGO_VALIDATION_ACTOR_QUERY || "").trim();
const targetQuery = String(process.env.HUGO_VALIDATION_TARGET_QUERY || "").trim();
const since = Date.parse(String(process.env.HUGO_VALIDATION_SINCE || ""));
if (!actorQuery || !targetQuery || !Number.isFinite(since)) throw Error("HUGO_DELTA_INPUT_REQUIRED");
if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();
const millis = value => value?.toMillis?.() || (value instanceof Date ? value.getTime() : Date.parse(String(value || "")) || 0);

async function find(query) {
  const users = await db.collection("users").limit(500).get();
  const values = doc => [doc.id, doc.get("displayName"), doc.get("nombreUsuario"), doc.get("email")];
  const exact = users.docs.filter(doc => userQueryMatchLevel(query, values(doc)) === "EXACT");
  const matches = exact.length ? exact : users.docs.filter(doc => userQueryMatchLevel(query, values(doc)) === "UNIQUE_PREFIX");
  assert.equal(matches.length, 1, `USER_QUERY_NOT_UNIQUE:${matches.length}`);
  return matches[0];
}

(async () => {
  const actorDoc = await find(actorQuery), targetDoc = await find(targetQuery);
  const actor = actorDoc.data(), target = targetDoc.data(), rootId = String(actor.rootId || actorDoc.id), role = getUserRole(target);
  assert.equal(String(target.rootId || ""), rootId, "TARGET_OUT_OF_ROOT");
  const clients = await db.collection("clients").where("rootId", "==", rootId).get();
  const iqConfig = (await db.doc(`iqIntegrationConfigs/${rootId}`).get()).data() || {};
  const visible = [];
  let inactiveDirectChangedSince = 0;
  for (const doc of clients.docs) {
    const row = doc.data();
    const direct = [row.adminId, row.ownerId, row.managedByUserId, row.createdBy, row.operadorId].some(value => String(value || "") === targetDoc.id);
    if (row.active === false && direct && Math.max(millis(row.createdAt), millis(row.updatedAt)) >= since) inactiveDirectChangedSince++;
    if (row.active !== true) continue;
    const access = await resolveClientOperationalAccess({ uid: targetDoc.id, role, rootId, clientId: doc.id, client: row });
    if (!access.allowed || access.permissions.view !== true) continue;
    visible.push({ id: doc.id, source: access.source, createdAt: millis(row.createdAt), updatedAt: millis(row.updatedAt) });
  }
  const delegationSnap = await db.collection("userClientAccess").doc(targetDoc.id).collection("clients").get();
  const delegationChanges = delegationSnap.docs.filter(doc => millis(doc.get("updatedAt") || doc.get("createdAt")) >= since);
  const activitySnap = await db.collection("activityLog").where("rootId", "==", rootId).limit(5000).get();
  const visibleIds = new Set(visible.map(row => row.id));
  const relevantActivity = activitySnap.docs.map(doc => doc.data()).filter(row => millis(row.createdAt) >= since && String(row.referenceType || "") === "client");
  const currentVisibleCreates = relevantActivity.filter(row => row.event === "CLIENT_CREATE" && visibleIds.has(String(row.referenceId || ""))).length;
  const currentVisibleUpdates = relevantActivity.filter(row => row.event === "CLIENT_UPDATE" && visibleIds.has(String(row.referenceId || ""))).length;
  const activations = relevantActivity.filter(row => row.event === "CLIENT_TOGGLE" && /\bactivado\b/i.test(String(row.description || ""))).length;
  const deactivations = relevantActivity.filter(row => row.event === "CLIENT_TOGGLE" && /\bdesactivado\b/i.test(String(row.description || ""))).length;
  console.log(JSON.stringify({ ok: true, readOnly: true, target: { matched: true, role },
    since: new Date(since).toISOString(), count: visible.length, sources: visible.reduce((out, row) => ({ ...out, [row.source]: (out[row.source] || 0) + 1 }), {}),
    visibleClientsCreatedSince: visible.filter(row => row.createdAt >= since).length,
    visibleClientsUpdatedSince: visible.filter(row => row.updatedAt >= since).length,
    visibleClientRecordsChangedSince: visible.filter(row => Math.max(row.createdAt, row.updatedAt) >= since).length,
    inactiveDirectRecordsChangedSince: inactiveDirectChangedSince,
    delegationRecordsChangedSince: delegationChanges.length,
    dispersionCreate: iqConfig.automation?.dispersionCreate === true,
    auditedEvents: { currentVisibleCreates, currentVisibleUpdates, activations, deactivations } }, null, 2));
})().catch(error => { console.error(JSON.stringify({ ok: false, code: error instanceof Error ? error.message.split(":")[0] : "DELTA_FAILED" })); process.exitCode = 1; });
