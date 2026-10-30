module.exports = function candidateFixture() {
  return {
    schemaVersion: 1, scope: "committed-source-and-local-gates", status: "validated-source-candidate",
    sourceCommit: "a".repeat(40), sourceTree: "b".repeat(40), mainCommit: "c".repeat(40),
    mainOnly: 0, candidateOnly: 2, mainCompatibility: "contains-main", referenceFreshness: "local-reference-no-fetch",
    startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:01:00.000Z",
    sourceArchiveSha256: "d".repeat(64), productionExercised: false, productionCertified: false, deploymentAuthorized: false,
    checks: ["frontend-dependencies", "functions-dependencies", "authorization-policy", "candidate-contract", "engineering-contract", "receipt-contract", "materiality-contract", "functions-lint", "functions-build", "frontend-build"].map(name => ({ name, status: "passed", command: ["synthetic-test-only"] })),
    blockingFindings: [{ code: "SYNTHETIC_PENDING_REVIEW", result: "Ejemplo sintético; no representa una ejecución real." }],
  };
};
