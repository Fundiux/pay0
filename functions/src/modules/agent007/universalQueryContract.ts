import { createHash } from "node:crypto";

export const HUGO_UNIVERSAL_QUERY_VERSION = "hugo-query-v1" as const;
export const HUGO_SNAPSHOT_VERSION = "hugo-snapshot-v1" as const;

export type HugoQueryDomain = string;
export type HugoOutputFormat = "PDF" | "XLSX" | "CSV" | "JSON" | "DASHBOARD";
export type HugoQueryFilter = { field: string; operator: "EQ" | "IN" | "GT" | "GTE" | "LT" | "LTE" | "BETWEEN"; value: unknown };
export type HugoUniversalQuery = {
  schemaVersion: typeof HUGO_UNIVERSAL_QUERY_VERSION;
  domain: HugoQueryDomain;
  source: string;
  operation: "LIST" | "SUMMARY" | "COMPARE" | "AGGREGATE";
  filters: HugoQueryFilter[];
  columns: string[];
  groupBy: string[];
  orderBy: Array<{ field: string; direction: "ASC" | "DESC" }>;
  limit: number;
};
export type HugoAuthorizationBinding = { actorRef: string; rootRef: string; policyVersion: string; capabilities: string[] };
export type HugoSnapshot<T = unknown> = {
  schemaVersion: typeof HUGO_SNAPSHOT_VERSION;
  snapshotId: string;
  queryDigest: string;
  authorizationDigest: string;
  ownerActorRef: string;
  ownerRootRef: string;
  domain: string;
  source: string;
  sourceVersion: string;
  status: "READY" | "EXPIRED" | "FAILED";
  createdAt: string;
  expiresAt: string;
  rows: readonly T[];
  aggregates: Readonly<Record<string, number | string | null>>;
};
export type HugoAnalyticKind = "COMPARISON" | "TREND" | "KPI" | "RANKING" | "STATISTIC" | "INSIGHT" | "ANOMALY" | "SUMMARY";
export type HugoAnalyticResult<T = unknown> = {
  schemaVersion: "hugo-analytic-v1";
  snapshotId: string;
  kind: HugoAnalyticKind;
  result: Readonly<T>;
};
export type HugoRenderRequest = { snapshotId: string; format: HugoOutputFormat; templateId: string | null; options: Readonly<Record<string, string | number | boolean>> };
export type HugoDeliveryRequest = { snapshotId: string; artifactId: string; channel: "DOWNLOAD" | "EMAIL" | "WHATSAPP"; recipientRef: string | null };
export type HugoQueryJob = { jobId: string; ownerActorRef: string; ownerRootRef: string; queryDigest: string; status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED"; progress: number; snapshotId: string | null; createdAt: string; updatedAt: string };
export type HugoScheduledReportDraft = {
  schemaVersion: "hugo-schedule-draft-v1";
  ownerActorRef: string;
  ownerRootRef: string;
  query: HugoUniversalQuery;
  render: HugoRenderRequest;
  enabled: false;
  schedule: null;
};

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
};
const digest = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");

export function validateUniversalQuery(input: HugoUniversalQuery) {
  if (input?.schemaVersion !== HUGO_UNIVERSAL_QUERY_VERSION) throw Error("HUGO_QUERY_VERSION_INVALID");
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(input.domain) || !/^[A-Za-z][A-Za-z0-9_.-]{1,127}$/.test(input.source)) throw Error("HUGO_QUERY_SOURCE_INVALID");
  if (!["LIST", "SUMMARY", "COMPARE", "AGGREGATE"].includes(input.operation)) throw Error("HUGO_QUERY_OPERATION_INVALID");
  if (!Array.isArray(input.filters) || input.filters.length > 30 || !Array.isArray(input.columns) || input.columns.length > 100 || !Array.isArray(input.groupBy) || input.groupBy.length > 20 || !Array.isArray(input.orderBy) || input.orderBy.length > 10) throw Error("HUGO_QUERY_SHAPE_INVALID");
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 10_000) throw Error("HUGO_QUERY_LIMIT_INVALID");
  return Object.freeze({ ...input, filters: Object.freeze([...input.filters]), columns: Object.freeze([...input.columns]), groupBy: Object.freeze([...input.groupBy]), orderBy: Object.freeze([...input.orderBy]) });
}

export const queryDigest = (query: HugoUniversalQuery) => digest(validateUniversalQuery(query));
export const authorizationDigest = (binding: HugoAuthorizationBinding) => digest({ ...binding, capabilities: [...binding.capabilities].sort() });

export function canReuseSnapshot(snapshot: HugoSnapshot, query: HugoUniversalQuery, binding: HugoAuthorizationBinding, now = Date.now()) {
  return snapshot.status === "READY" && Date.parse(snapshot.expiresAt) > now && snapshot.ownerActorRef === binding.actorRef && snapshot.ownerRootRef === binding.rootRef && snapshot.queryDigest === queryDigest(query) && snapshot.authorizationDigest === authorizationDigest(binding);
}

export function assertSnapshotOwner(snapshot: HugoSnapshot, binding: HugoAuthorizationBinding) {
  if (snapshot.ownerActorRef !== binding.actorRef || snapshot.ownerRootRef !== binding.rootRef || snapshot.authorizationDigest !== authorizationDigest(binding)) throw Error("HUGO_SNAPSHOT_FORBIDDEN");
  return true;
}

const jobTransitions: Record<HugoQueryJob["status"], HugoQueryJob["status"][]> = { QUEUED: ["RUNNING", "CANCELLED"], RUNNING: ["COMPLETED", "FAILED", "CANCELLED"], COMPLETED: [], FAILED: [], CANCELLED: [] };
export function transitionQueryJob(job: HugoQueryJob, status: HugoQueryJob["status"], progress: number, snapshotId: string | null, updatedAt: string): HugoQueryJob {
  if (!jobTransitions[job.status].includes(status)) throw Error("HUGO_JOB_TRANSITION_INVALID");
  if (!Number.isFinite(progress) || progress < job.progress || progress < 0 || progress > 100) throw Error("HUGO_JOB_PROGRESS_INVALID");
  if (status === "COMPLETED" && (!snapshotId || progress !== 100)) throw Error("HUGO_JOB_COMPLETION_INVALID");
  return Object.freeze({ ...job, status, progress, snapshotId, updatedAt });
}
