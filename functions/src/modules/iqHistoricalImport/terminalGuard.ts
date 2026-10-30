import { loadIqCanonicalProfileById, openIqCanonicalSession } from "../iq/iqCanonicalAccess";
import { fetchIq } from "../iq/iqHttpClient";
import type { P4Action, P4Manifest } from "./domain";

export type P4TerminalDecision = "ALLOW_EXECUTE" | "SKIPPED_TERMINAL" | "BLOCKED_TERMINAL_DEPENDENCY" | "BLOCKED_TERMINAL_CONFLICT" | "BLOCKED_TERMINAL_UNAVAILABLE";
export type P4NormalizedState = "ACTIVE" | "TERMINAL" | "UNKNOWN" | "NOT_APPLICABLE";
export type P4CurrentStateEvidence = { source: "IQ" | "PAY0"; rawStatus: string; normalizedStatus: string; state: P4NormalizedState; found: boolean };
export type P4TerminalGuardResult = {
  decision: P4TerminalDecision; reason: string; checkedAt: string;
  iq: P4CurrentStateEvidence; pay0: P4CurrentStateEvidence;
  componentId: string | null; affectedDependencies: string[];
};

const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const upper = (value: unknown) => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[ -]+/g, "_");
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rows = (payload: unknown): Record<string, unknown>[] => {
  if (Array.isArray(payload)) return payload.filter(row => row && typeof row === "object") as Record<string, unknown>[];
  const row = object(payload);
  for (const key of ["data", "items", "results", "records", "clients", "invoices", "deposits", "payment_applications", "applications"])
    if (Array.isArray(row[key])) return row[key] as Record<string, unknown>[];
  for (const key of ["data", "client", "invoice", "deposit", "payment_application", "application"])
    if (row[key] && typeof row[key] === "object" && !Array.isArray(row[key])) return [row[key] as Record<string, unknown>];
  return Object.keys(row).length ? [row] : [];
};
const rowId = (row: Record<string, unknown>) => text(row.id ?? row.iq_id ?? row.folio);

const STATUS_FIELDS: Record<P4Action["entityType"], string[]> = {
  CLIENT: ["status", "estado", "operation_status"],
  SOLICITUD: ["operation_status", "status", "estado", "conciliation_status"],
  PAYMENT: ["operation_status", "status", "estado", "conciliation_status"],
  APPLICATION: ["operation_status", "status", "estado", "conciliation_status"],
};

const HISTORICAL_TERMINAL: Record<P4Action["entityType"], Set<string>> = {
  CLIENT: new Set(), // Inactive/archived clients can still own valid history.
  SOLICITUD: new Set(["RECHAZADA", "RECHAZADO", "CANCELADA", "CANCELADO", "ELIMINADA", "ELIMINADO", "REJECTED", "CANCELLED", "DELETED"]),
  PAYMENT: new Set(["RECHAZADA", "RECHAZADO", "CANCELADA", "CANCELADO", "ELIMINADA", "ELIMINADO", "REJECTED", "CANCELLED", "DELETED", "VOIDED"]),
  APPLICATION: new Set(["RECHAZADA", "RECHAZADO", "CANCELADA", "CANCELADO", "ELIMINADA", "ELIMINADO", "REJECTED", "CANCELLED", "DELETED", "VOIDED", "REVERSED"]),
};

const KNOWN_ACTIVE = new Set(["ACTIVE", "ACTIVA", "ACTIVO", "EN_OPERACION", "PROCESANDO", "PENDIENTE", "CONCILIADO", "CONCILIADA", "COMPLETADA", "COMPLETADO", "APLICADO", "APLICADA", "APLICADO_PARCIAL", "APLICADO_TOTAL"]);

