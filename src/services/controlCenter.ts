import { httpsCallable } from "firebase/functions";

import { functions } from "@/lib/firebaseClient";
import { CALLABLES } from "@/lib/callableNames";

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
