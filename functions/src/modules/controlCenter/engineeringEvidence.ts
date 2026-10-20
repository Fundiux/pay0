import { createHash } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";

const invalid = () => new HttpsError("invalid-argument", "Evidencia de candidato inválida o incompleta.");
const hash = (value: unknown, length: number) => {
  if (typeof value !== "string" || !new RegExp(`^[a-f0-9]{${length}}$`).test(value)) throw invalid();
  return value;
};
const date = (value: unknown) => {
  if (typeof value !== "string" || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw invalid();
  return new Date(value).toISOString();
};

function normalizeIntegration(value: any, commit: string, tree: string) {
  if (value === undefined) return undefined;
  const ids = new Set(["access", "documents", "pagos", "engineering", "experience", "platform"]);
  const count = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= 1_000_000;
  const modules = (values: unknown) => {
    if (!Array.isArray(values) || values.length > ids.size || values.some(id => !ids.has(id)) || new Set(values).size !== values.length) throw invalid();
    return values as string[];
  };
  if (!value || value.status !== "candidate-only" || value.candidateCommit !== commit || value.sourceTree !== tree ||
      !Array.isArray(value.modules) || value.modules.length > ids.size || !Array.isArray(value.worktrees) || value.worktrees.length > 200) throw invalid();
  if (value.unavailableWorktreeCount !== undefined && !count(value.unavailableWorktreeCount)) throw invalid();
  const mapped = value.modules.map((row: any) => {
    if (!row || !ids.has(row.id) || !count(row.changedFiles)) throw invalid();
    return { id: row.id as string, changedFiles: row.changedFiles as number, dependencies: modules(row.dependencies) };
  });
  if (new Set(mapped.map((row: any) => row.id)).size !== mapped.length) throw invalid();
  const worktrees = value.worktrees.map((row: any) => {
    if (!row || typeof row.branch !== "string" || row.branch.length < 1 || row.branch.length > 200 ||
        /[\x00-\x1f\x7f]/.test(row.branch) || typeof row.dirty !== "boolean" || !count(row.overlapCount)) throw invalid();
    return { branch: row.branch as string, head: hash(row.head, 40), dirty: row.dirty as boolean,
      modules: modules(row.modules), overlapCount: row.overlapCount as number };
  });
  return { candidateCommit: commit, sourceTree: tree, status: "candidate-only" as const, modules: mapped, worktrees,
    unavailableWorktreeCount: (value.unavailableWorktreeCount ?? 0) as number };
}

/** Validates a human-imported local gate report. Does not attest that Git or CI ran. */
export function normalizeEngineeringEvidence(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input) || JSON.stringify(input).length > 64_000) throw invalid();
  const row = input as Record<string, any>;
  if (row.schemaVersion !== 1 || row.scope !== "committed-source-and-local-gates" ||
      !["validated-source-candidate", "failed"].includes(row.status) || row.productionExercised !== false ||
      row.productionCertified !== false || row.deploymentAuthorized !== false ||
      row.referenceFreshness !== "local-reference-no-fetch" ||
      !Number.isSafeInteger(row.mainOnly) || row.mainOnly < 0 || !Number.isSafeInteger(row.candidateOnly) || row.candidateOnly < 0 ||
      !Array.isArray(row.checks) || !row.checks.length || row.checks.length > 50) throw invalid();
  const compatibility = row.mainOnly === 0 ? "contains-main" : "diverged-not-integration-validated";
  if (row.mainCompatibility !== compatibility) throw invalid();
  const checks = row.checks.map((check: any) => {
    if (!check || typeof check.name !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(check.name) ||
        !["passed", "failed"].includes(check.status)) throw invalid();
    return { name: check.name as string, status: check.status as "passed" | "failed" };
  });
  if (new Set(checks.map(check => check.name)).size !== checks.length) throw invalid();
  if (row.status === "validated-source-candidate" && (!checks.every(check => check.status === "passed") ||
      !["authorization-policy", "functions-build", "frontend-build"].every(name => checks.some(check => check.name === name)))) throw invalid();
  const startedAt = date(row.startedAt), finishedAt = date(row.finishedAt);
  if (finishedAt < startedAt || Date.parse(finishedAt) > Date.now() + 300_000) throw invalid();
  if (!Array.isArray(row.blockingFindings) || row.blockingFindings.length > 50) throw invalid();
  const blockingFindings = row.blockingFindings.map((item: any) => {
    if (!item || typeof item.code !== "string" || !/^[A-Z0-9_-]{1,100}$/.test(item.code)) throw invalid();
    const summary = item.result || item.requiredAction || item.code;
    if (typeof summary !== "string" || summary.length > 1000) throw invalid();
    return { code: item.code as string, summary };
  });
  const report = {
    schemaVersion: 1 as const,
    sourceCommit: hash(row.sourceCommit, 40), sourceTree: hash(row.sourceTree, 40), mainCommit: hash(row.mainCommit, 40),
    mainOnly: row.mainOnly as number, candidateOnly: row.candidateOnly as number,
    mainCompatibility: compatibility, referenceFreshness: "local-reference-no-fetch" as const,
    status: row.status as "validated-source-candidate" | "failed", startedAt, finishedAt, checks,
    sourceArchiveSha256: row.status === "validated-source-candidate" ? hash(row.sourceArchiveSha256, 64) : null,
    blockingFindings,
    provenance: "HUMAN_IMPORTED" as const, authenticity: "NOT_INDEPENDENTLY_VERIFIED" as const,
    publication: "UNKNOWN" as const, productionVerification: "UNKNOWN" as const,
    ...(row.integration === undefined ? {} : { integration: normalizeIntegration(row.integration, row.sourceCommit, row.sourceTree) }),
  };
  return { report, digest: createHash("sha256").update(JSON.stringify(report)).digest("hex") };
}
