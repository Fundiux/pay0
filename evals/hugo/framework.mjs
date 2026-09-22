export const DOMAINS = ["CONVERSATION", "PAYMENTS", "SOLICITUDES", "IQ", "PAYMENT_COMPLEMENTS", "MEMORY", "AUTHORIZATION", "SAFETY_ACTION_POLICY"];
export const DIMENSIONS = ["FACTUAL_ACCURACY", "PROVENANCE", "TOOL_SELECTION", "UNKNOWN_HANDLING", "AUTHORIZATION", "ACTION_POLICY", "SIDE_EFFECT_SAFETY", "IDEMPOTENCY", "CONFIDENCE_CALIBRATION", "EXPLANATION_QUALITY"];
export const SEVERITIES = ["INFO", "MINOR", "MAJOR", "CRITICAL"];
export const BASELINE = Object.freeze({ id: "hugo-legacy-2026-09-22", model: "gemini-2.5-flash", promptVersion: "inline-agent007-callables", memoryVersion: "agent007-legacy", toolArchitecture: "direct-firestore-pay0", sourceCommit: "332df25" });

export function validateCase(row) {
  for (const field of ["id", "domain", "description", "userInput", "referenceTime", "identityScope", "toolFixtures", "memories", "expectedFacts", "expectedUnknowns", "expectedBehavior", "allowedActions", "forbiddenActions", "expectedTools", "riskLevel", "checks"]) {
    if (!(field in row)) throw Error(`${row.id || "case"}: missing ${field}`);
  }
  if (!DOMAINS.includes(row.domain)) throw Error(`${row.id}: invalid domain`);
  if (!SEVERITIES.includes(row.riskLevel)) throw Error(`${row.id}: invalid risk`);
  if (!row.identityScope.rootId || !row.identityScope.uid || !row.identityScope.role) throw Error(`${row.id}: incomplete identity`);
  if (!Array.isArray(row.checks) || !row.checks.length) throw Error(`${row.id}: no checks`);
  for (const check of row.checks) {
    if (!DIMENSIONS.includes(check.dimension) || !SEVERITIES.includes(check.severity)) throw Error(`${row.id}: invalid check`);
    if (!check.id || !check.assertion) throw Error(`${row.id}: incomplete check`);
  }
  return row;
}

// Observations are explicit evidence from a deterministic adapter, recorded model run,
// or human review. Missing observations remain UNEVALUATED, never a pass.
export function evaluate(cases, observations = {}) {
  const results = cases.map(validateCase).map(row => ({
    id: row.id, domain: row.domain, riskLevel: row.riskLevel,
    checks: row.checks.map(check => {
      const observed = observations[row.id]?.[check.id];
      return { ...check, status: observed === true ? "PASS" : observed === false ? "FAIL" : "UNEVALUATED" };
    }),
  }));
  const counts = { PASS: 0, FAIL: 0, UNEVALUATED: 0 };
  const byDomain = {};
  for (const result of results) {
    byDomain[result.domain] ||= { PASS: 0, FAIL: 0, UNEVALUATED: 0 };
    for (const check of result.checks) { counts[check.status]++; byDomain[result.domain][check.status]++; }
  }
  return { baseline: BASELINE, counts, byDomain, criticalFailures: results.flatMap(row => row.checks.filter(c => c.status === "FAIL" && c.severity === "CRITICAL").map(c => `${row.id}/${c.id}`)), results };
}

export function compare(before, after) {
  const previous = new Map(before.results.flatMap(r => r.checks.map(c => [`${r.id}/${c.id}`, c.status])));
  return after.results.flatMap(r => r.checks.map(c => ({ id: `${r.id}/${c.id}`, domain: r.domain, severity: c.severity, before: previous.get(`${r.id}/${c.id}`) || "UNEVALUATED", after: c.status })))
    .filter(r => r.before !== r.after)
    .map(r => ({ ...r, direction: r.after === "FAIL" && r.before === "PASS" ? "REGRESSION" : r.after === "PASS" && r.before === "FAIL" ? "IMPROVEMENT" : "COVERAGE_CHANGE" }));
}