export function normalizeHistoricalState(entityType: P4Action["entityType"], value: unknown): P4CurrentStateEvidence {
  const rawStatus = text(value), normalizedStatus = upper(value);
  if (entityType === "CLIENT") return { source: "IQ", rawStatus, normalizedStatus, state: "ACTIVE", found: true };
  if (HISTORICAL_TERMINAL[entityType].has(normalizedStatus)) return { source: "IQ", rawStatus, normalizedStatus, state: "TERMINAL", found: true };
  // OMITTED is an automation disposition, not proof that the historical entity is invalid.
  if (normalizedStatus === "OMITTED" || normalizedStatus === "OMITIDO" || !normalizedStatus) return { source: "IQ", rawStatus, normalizedStatus, state: "UNKNOWN", found: true };
  if (KNOWN_ACTIVE.has(normalizedStatus)) return { source: "IQ", rawStatus, normalizedStatus, state: "ACTIVE", found: true };
  return { source: "IQ", rawStatus, normalizedStatus, state: "UNKNOWN", found: true };
}

function statusFromRow(entityType: P4Action["entityType"], row: Record<string, unknown>): unknown {
  for (const field of STATUS_FIELDS[entityType]) if (text(row[field])) return row[field];
  return "";
}

export function hasActiveFinancialDependency(manifest: P4Manifest, action: P4Action): { active: boolean; actionIds: string[] } {
  if (!action.componentId || action.entityType === "CLIENT") return { active: false, actionIds: [] };
  const component = manifest.actions.filter(candidate => candidate.componentId === action.componentId);
  const activeApplications = component.filter(candidate => candidate.entityType === "APPLICATION" && candidate.actionId !== action.actionId &&
    ["ACTIVE", "CONCILIADO", "EN_OPERACION"].includes(upper(candidate.after.status)) &&
    !["REVIEW_REQUIRED", "CLIENT_REVIEW_REQUIRED", "FINANCIAL_RECONCILIATION_REVIEW", "HISTORICAL_DATE_REVIEW_REQUIRED"].includes(candidate.operation));
  return { active: activeApplications.length > 0, actionIds: activeApplications.map(candidate => candidate.actionId).sort() };
}

export function evaluateHistoricalExecutionGuard(input: { action: P4Action; manifest: P4Manifest; iq: P4CurrentStateEvidence; pay0: P4CurrentStateEvidence; checkedAt?: string }): P4TerminalGuardResult {
  const checkedAt = input.checkedAt || new Date().toISOString();
  const dependency = hasActiveFinancialDependency(input.manifest, input.action);
  const base = { checkedAt, iq: input.iq, pay0: input.pay0, componentId: input.action.componentId || null, affectedDependencies: dependency.actionIds };
  if (!input.iq.found) return { ...base, decision: "BLOCKED_TERMINAL_UNAVAILABLE", reason: "IQ_ENTITY_NOT_FOUND" };
  if (input.iq.state === "UNKNOWN") return { ...base, decision: "BLOCKED_TERMINAL_UNAVAILABLE", reason: "IQ_STATE_UNKNOWN" };
  if (input.pay0.found && input.pay0.state !== "NOT_APPLICABLE" && input.pay0.state !== "UNKNOWN" && input.iq.state !== input.pay0.state)
    return { ...base, decision: "BLOCKED_TERMINAL_CONFLICT", reason: "IQ_PAY0_STATE_CONFLICT" };
  if (input.iq.state !== "TERMINAL") return { ...base, decision: "ALLOW_EXECUTE", reason: "CURRENT_STATE_NON_TERMINAL" };
  if (dependency.active) return { ...base, decision: "BLOCKED_TERMINAL_DEPENDENCY", reason: "TERMINAL_PARENT_HAS_ACTIVE_APPLICATION" };
  return { ...base, decision: "SKIPPED_TERMINAL", reason: "CURRENT_STATE_TERMINAL_WITHOUT_ACTIVE_FINANCIAL_DEPENDENCY" };
}

export function pay0StateEvidence(action: P4Action, row: Record<string, unknown> | null): P4CurrentStateEvidence {
  if (!row) return { source: "PAY0", rawStatus: "", normalizedStatus: "", state: "NOT_APPLICABLE", found: false };
  const state = normalizeHistoricalState(action.entityType, statusFromRow(action.entityType, row));
  return { ...state, source: "PAY0", found: true };
}

