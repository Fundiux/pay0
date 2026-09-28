import { Firestore } from "firebase-admin/firestore";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { getEffectiveUserModules } from "../users/authorization";
import { resolveClientOperationalAccess } from "../clientDelegations/access";
import type { Pay0ToolResult } from "./pay0Connector";
import { HUGO_SYSTEM_CATALOG } from "./systemCatalog";
import { HUGO_READ_TOOLS } from "./hugoCore/toolRouter";

const normalize = (value: unknown) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
const phonetic = (value: unknown) => normalize(value).replace(/[bv]/g, "b");
const currentUserAlias = (value: unknown) => /^(yo|mi usuario|mi cuenta|usuario actual|esta sesion)$/i.test(normalize(value));
export type CreatorPeriod = "ALL" | "TODAY" | "YESTERDAY" | "THIS_WEEK" | "PREVIOUS_WEEK" | "THIS_MONTH" | "PREVIOUS_MONTH";
export function mexicoCityPeriodRange(period: CreatorPeriod, now = new Date()) {
  if (period === "ALL") return {};
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value);
  const localMidnight = (year: number, month: number, day: number) => Date.UTC(year, month - 1, day, 6);
  const y = value("year"), m = value("month"), d = value("day");
  const today = new Date(Date.UTC(y, m - 1, d));
  let start = today, end = new Date(today.getTime() + 86_400_000);
  if (period === "YESTERDAY") { end = today; start = new Date(today.getTime() - 86_400_000); }
  if (period === "THIS_WEEK" || period === "PREVIOUS_WEEK") {
    const mondayOffset = (today.getUTCDay() + 6) % 7;
    const monday = new Date(today.getTime() - mondayOffset * 86_400_000);
    start = period === "THIS_WEEK" ? monday : new Date(monday.getTime() - 7 * 86_400_000);
    end = period === "THIS_WEEK" ? new Date(monday.getTime() + 7 * 86_400_000) : monday;
  }
  if (period === "THIS_MONTH" || period === "PREVIOUS_MONTH") {
    const first = new Date(Date.UTC(y, m - 1, 1));
    start = period === "THIS_MONTH" ? first : new Date(Date.UTC(y, m - 2, 1));
    end = period === "THIS_MONTH" ? new Date(Date.UTC(y, m, 1)) : first;
  }
  return { fromMs: localMidnight(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate()), toMs: localMidnight(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate()) };
}
export type UserReferenceCandidate = { id: string; displayName: string | null; values: unknown[] };
export function resolveUserReference(query: string, currentUid: string, candidates: UserReferenceCandidate[]) {
  if (currentUserAlias(query)) return { matchStatus: "CURRENT_USER" as const, ids: [currentUid] };
  const exact = candidates.filter(row => userQueryMatchLevel(query, row.values) === "EXACT");
  const prefix = candidates.filter(row => userQueryMatchLevel(query, row.values) === "UNIQUE_PREFIX");
  const phoneticMatches = candidates.filter(row => row.values.some(value => phonetic(value) === phonetic(query)));
  const matches = exact.length ? exact : prefix.length ? prefix : phoneticMatches;
  if (!exact.length && matches.length === 1 && matches[0].id === currentUid && phoneticMatches.includes(matches[0])) {
    return { matchStatus: "CONFIRM_CURRENT_USER" as const, ids: [], suggestedDisplayName: matches[0].displayName };
  }
  return matches.length === 1
    ? { matchStatus: "EXACT" as const, ids: [matches[0].id] }
    : { matchStatus: matches.length ? "AMBIGUOUS" as const : "NOT_FOUND" as const, ids: matches.map(row => row.id) };
}
export function userQueryMatchLevel(query: string, values: unknown[]) {
  const needle = normalize(query);
  const candidates = values.flatMap(value => { const normalized = normalize(value); return normalized ? [normalized, normalized.split("@")[0]] : []; });
  if (candidates.some(value => value === needle)) return "EXACT";
  if (needle.length >= 4 && candidates.some(value => Math.abs(value.length - needle.length) <= 2 && (value.startsWith(needle) || needle.startsWith(value)))) return "UNIQUE_PREFIX";
  return "NONE";
}
export function isUserVisibleToCaller(identity: { uid: string; rootId: string; role: "superadmin" | "admin" | "operador" }, targetId: string, target: any) {
  if (String(target?.rootId || "") !== identity.rootId) return false;
  if (identity.role === "superadmin") return true;
  if (identity.role === "admin") return targetId === identity.uid || String(target?.parentUserId || "") === identity.uid;
  return targetId === identity.uid;
}

