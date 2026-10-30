const assert = require("node:assert/strict");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "") || !/^demo-/.test(process.env.GCLOUD_PROJECT || "")) throw Error("ISOLATED_FIRESTORE_EMULATOR_REQUIRED");
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const functionRequire = createRequire(resolve("functions/package.json"));
const admin = functionRequire("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const { Timestamp } = functionRequire("firebase-admin/firestore");
const { escalateStaleQuotationJob } = require("../../functions/lib/modules/cotizaciones/staleJob.js");

(async () => {
  const now = Date.now();
  await db.doc("solicitudQuotationJobs/stale").set({ rootId: "root", solicitudId: "sol-stale", status: "PROCESSING", processingStartedAt: Timestamp.fromMillis(now - 11 * 60_000) });
  await db.doc("solicitudQuotationJobs/fresh").set({ rootId: "root", solicitudId: "sol-fresh", status: "PROCESSING", processingStartedAt: Timestamp.fromMillis(now - 60_000) });
  assert.equal(await escalateStaleQuotationJob(db, "fresh", now, 10 * 60_000), false);
  assert.equal(await escalateStaleQuotationJob(db, "stale", now, 10 * 60_000), true);
  assert.equal(await escalateStaleQuotationJob(db, "stale", now, 10 * 60_000), false);
  assert.equal((await db.doc("solicitudQuotationJobs/stale").get()).get("status"), "ESCALATED");
  assert.equal((await db.doc("agentIncidents/quotation-stale").get()).get("status"), "OPEN");
  console.log("PASS stale processing escalation is bounded and idempotent");
})().catch(error => { console.error(error); process.exitCode = 1; });
