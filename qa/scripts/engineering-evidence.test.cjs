const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), { createRequire } = require("node:module");
const ts = require("typescript");
const fixture = require("./fixtures/engineering-candidate.cjs");
const source = fs.readFileSync(path.resolve(__dirname, "../../functions/src/modules/controlCenter/engineeringEvidence.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const exportsObject = {};
new Function("require", "exports", compiled)(createRequire(path.resolve(__dirname, "../../functions/package.json")), exportsObject);
const normalize = exportsObject.normalizeEngineeringEvidence;

test("normalizes candidate checks and stable digest, omitting raw commands and extraneous identity", () => {
  const input = fixture(); input.actorUid = "forged"; input.checks[0].command = ["sensitive-local-path"];
  const { report, digest } = normalize(input);
  assert.equal(report.provenance, "HUMAN_IMPORTED");
  assert.equal(report.authenticity, "NOT_INDEPENDENTLY_VERIFIED");
  assert.equal(report.publication, "UNKNOWN");
  assert.equal(report.productionVerification, "UNKNOWN");
  assert.ok(!JSON.stringify(report).includes("sensitive-local-path"));
  assert.ok(!JSON.stringify(report).includes("forged"));
  assert.equal(digest, normalize(fixture()).digest);
  const different = fixture(); different.sourceCommit = "e".repeat(40);
  assert.notEqual(digest, normalize(different).digest);
});

test("rejects malformed, oversized, contradictory and production-claim reports", () => {
  const mutations = [
    row => { row.sourceCommit = "HEAD"; }, row => { row.productionCertified = true; },
    row => { row.productionExercised = true; }, row => { row.deploymentAuthorized = true; },
    row => { row.mainOnly = 1; }, row => { row.checks[0].status = "failed"; },
    row => { row.checks.push(row.checks[0]); }, row => { row.checks = []; },
    row => { row.checks = row.checks.filter(check => check.name !== "frontend-build"); },
    row => { row.finishedAt = "2025-01-01T00:00:00Z"; },
    row => { row.finishedAt = "2999-01-01T00:00:00Z"; }, row => { row.sourceArchiveSha256 = null; },
    row => { row.unneeded = "x".repeat(64_001); }, row => { row.blockingFindings = [{ code: "bad code" }]; },
  ];
  for (const mutate of mutations) { const row = fixture(); mutate(row); assert.throws(() => normalize(row), error => error.code === "invalid-argument"); }
});

test("failed and diverged runs remain evidence, never a publication certificate", () => {
  const row = fixture(); row.status = "failed"; row.checks[0].status = "failed"; row.mainOnly = 2; row.mainCompatibility = "diverged-not-integration-validated";
  const result = normalize(row).report;
  assert.equal(result.status, "failed"); assert.equal(result.mainOnly, 2);
  assert.equal(result.sourceArchiveSha256, null); assert.equal(result.publication, "UNKNOWN");
});