export class P4CurrentStateReader {
  private sessions = new Map<string, Promise<{ apiOrigin: string; accessToken: string }>>();
  private cache = new Map<string, Promise<P4CurrentStateEvidence>>();
  public metrics = { currentStateReads: 0, iqCurrentStateReads: 0, pay0CurrentStateReads: 0, terminalAllowed: 0, terminalSkipped: 0, terminalReviews: 0, terminalConflicts: 0, terminalGuardUnavailable: 0, executionLocalCacheHits: 0 };
  constructor(private readonly rootId: string, private readonly secret: string) {}
  private session(profileId: string) {
    if (!this.sessions.has(profileId)) this.sessions.set(profileId, (async () => {
      const access = await loadIqCanonicalProfileById({ profileId, rootId: this.rootId, encryptionSecret: this.secret });
      const session = await openIqCanonicalSession({ access, requiredPermissions: "NONE" });
      return { apiOrigin: session.apiOrigin, accessToken: session.accessToken };
    })());
    return this.sessions.get(profileId)!;
  }
  async readIq(action: P4Action): Promise<P4CurrentStateEvidence> {
    const key = `${action.canonicalIqProfileId}:${action.entityType}:${action.iqEntityId}`;
    if (this.cache.has(key)) { this.metrics.executionLocalCacheHits++; return this.cache.get(key)!; }
    const pending: Promise<P4CurrentStateEvidence> = (async () => {
      const endpoint = ({ CLIENT: "/clients", SOLICITUD: "/invoices", PAYMENT: "/deposits", APPLICATION: "/payment_applications" } as const)[action.entityType];
      const profileIds = [...new Set([...(action.observedThroughProfileIds || []), action.canonicalIqProfileId].filter(Boolean))];
      const found: P4CurrentStateEvidence[] = [];
      for (const profileId of profileIds) {
        const session = await this.session(profileId);
        const urls = [new URL(endpoint, session.apiOrigin), new URL(`${endpoint}/${encodeURIComponent(action.iqEntityId)}`, session.apiOrigin)];
        urls[0].searchParams.set("id", action.iqEntityId); urls[0].searchParams.set("limit", "2");
        for (const url of urls) {
          this.metrics.currentStateReads++; this.metrics.iqCurrentStateReads++;
          const response = await fetchIq(url, { method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${session.accessToken}` } }, { operation: `p4l-current-${action.entityType.toLowerCase()}` });
          if (response.status === 404) continue;
          if (!response.ok) throw Object.assign(new Error(`IQ current-state read failed ${response.status}`), { code: "P4_TERMINAL_GUARD_UNAVAILABLE" });
          const exact = rows(await response.json()).filter(row => rowId(row) === action.iqEntityId);
          if (exact.length === 1) { found.push(normalizeHistoricalState(action.entityType, statusFromRow(action.entityType, exact[0]))); break; }
          if (exact.length > 1) return { source: "IQ", rawStatus: "", normalizedStatus: "", state: "UNKNOWN", found: false };
        }
      }
      if (!found.length) return { source: "IQ", rawStatus: "", normalizedStatus: "", state: "UNKNOWN", found: false };
      const states = new Set(found.map(row => `${row.state}:${row.normalizedStatus}`));
      if (states.size !== 1) return { source: "IQ", rawStatus: found.map(row => row.rawStatus).join(" | "), normalizedStatus: "PROFILE_CONFLICT", state: "UNKNOWN", found: true };
      return found[0];
    })();
    this.cache.set(key, pending);
    try { return await pending; } catch (error) { this.cache.delete(key); throw error; }
  }
  count(decision: P4TerminalDecision) {
    if (decision === "ALLOW_EXECUTE") this.metrics.terminalAllowed++;
    else if (decision === "SKIPPED_TERMINAL") this.metrics.terminalSkipped++;
    else if (decision === "BLOCKED_TERMINAL_CONFLICT") { this.metrics.terminalConflicts++; this.metrics.terminalReviews++; }
    else if (decision === "BLOCKED_TERMINAL_UNAVAILABLE") this.metrics.terminalGuardUnavailable++;
    else this.metrics.terminalReviews++;
  }
}
