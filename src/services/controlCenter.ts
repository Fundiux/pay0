import { httpsCallable } from "firebase/functions";

import { functions } from "@/lib/firebaseClient";
import { CALLABLES } from "@/lib/callableNames";

export type RecoveryReviewRow = { id: string; solicitudId: string; kind: string; status: "NEEDS_REVIEW"; attempts: number; lastErrorCode: string; acknowledged: boolean; acknowledgedBy: string | null; note: string | null };
export async function listOperationRecoveryReviews(cursor?: string) {
  return (await httpsCallable<{ cursor?: string }, { ok: boolean; rows: RecoveryReviewRow[]; truncated: boolean; nextCursor: string | null }>(functions, "listOperationRecoveryReviews")(cursor ? { cursor } : {})).data;
}
export async function acknowledgeOperationRecoveryReview(data: { jobId: string; note: string }) {
  return (await httpsCallable<typeof data, { ok: boolean; created: boolean; jobId: string }>(functions, "acknowledgeOperationRecoveryReview")(data)).data;
}

export type EngineeringCatalog = {
  assignees: Array<{ uid: string; name: string }>;
  assigneesTruncated: boolean;
  schemaVersion: number;
  coverage: "CURATED";
  modules: Array<{ id: string; name: string; responsibility: string; data: string[]; boundary: string; dependencies: string[]; checks: string[]; source: string; technicalOwner: string | null; independence: "SHARED_FIREBASE_RUNTIME" }>;
  release: { deployedVersion: string | null; certification: "UNKNOWN"; productionVerification: "UNKNOWN"; explanation: string };
  engineeringAgents: { environment: "CODEX"; names: string[]; explanation: string };
};

export async function getControlCenterEngineering() {
  return (await httpsCallable<Record<string, never>, EngineeringCatalog & { ok: boolean }>(functions, CALLABLES.getControlCenterEngineering)({})).data;
}

export type EngineeringRunEvidence = {
  sourceCommit: string; sourceTree: string; mainCommit: string; digest: string;
  mainOnly: number; candidateOnly: number; mainCompatibility: string;
  status: "validated-source-candidate" | "failed"; startedAt: string; finishedAt: string;
  checks: Array<{ name: string; status: "passed" | "failed" }>;
  sourceArchiveSha256: string | null; blockingFindings: Array<{ code: string; summary: string }>;
  provenance: "HUMAN_IMPORTED"; authenticity: "NOT_INDEPENDENTLY_VERIFIED";
  publication: "UNKNOWN"; productionVerification: "UNKNOWN"; importedBy: string;
  integration?: { candidateCommit: string; sourceTree: string; status: "candidate-only"; unavailableWorktreeCount: number;
    modules: Array<{ id: string; changedFiles: number; dependencies: string[] }>;
    worktrees: Array<{ branch: string; head: string; dirty: boolean; modules: string[]; overlapCount: number }> };
};

export async function importControlCenterEngineeringEvidence(data: { report: unknown; moduleId: string; observationId?: string }) {
  return (await httpsCallable<typeof data, { ok: boolean; id: string; created: boolean; digest: string }>(functions, CALLABLES.importControlCenterEngineeringEvidence)(data)).data;
}

export async function assignControlCenterEngineeringTask(data: { observationId: string; assigneeUid: string; requestId: string; note: string }) {
  return (await httpsCallable<typeof data, { ok: boolean; id: string; created: boolean }>(functions, CALLABLES.assignControlCenterEngineeringTask)(data)).data;
}

export type ControlAnalytics = {
  ok: boolean; from: string; to: string; timezone: string;
  totals: Record<string, number>; previous: Record<string, number>;
  daily: Array<{ day: string; metrics: Record<string, number> }>;
  current: Record<string, number>;
  coverage: { complete: boolean; source: number; processed: number; expensesComplete: boolean };
};
export type ControlEvidence = {
  rows: Array<{ id: string; source: string; entityId: string; revision: number; businessDate: string }>;
  incidents: Array<{ id: string; solicitudId: string; kind: string; status: string; lastErrorCode: string }>;
  facets: Array<{ dimension: string; value: string; label: string }>;
  incidentsTruncated: boolean; facetsTruncated: boolean;
};
export async function getControlCenterAnalytics(data: { from: string; to: string; dimension?: string; value?: string }) {
  return (await httpsCallable<typeof data, ControlAnalytics>(functions, CALLABLES.getControlCenterAnalytics)(data)).data;
}
export async function initializeControlCenterAnalytics() {
  return (await httpsCallable<{}, { ok: boolean; complete: boolean; source?: string; processed?: number }>(functions, CALLABLES.initializeControlCenterAnalytics)({})).data;
}
export async function getControlCenterEvidence() {
  return (await httpsCallable<{}, ControlEvidence>(functions, CALLABLES.getControlCenterEvidence)({})).data;
}
export async function recognizeControlCenterExpense(data: { uploadId: string; amountMinor: number; note: string; confirmed: boolean }) {
  return (await httpsCallable<typeof data, { ok: boolean; id: string }>(functions, CALLABLES.recognizeControlCenterExpense)(data)).data;
}
export async function reverseControlCenterExpense(data: { id: string; reason: string }) {
  return (await httpsCallable<typeof data, { ok: boolean }>(functions, CALLABLES.reverseControlCenterExpense)(data)).data;
}

export type ControlCenterHealth = {
  status: "HEALTHY" | "WARNING" | "CRITICAL" | "UNKNOWN";
  explanation: string;
  affectedCount: number;
};

export type ControlCenterSnapshot = {
  id?: string;
  version: number;
  coverage?: { complete: boolean; mode: string };
  summary: {
    solicitudesActive: number;
    pagosCount: number;
    pagosAmount: number;
    pendingPagosAmount: number;
    invoicesIssued: number;
    criticalAlerts: number;
  };
  pipeline: Array<{ key: string; label: string; count: number; href: string }>;
  health: Record<string, ControlCenterHealth>;
  alerts: Array<{ id: string; severity: string; module: string; title: string; explanation: string; affectedCount: number; href: string }>;
  daily: Record<string, { solicitudes: number; pagos: number; pagosAmount: number; facturas: number }>;
  refreshedAt?: { seconds?: number } | string | null;
};

export async function getControlCenterOverview() {
  const callable = httpsCallable<Record<string, never>, { ok: boolean; configured: boolean; snapshot: ControlCenterSnapshot | null }>(functions, CALLABLES.getControlCenterOverview);
  return (await callable({})).data;
}

export async function refreshControlCenterOverview() {
  const callable = httpsCallable<Record<string, never>, { ok: boolean; snapshot: ControlCenterSnapshot }>(functions, CALLABLES.refreshControlCenterOverview);
  return (await callable({})).data;
}
