// Unit test on the compiled P4 scope selector (functions/lib): a month block
// executes the client its rows depend on, and the canary treats a NO_OP
// dependency as satisfied. Run `npm run build` in functions/ first.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const compiled = path.join(root, "functions/lib/modules/iqHistoricalImport/batchScope.js");
const available = fs.existsSync(compiled);
const scope = available ? require(compiled) : null;

const action = (overrides) => ({
  actionId: overrides.actionId, entityType: overrides.entityType, iqEntityId: overrides.iqEntityId, canonicalGroupId: "iq-group-pay0", canonicalIqProfileId: "bEGPMuplqNHMZ3lvYkeb",
  observedThroughProfileIds: ["bEGPMuplqNHMZ3lvYkeb"], rootId: "root", targetPath: `${overrides.collection}/${overrides.actionId}`, operation: overrides.operation,
  matchingEvidence: {}, tombstoneKeys: [], after: {}, mutableFields: [], dependencies: overrides.dependencies || [],
  historicalTime: { normalizedDate: overrides.date || null }, componentId: null,
});
const manifest = (clientOperation) => ({
  manifestId: "p4m_test", manifestHash: "hash_test", status: "PLANNED", kind: "P4_IMPORT_MANIFEST", version: 7,
  range: { start: "2026-09-01", end: "2026-09-10", timezone: "America/Mexico_City" }, canonicalGroups: [],
  financialGraph: { solicitudes: [], payments: [], applications: [] },
  actions: [
    action({ actionId: "client", entityType: "CLIENT", iqEntityId: "501", collection: "clients", operation: clientOperation }),
    action({ actionId: "invoice", entityType: "SOLICITUD", iqEntityId: "7001", collection: "solicitudes", operation: "CREATE_HISTORICAL", dependencies: ["client"], date: "2026-09-03" }),
  ],
  expectedPay0Writes: 0, expectedIqWrites: 0, expectedExternalEffects: 0,
});
const request = { type: "MONTH_BLOCK", month: "2026-09", block: "01_10" };

test("selector version advanced with the member semantics", { skip: !available && "functions/lib not built" }, () => {
  assert.equal(scope.P4_SCOPE_SELECTOR_VERSION, "P4_SCOPE_V8_4");
});

test("a month block executes the client its invoice depends on, client first", { skip: !available && "functions/lib not built" }, () => {
  const built = scope.buildExecutionScope({ manifest: manifest("CREATE_HISTORICAL"), request });
  assert.deepEqual(built.members.map((row) => [row.actionId, row.role]), [["client", "CLIENT_DEPENDENCY"], ["invoice", "PRIMARY"]]);
  assert.deepEqual(built.externalDependencies, []);
  assert.deepEqual(built.excluded, []);
  assert.equal(built.expectedPay0Writes, 2);
});

test("an already written client leaves the scope and no longer blocks its invoice", { skip: !available && "functions/lib not built" }, () => {
  const built = scope.buildExecutionScope({ manifest: manifest("CREATE_HISTORICAL"), request, completedActionIds: new Set(["client"]) });
  assert.deepEqual(built.members.map((row) => row.actionId), ["invoice"]);
  assert.deepEqual(built.excluded, []);
});

test("a NO_OP client dependency counts as satisfied for the canary", { skip: !available && "functions/lib not built" }, () => {
  const current = manifest("NO_OP");
  const built = scope.buildExecutionScope({ manifest: current, request });
  assert.deepEqual(built.members.map((row) => row.actionId), ["invoice"]);
  assert.deepEqual(built.excluded.map((row) => `${row.actionId}:${row.reason}`), ["client:NO_CHANGE"]);
  assert.deepEqual(scope.scopeCanaryQueue(built, current, new Set()).map((row) => row.actionId), ["invoice"]);
});

test("a certified batch keeps its explicit membership", { skip: !available && "functions/lib not built" }, () => {
  assert.throws(() => scope.buildExecutionScope({ manifest: manifest("CREATE_HISTORICAL"), request: { type: "BATCH_B" } }), /P4_SCOPE_HISTORICAL_EVIDENCE_INCOMPLETE|Certified historical evidence/);
});