export class PlatformReadConnector {
  constructor(private db: Firestore, private auth: any, private user: any, private identity: { uid: string; rootId: string; role: "superadmin" | "admin" | "operador" }) {}
  private result(tool: string, data: any, entityType: string, ids: string[] = []): Pay0ToolResult<any> {
    const retrievedAt = new Date().toISOString();
    return { sourceSystem: "PAY0", tool, retrievedAt, scope: { rootId: this.identity.rootId }, completeness: "COMPLETE",
      evidence: ids.map(entityId => ({ sourceSystem: "PAY0", sourceType: "FIRESTORE", entityType, entityId, retrievedAt, effectiveAt: null, scope: { rootId: this.identity.rootId }, completeness: "COMPLETE", kind: "FACT" })),
      data, trace: { traceId: `${this.identity.uid}:${Date.now()}`, actorUid: this.identity.uid, rootId: this.identity.rootId, tool, sourceSystem: "PAY0", requestedAt: retrievedAt, completedAt: retrievedAt, latencyMs: 0, evidenceIds: ids, completeness: "COMPLETE", result: "OK" } };
  }
  async getAuthorizedCapabilities() {
    const modules = getEffectiveUserModules(this.user);
    const capabilities = Object.entries(HUGO_READ_TOOLS).map(([id, spec]) => {
      const module = /Pago|Complement/.test(id) ? "pagos" : /Client/.test(id) ? "clientes" : /Authorized|System|Session|Diagnostic/.test(id) ? "hugo" : "solicitudes";
      const authorized = this.identity.role === "superadmin" || modules[module]?.view === true;
      return { id: `pay0.${id}`, system: spec.owner, kind: "DATA", risk: spec.sideEffect === "NONE" ? "READ" : "SIDE_EFFECT", registered: true, authorized, availability: authorized ? "REGISTERED" : "DENIED", health: "NOT_PROBED" };
    });
    return this.result("getAuthorizedCapabilities", { role: this.identity.role, modules, capabilities }, "authorization", [this.identity.uid]);
  }
  async getSystemCatalog() {
    const modules = getEffectiveUserModules(this.user);
    const systems = HUGO_SYSTEM_CATALOG.map(system => ({ id: system.id, status: system.status, allowed: this.identity.role === "superadmin" || modules[system.module]?.view === true }));
    return this.result("getSystemCatalog", systems, "systemCatalog");
  }
  async countClientsForUser(query: string) {
    assertAuthorized(this.auth, this.user, { allowedRoles: ["superadmin", "admin"], requiredModule: "usuarios", requiredAction: "view" });
    assertAuthorized(this.auth, this.user, { allowedRoles: ["superadmin", "admin"], requiredModule: "clientes", requiredAction: "view" });
    if (currentUserAlias(query)) return this.countClientsForCurrentUser();
    const users = await this.db.collection("users").where("rootId", "==", this.identity.rootId).limit(200).get();
    const visible = users.docs.filter(doc => {
      const row: any = doc.data();
      if (!isUserVisibleToCaller(this.identity, doc.id, row)) return false;
      return true;
    });
    const values = (doc: any) => { const row = doc.data(); return [doc.id, row.displayName, row.nombreUsuario, row.usernameNormalized, row.username, row.email]; };
    const resolution = resolveUserReference(query, this.identity.uid, visible.map(doc => ({ id: doc.id, displayName: doc.data().displayName || doc.data().nombreUsuario || null, values: values(doc) })));
    if (resolution.matchStatus === "CONFIRM_CURRENT_USER") return this.result("countClientsForUser", resolution, "user");
    const matches = visible.filter(doc => resolution.ids.includes(doc.id));
    if (matches.length !== 1) return this.result("countClientsForUser", { matchStatus: matches.length ? "AMBIGUOUS" : "NOT_FOUND", matches: matches.map(doc => ({ uid: doc.id, displayName: doc.data().displayName || doc.data().nombreUsuario || null })) }, "user", matches.map(doc => doc.id));
    const target = matches[0], targetData: any = target.data(), targetRole = getUserRole(targetData);
    const candidates = await this.db.collection("clients").where("rootId", "==", this.identity.rootId).get();
    let count = 0;
    for (const client of candidates.docs) {
      const row: any = client.data();
      if (row.active !== true) continue;
      const access = await resolveClientOperationalAccess({ uid: target.id, role: targetRole as any, rootId: this.identity.rootId, clientId: client.id, client: row });
      if (access.allowed && access.permissions.view === true) count++;
    }
    return this.result("countClientsForUser", { matchStatus: "EXACT", user: { uid: target.id, displayName: targetData.displayName || targetData.nombreUsuario || null }, clientCount: count }, "user", [target.id]);
  }
  private async resolveVisibleUser(query: string) {
    assertAuthorized(this.auth, this.user, { allowedRoles: ["superadmin", "admin"], requiredModule: "usuarios", requiredAction: "view" });
    const users = await this.db.collection("users").where("rootId", "==", this.identity.rootId).limit(200).get();
    const visible = users.docs.filter(doc => isUserVisibleToCaller(this.identity, doc.id, doc.data()));
    const resolution = resolveUserReference(query, this.identity.uid, visible.map(doc => { const row: any = doc.data(); return { id: doc.id, displayName: row.displayName || row.nombreUsuario || row.usernameNormalized || row.username || null, values: [doc.id, row.displayName, row.nombreUsuario, row.usernameNormalized, row.username, row.email] }; }));
    const resolvedIds: string[] = [...resolution.ids];
    const matches = visible.filter(doc => resolvedIds.includes(doc.id));
    return { resolution, target: matches.length === 1 ? matches[0] : null, matches };
  }
  async searchOperationsCreatedByUser(query: string, entity: "SOLICITUD" | "PAGO", range?: { fromMs?: number; toMs?: number; limit?: number }) {
    const tool = entity === "SOLICITUD" ? "getLatestSolicitudForUser" : "getLatestPagoForUser";
    const { resolution, target, matches } = await this.resolveVisibleUser(query);
    if (!target) return this.result(tool, { outcome: resolution.matchStatus, matchStatus: resolution.matchStatus, matches: matches.map(doc => ({ uid: doc.id, displayName: doc.data().displayName || doc.data().nombreUsuario || doc.data().usernameNormalized || null })), items: [], item: null }, "user", matches.map(doc => doc.id));
    const collection = entity === "SOLICITUD" ? "solicitudes" : "pagos";
    const snap = await this.db.collection(collection).where("rootId", "==", this.identity.rootId).get();
    const fromMs = Number.isFinite(range?.fromMs) ? Number(range?.fromMs) : Number.NEGATIVE_INFINITY;
    const toMs = Number.isFinite(range?.toMs) ? Number(range?.toMs) : Number.POSITIVE_INFINITY;
    const limit = Math.min(Math.max(Number(range?.limit) || 1, 1), 20);
    const rows = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)).filter(row => {
      const createdMs = row.createdAt?.toMillis?.() || row.reportDateAt?.toMillis?.() || 0;
      return String(row.createdBy || "") === target.id && createdMs >= fromMs && createdMs < toMs;
    })
      .sort((a, b) => (b.createdAt?.toMillis?.() || b.reportDateAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || a.reportDateAt?.toMillis?.() || 0));
    const targetData: any = target.data();
    const items = rows.slice(0, limit).map(item => ({
      id: item.id, folio: item.folio || null, cliente: item.clientName || item.clienteNombre || item.cliente || null,
      monto: Number(item.montoTotal ?? item.amount ?? item.monto ?? item.total ?? 0), estado: item.status || item.estatus || null,
      createdAt: item.createdAt?.toDate?.()?.toISOString?.() || item.reportDateAt?.toDate?.()?.toISOString?.() || null,
    }));
    return this.result(tool, { outcome: items.length ? "FOUND" : "NO_RESULTS_FOR_FILTER", matchStatus: "EXACT", creatorFilter: { uid: target.id }, user: { uid: target.id, displayName: targetData.displayName || targetData.nombreUsuario || targetData.usernameNormalized || null }, range: { fromMs: Number.isFinite(fromMs) ? fromMs : null, toMs: Number.isFinite(toMs) ? toMs : null }, items, item: items[0] || null }, entity.toLowerCase(), [target.id, ...items.map(item => item.id)]);
  }
  async getLatestOperationForUser(query: string, entity: "SOLICITUD" | "PAGO", period: CreatorPeriod = "ALL", limit = 1) {
    return this.searchOperationsCreatedByUser(query, entity, { ...mexicoCityPeriodRange(period), limit });
  }
  async countClientsForCurrentUser() {
    assertAuthorized(this.auth, this.user, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "clientes", requiredAction: "view" });
    const candidates = await this.db.collection("clients").where("rootId", "==", this.identity.rootId).get();
    let count = 0;
    for (const client of candidates.docs) {
      const row: any = client.data();
      if (row.active !== true) continue;
      const access = await resolveClientOperationalAccess({ uid: this.identity.uid, role: this.identity.role, rootId: this.identity.rootId, clientId: client.id, client: row });
      if (access.allowed && access.permissions.view === true) count++;
    }
    return this.result("countClientsForCurrentUser", { matchStatus: "CURRENT_USER", clientCount: count }, "authorization", [this.identity.uid]);
  }
  async getSessionContext() {
    const conversationId = `${this.identity.rootId}_${this.identity.uid}_global`;
    const snap = await this.db.collection("agent007Conversations").doc(conversationId).get();
    const row: any = snap.data();
    const owned = snap.exists && row?.rootId === this.identity.rootId && row?.ownerUid === this.identity.uid;
    const candidate = owned && row?.resumeContext && typeof row.resumeContext === "object" ? row.resumeContext : null;
    const updatedAtMs = candidate?.updatedAt ? Date.parse(String(candidate.updatedAt)) : NaN;
    const resume = candidate && Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs <= 30 * 60 * 1000 ? candidate : null;
    return this.result("getSessionContext", resume ? {
      activeSystem: resume.activeSystem || null, activeIntent: resume.activeIntent || null, language: resume.language || "es-MX",
      lastResolvedEntity: resume.lastResolvedEntity && typeof resume.lastResolvedEntity === "object" ? {
        system: resume.lastResolvedEntity.system || null, type: resume.lastResolvedEntity.type || null,
        safeId: resume.lastResolvedEntity.safeId || null, folio: resume.lastResolvedEntity.folio || null,
        operation: resume.lastResolvedEntity.operation || null,
      } : null,
    } : { activeSystem: null, activeIntent: null, language: "es-MX", lastResolvedEntity: null }, "sessionContext");
  }
  async getLastOperationDiagnostic() {
    const conversationId = `${this.identity.rootId}_${this.identity.uid}_global`;
    const snap = await this.db.collection("agent007Conversations").doc(conversationId).get();
    const row: any = snap.data();
    const diagnostic = snap.exists && row?.rootId === this.identity.rootId && row?.ownerUid === this.identity.uid && row?.lastOperationDiagnostic && typeof row.lastOperationDiagnostic === "object"
      ? row.lastOperationDiagnostic : null;
    return this.result("getLastOperationDiagnostic", diagnostic ? {
      system: diagnostic.system || null, intent: diagnostic.intent || null, capability: diagnostic.capability || null,
      status: diagnostic.status || null, errorCategory: diagnostic.errorCategory || null, errorCode: diagnostic.errorCode || null,
      retryable: diagnostic.retryable === true, authorization: diagnostic.authorization || null, connectorStatus: diagnostic.connectorStatus || null,
    } : null, "operationDiagnostic");
  }
}
