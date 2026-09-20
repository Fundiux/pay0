process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-pay0";

const assert = require("node:assert/strict");
const admin = require("../../functions/node_modules/firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const { Timestamp } = admin.firestore;
const { publishAnalyticsEvent } = require("../../functions/lib/modules/controlCenter/eventStore.js");

const input = {
  eventId: "payment-created:pago-idempotent:v1",
  rootId: "root-control-center-contract",
  eventType: "PAYMENT_CREATED",
  module: "pagos",
  entityType: "pago",
  entityId: "pago-idempotent",
  occurredAt: Timestamp.fromDate(new Date("2026-09-19T18:00:00.000Z")),
  money: { currency: "MXN", grossMinor: 9900 },
  dimensions: { clientId: "client-a" },
  sourceVersion: 1,
};

async function run() {
  const first = await publishAnalyticsEvent(input);
  const retry = await publishAnalyticsEvent(input);
  assert.equal(first.created, true);
  assert.equal(retry.created, false);

  await assert.rejects(
    publishAnalyticsEvent({ ...input, rootId: "root-b" }),
    /EVENT_ID_CONFLICT/
  );

  const stored = await db.collection("analyticsEvents").doc(input.eventId).get();
  assert.equal(stored.data().rootId, input.rootId);
  assert.equal(stored.data().money.grossMinor, 9900);
  assert.equal(stored.data().periods.month, "2026-09");
  console.log(JSON.stringify({ ok: true, first, retry, storedRootId: stored.data().rootId }, null, 2));
}

run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
