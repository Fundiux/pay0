import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type P4ScopeRequest = {
  type: "MONTH_BLOCK";
  month: string;
  block: "01_10" | "11_20" | "21_END";
};

export type P4Budget = {
  maxActions: number;
  maxWrites: number;
  maxDurationMs: number;
  maxErrors: number;
  maxConcurrent: number;
  maxRetries: number;
};

export type P4ManifestSummary = {
  manifestId: string;
  manifestHash: string;
  status: string;
  version: number;
  createdAtMs: number;
  actionCount: number;
};

export type P4Scope = {
  scopeId: string;
  scopeHash: string;
  selectorVersion: string;
  manifestId: string;
  manifestHash: string;
  request: P4ScopeRequest;
  members: Array<{ actionId: string; entityType: string; operation: string; role: string }>;
  excluded: Array<{ reason: string }>;
  expectedPay0Writes: number;
  expectedIqWrites: number;
  expectedExternalEffects: number;
};

export type P4ScopePreview = {
  ok: boolean;
  scope: P4Scope;
  budget: P4Budget;
  selected: number;
  excluded: number;
  counts: Record<string, number>;
  readOnly: boolean;
};

type P4Reply = Record<string, unknown> & { ok: boolean; status?: string };

async function callP4<T>(data: Record<string, unknown>): Promise<T> {
  const callable = httpsCallable<Record<string, unknown>, T>(
    functions,
    "manageP4HistoricalIqImport",
    { timeout: 550_000 },
  );
  return (await callable(data)).data;
}

export const listP4Manifests = () =>
  callP4<{ manifests: P4ManifestSummary[] }>({ mode: "LIST_MANIFESTS" });

export const previewP4Scope = (manifest: P4ManifestSummary, scope: P4ScopeRequest, budget: P4Budget) =>
  callP4<P4ScopePreview>({
    mode: "PREVIEW_SCOPE",
    manifestId: manifest.manifestId,
    manifestHash: manifest.manifestHash,
    scope,
    budget,
  });

export const approveP4Scope = (preview: P4ScopePreview) =>
  callP4<P4Reply>({
    mode: "APPROVE_SCOPE",
    manifestId: preview.scope.manifestId,
    manifestHash: preview.scope.manifestHash,
    scope: preview.scope.request,
    scopeId: preview.scope.scopeId,
    scopeHash: preview.scope.scopeHash,
    selectorVersion: preview.scope.selectorVersion,
    budget: preview.budget,
    confirmation: `APPROVE_SCOPE:${preview.scope.manifestId}:${preview.scope.scopeId}:${preview.scope.scopeHash}`,
  });

export const runP4Scope = (preview: P4ScopePreview, mode: "EXECUTE_SCOPE" | "RESUME_SCOPE", executionMode: "CANARY" | "SCOPED_FULL", budget: P4Budget) =>
  callP4<P4Reply>({
    mode,
    manifestId: preview.scope.manifestId,
    manifestHash: preview.scope.manifestHash,
    scope: preview.scope.request,
    scopeId: preview.scope.scopeId,
    scopeHash: preview.scope.scopeHash,
    selectorVersion: preview.scope.selectorVersion,
    executionMode,
    budget,
  });

export const verifyP4Scope = (scopeId: string) =>
  callP4<P4Reply & { summary?: { completed: number; pending: number; failed: number }; scopeComplete?: boolean }>({
    mode: "VERIFY_SCOPE",
    scopeId,
  });
