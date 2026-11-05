// Unit test on the compiled P4 scope selector (functions/lib): a date-range
// scope creates the client its rows depend on, reconciliation of an existing
// client stays external, reviewed clients stay excluded, certified batches keep
// their explicit membership, and the canary follows the executor's dependency
// rule. Requires `npm run build` in functions/ (fails loudly otherwise).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const compiled = path.join(root, "functions/lib/modules/iqHistoricalImport/batchScope.js");
assert.ok(fs.existsSync(compiled), "functions/lib is not built: run `npm run build` in functions/ first");
const scope = require(compiled);
const { canonicalJson, deterministicId } = require(path.join(root, "functions/lib/modules/iqHistoricalImport/domain.js"));

const action = (overrides) => ({
  actionId: overrides.actionId, entityType: overrides.entityType, iqEntityId: overrides.iqEntityId, canonicalGroupId: "iq-group-pay0", canonicalIqProfileId: "bEGPMuplqNHMZ3lvYkeb",
  observedThroughProfileIds: ["bEGPMuplqNHMZ3lvYkeb"], rootId: "root", targetPath: `${overrides.collection}/${overrides.actionId}`, operation: overrides.operation,
  matchingEvidence: {}, tombstoneKeys: [], after: {}, mutableFields: [], dependencies: overrides.dependencies || [],
  historicalTime: { normalizedDate: overrides.date || null }, componentId: null,
});
const manifest = (clientOperation, extra = []) => ({
  manifestId: "p4m_test", manifestHash: "hash_test", status: "PLANNED", kind: "P4_IMPORT_MANIFEST", version: 7,
  range: { start: "2026-09-01", end: "2026-09-10", timezone: "America/Mexico_City" }, canonicalGroups: [],
  financialGraph: { solicitudes: [], payments: [], applications: [] },
  actions: [
    action({ actionId: "client", entityType: "CLIENT", iqEntityId: "501", collection: "clients", operation: clientOperation }),
    action({ actionId: "invoice", entityType: "SOLICITUD", iqEntityId: "7001", collection: "solicitudes", operation: "CREATE_HISTORICAL", dependencies: ["client"], date: "2026-09-03" }),
    ...extra,
  ],
  expectedPay0Writes: 0, expectedIqWrites: 0, expectedExternalEffects: 0,
});
const monthBlock = { type: "MONTH_BLOCK", month: "2026-09", block: "01_10" };
const window = { type: "CERTIFICATION_WINDOW", range: { start: "2026-09-01", end: "2026-09-10", timezone: "America/Mexico_City" } };
const members = (built) => built.members.map((row) => `${row.actionId}:${row.role}`);
const excluded = (built) => built.excluded.map((row) => `${row.actionId}:${row.reason}`);

test("selector version advanced with the member semantics", () => {
  assert.equal(scope.P4_SCOPE_SELECTOR_VERSION, "P4_SCOPE_V8_4");
});

for (const [label, request] of [["month block", monthBlock], ["certification window", window]]) {
  test(`a ${label} creates the client its invoice depends on, client first`, () => {
    const built = scope.buildExecutionScope({ manifest: manifest("CREATE_HISTORICAL"), request });
    assert.deepEqual(members(built), ["client:CLIENT_DEPENDENCY", "invoice:PRIMARY"]);
    assert.deepEqual(built.externalDependencies, []);
    assert.deepEqual(excluded(built), []);
    assert.equal(built.expectedPay0Writes, 2);
  });
}

test("an already written client leaves the scope and no longer blocks its invoice", () => {
  const built = scope.buildExecutionScope({ manifest: manifest("CREATE_HISTORICAL"), request: monthBlock, completedActionIds: new Set(["client"]) });
  assert.deepEqual(members(built), ["invoice:PRIMARY"]);
  assert.deepEqual(excluded(built), []);
});

test("reconciling an existing client is not promoted: it stays an external dependency that gates the invoice", () => {
  const built = scope.buildExecutionScope({ manifest: manifest("RECONCILE"), request: monthBlock });
  assert.deepEqual(members(built), []);
  assert.deepEqual(built.externalDependencies.map((row) => `${row.actionId}:${row.role}`), ["client:EXTERNAL_DEPENDENCY"]);
  assert.deepEqual(excluded(built), ["invoice:EXTERNAL_DEPENDENCY_PENDING"]);
});

test("a reviewed client is excluded as REVIEW and never promoted", () => {
  const built = scope.buildExecutionScope({ manifest: manifest("CLIENT_REVIEW_REQUIRED"), request: monthBlock });
  assert.ok(!members(built).includes("client:CLIENT_DEPENDENCY"));
  assert.ok(excluded(built).includes("client:REVIEW"));
});

test("a NO_OP client dependency counts as satisfied for the canary; a reviewed one does not", () => {
  const current = manifest("NO_OP");
  const built = scope.buildExecutionScope({ manifest: current, request: monthBlock });
  assert.deepEqual(members(built), ["invoice:PRIMARY"]);
  assert.deepEqual(excluded(built), ["client:NO_CHANGE"]);
  assert.deepEqual(scope.scopeCanaryQueue(built, current, new Set()).map((row) => row.actionId), ["invoice"]);

  const reviewed = manifest("SKIP_PURGED");
  const fakeScope = { ...built, members: built.members };
  assert.deepEqual(scope.scopeCanaryQueue(fakeScope, reviewed, new Set()), [], "SKIP_PURGED parent never satisfies the canary");
  assert.deepEqual(scope.scopeCanaryQueue(fakeScope, reviewed, new Set(["client"])), [], "like the executor, a reviewed parent never satisfies even when listed as completed");
});

test("a certified batch keeps its explicit membership and reports a stale selector version", () => {
  const current = manifest("CREATE_HISTORICAL");
  const evidence = (selectorVersion) => {
    const content = { selectorVersion, sourceManifestId: current.manifestId, sourceManifestHash: current.manifestHash, sourceRunId: "run_test", actionIds: ["invoice"] };
    return { certified: true, ...content, evidenceHash: deterministicId(canonicalJson(content)) };
  };
  const built = scope.buildExecutionScope({ manifest: current, request: { type: "BATCH_B" }, historicalEvidence: evidence(scope.P4_SCOPE_SELECTOR_VERSION) });
  assert.deepEqual(members(built), [], "the client is not promoted inside a certified batch");
  assert.deepEqual(built.externalDependencies.map((row) => `${row.actionId}:${row.role}`), ["client:EXTERNAL_DEPENDENCY"]);
  assert.deepEqual(excluded(built), ["invoice:EXTERNAL_DEPENDENCY_PENDING"]);
  assert.throws(() => scope.buildExecutionScope({ manifest: current, request: { type: "BATCH_B" }, historicalEvidence: evidence("P4_SCOPE_V8_3") }), (error) => error.code === "P4_SCOPE_HISTORICAL_EVIDENCE_VERSION_MISMATCH");
  assert.throws(() => scope.buildExecutionScope({ manifest: current, request: { type: "BATCH_B" } }), (error) => error.code === "P4_SCOPE_HISTORICAL_EVIDENCE_INCOMPLETE");
});
