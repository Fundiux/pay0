import test from "node:test";
import assert from "node:assert/strict";
import { cases } from "./cases.mjs";
import { compare, evaluate } from "./framework.mjs";
import { partialLegacySample, validateToolResult } from "./contracts.mjs";

test("all required domains and initial scenarios are represented", () => {
  assert.equal(cases.length, 15);
  assert.equal(new Set(cases.map(c => c.id)).size, cases.length);
  assert.equal(new Set(cases.map(c => c.domain)).size, 8);
});
test("missing model observations stay unevaluated and legacy read side effect fails", () => {
  const report = evaluate(cases, { "read-reconciles": { primary: false } });
  assert.deepEqual(report.counts, { PASS: 0, FAIL: 1, UNEVALUATED: 14 });
  assert.deepEqual(report.criticalFailures, []);
});
test("regressions and critical failures cannot hide in a mean", () => {
  const before = evaluate(cases, { "root-isolation": { primary: true } });
  const after = evaluate(cases, { "root-isolation": { primary: false } });
  assert.deepEqual(after.criticalFailures, ["root-isolation/primary"]);
  assert.equal(compare(before, after)[0].direction, "REGRESSION");
});
test("legacy sample is partial and cross-root evidence is rejected", () => {
  const result = partialLegacySample({ entityType: "pagos", rootId: "root-a", rows: [{ id: "synthetic-pago" }], retrievedAt: "2026-09-22T12:00:00Z" });
  assert.equal(result.evidence[0].completeness, "PARTIAL");
  assert.throws(() => validateToolResult(result, { rootId: "root-b" }), /Cross-root/);
  assert.throws(() => validateToolResult({ ...result, effects: ["WRITE"] }, { rootId: "root-a" }), /Query/);
});
