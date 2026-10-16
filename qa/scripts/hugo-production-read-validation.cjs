const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { applicationDefault, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { Pay0Connector } = require("../../functions/lib/modules/agent007/pay0Connector");
const { PlatformReadConnector, userQueryMatchLevel } = require("../../functions/lib/modules/agent007/platformReadConnector");
const { getUserRole } = require("../../functions/lib/utils/authGuard");

const projectId = String(process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "pay-0-system").trim();
const actorQuery = String(process.env.HUGO_VALIDATION_ACTOR_QUERY || "").trim();
const targetQuery = String(process.env.HUGO_VALIDATION_TARGET_QUERY || "").trim();
if (!actorQuery || !targetQuery) throw Error("HUGO_VALIDATION_QUERIES_REQUIRED");
if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();
const hash = value => createHash("sha256").update(String(value)).digest("hex").slice(0, 12);

async function findUniqueUser(query) {
  const snap = await db.collection("users").limit(500).get();
  const exact = snap.docs.filter(doc => userQueryMatchLevel(query, [doc.id, doc.get("displayName"), doc.get("nombreUsuario"), doc.get("email")]) === "EXACT");
  const matches = exact.length ? exact : snap.docs.filter(doc => userQueryMatchLevel(query, [doc.id, doc.get("displayName"), doc.get("nombreUsuario"), doc.get("email")]) === "UNIQUE_PREFIX");
  assert.equal(matches.length, 1, `USER_QUERY_NOT_UNIQUE:${matches.length}`);
  return matches[0];
}

(async () => {
  const actorDoc = await findUniqueUser(actorQuery);
  const actor = actorDoc.data();
  const role = getUserRole(actor);
  const rootId = String(actor.rootId || actorDoc.id);
  assert.equal(role, "superadmin", "VALIDATION_ACTOR_NOT_SUPERADMIN");
  const identity = { uid: actorDoc.id, rootId, role };
  const platform = new PlatformReadConnector(db, { uid: actorDoc.id }, actor, identity);
  const pay0 = new Pay0Connector(db, identity);
  const [systems, capabilities, currentClients, targetClients, latest, recent] = await Promise.all([
    platform.getSystemCatalog(), platform.getAuthorizedCapabilities(), platform.countClientsForCurrentUser(),
    platform.countClientsForUser(targetQuery), pay0.searchReceivedPagos({ limit: 1 }), pay0.searchReceivedPagos({ limit: 5 }),
  ]);
  assert.equal(targetClients.data.matchStatus, "EXACT");
  assert.equal(latest.data.order.semantic, "PAYMENT_RECEIVED_AT");
  assert.equal(recent.data.order.semantic, "PAYMENT_RECEIVED_AT");
  assert.ok(recent.data.items.length <= 5);
  if (latest.data.items.length && recent.data.items.length) assert.equal(latest.data.items[0].id, recent.data.items[0].id);
  const times = recent.data.items.map(row => row.recibidoAt).filter(Boolean).map(Date.parse);
  assert.ok(times.every((value, index) => index === 0 || times[index - 1] >= value), "PAYMENTS_NOT_DESCENDING");
  console.log(JSON.stringify({
    ok: true, readOnly: true, projectId, actor: { matched: true, role, safeRef: hash(actorDoc.id), rootSafeRef: hash(rootId) },
    systems: systems.data.map(row => ({ id: row.id, status: row.status, allowed: row.allowed })),
    capabilities: { registered: capabilities.data.capabilities.length, authorized: capabilities.data.capabilities.filter(row => row.authorized).length },
    currentUserVisibleActiveClients: currentClients.data.clientCount,
    targetUser: { matched: true, safeRef: hash(targetClients.data.user.uid), visibleActiveClients: targetClients.data.clientCount },
    receivedPayments: { latestPresent: latest.data.items.length === 1, recentCount: recent.data.items.length, latestMatchesFirst: !latest.data.items.length || latest.data.items[0].id === recent.data.items[0]?.id, descending: true,
      latestSafeRef: latest.data.items[0] ? hash(latest.data.items[0].id) : null, fields: latest.data.items[0] ? { amount: Number.isFinite(latest.data.items[0].monto), payer: latest.data.items[0].pagadorFuente, status: Boolean(latest.data.items[0].estado), receivedAt: Boolean(latest.data.items[0].recibidoAt) } : null },
  }));
})().catch(error => { console.error(JSON.stringify({ ok: false, code: error instanceof Error ? error.message.split(":")[0] : "VALIDATION_FAILED" })); process.exitCode = 1; });
