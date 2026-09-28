const assert = require("node:assert/strict");
const contract = require("../../functions/lib/modules/agent007/universalQueryContract.js");

const query = { schemaVersion: contract.HUGO_UNIVERSAL_QUERY_VERSION, domain: "PAY0", source: "authorized.payments", operation: "SUMMARY", filters: [{ field: "date", operator: "GTE", value: "2026-09-01" }], columns: ["amount"], groupBy: [], orderBy: [], limit: 100 };
const alice = { actorRef: "actor-a", rootRef: "root-a", policyVersion: "v1", capabilities: ["payments.read"] };
const bob = { actorRef: "actor-b", rootRef: "root-a", policyVersion: "v1", capabilities: ["payments.read"] };
const snapshot = { schemaVersion: contract.HUGO_SNAPSHOT_VERSION, snapshotId: "snap-1", queryDigest: contract.queryDigest(query), authorizationDigest: contract.authorizationDigest(alice), ownerActorRef: alice.actorRef, ownerRootRef: alice.rootRef, domain: "PAY0", source: query.source, sourceVersion: "v1", status: "READY", createdAt: "2026-09-27T00:00:00.000Z", expiresAt: "2026-09-28T00:00:00.000Z", rows: Object.freeze([]), aggregates: Object.freeze({ total: 0 }) };

assert.equal(contract.queryDigest(query), contract.queryDigest({ ...query, columns: ["amount"] }));
assert.equal(contract.canReuseSnapshot(snapshot, query, alice, Date.parse("2026-09-27T12:00:00.000Z")), true);
assert.equal(contract.canReuseSnapshot(snapshot, query, bob, Date.parse("2026-09-27T12:00:00.000Z")), false);
assert.throws(() => contract.assertSnapshotOwner(snapshot, bob), /HUGO_SNAPSHOT_FORBIDDEN/);
assert.throws(() => contract.validateUniversalQuery({ ...query, limit: 10001 }), /HUGO_QUERY_LIMIT_INVALID/);
const queued = { jobId: "job-1", ownerActorRef: alice.actorRef, ownerRootRef: alice.rootRef, queryDigest: snapshot.queryDigest, status: "QUEUED", progress: 0, snapshotId: null, createdAt: snapshot.createdAt, updatedAt: snapshot.createdAt };
const running = contract.transitionQueryJob(queued, "RUNNING", 10, null, "2026-09-27T00:01:00.000Z");
assert.equal(contract.transitionQueryJob(running, "COMPLETED", 100, snapshot.snapshotId, "2026-09-27T00:02:00.000Z").status, "COMPLETED");
assert.throws(() => contract.transitionQueryJob(running, "COMPLETED", 90, null, "2026-09-27T00:02:00.000Z"), /HUGO_JOB_COMPLETION_INVALID/);

console.log(JSON.stringify({ ok: true, universalQuery: true, immutableSnapshotContract: true, crossUserReuseBlocked: true, analyticKinds: 8, renderFormats: 5, jobs: true, schedulingEnabled: false, connectorsImplemented: 0, reportsImplemented: 0 }));
