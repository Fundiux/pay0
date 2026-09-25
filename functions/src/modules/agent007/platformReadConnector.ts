import { Firestore } from "firebase-admin/firestore";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { getEffectiveUserModules } from "../users/authorization";
import { resolveClientOperationalAccess } from "../clientDelegations/access";
import type { Pay0ToolResult } from "./pay0Connector";
import { HUGO_SYSTEM_CATALOG } from "./systemCatalog";
import { HUGO_READ_TOOLS } from "./hugoCore/toolRouter";

const normalize = (value: unknown) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
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
    const users = await this.db.collection("users").where("rootId", "==", this.identity.rootId).limit(200).get();
    const needle = normalize(query);
    const visible = users.docs.filter(doc => {
      const row: any = doc.data();
      if (!isUserVisibleToCaller(this.identity, doc.id, row)) return false;
      return true;
    });
    const values = (doc: any) => { const row = doc.data(); return [doc.id, row.displayName, row.nombreUsuario, row.email]; };
    const exact = visible.filter(doc => userQueryMatchLevel(needle, values(doc)) === "EXACT");
    const matches = exact.length ? exact : visible.filter(doc => userQueryMatchLevel(needle, values(doc)) === "UNIQUE_PREFIX");
    if (matches.length !== 1) return this.result("countClientsForUser", { matchStatus: matches.length ? "AMBIGUOUS" : "NOT_FOUND", matches: matches.map(doc => ({ uid: doc.id, displayName: doc.data().displayName || doc.data().nombreUsuario || null })) }, "user", matches.map(doc => doc.id));
    const target = matches[0], targetData: any = target.data(), targetRole = getUserRole(targetData);
    const candidates = await this.db.collection("clients").where("rootId", "==", this.identity.rootId).get();
    let count = 0;
    for (const client of candidates.docs) {
      const row: any = client.data();
      if (row.active === false) continue;
      const access = await resolveClientOperationalAccess({ uid: target.id, role: targetRole as any, rootId: this.identity.rootId, clientId: client.id, client: row });
      if (access.allowed && access.permissions.view === true) count++;
    }
    return this.result("countClientsForUser", { matchStatus: "EXACT", user: { uid: target.id, displayName: targetData.displayName || targetData.nombreUsuario || null }, clientCount: count }, "user", [target.id]);
  }
  async countClientsForCurrentUser() {
    assertAuthorized(this.auth, this.user, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "clientes", requiredAction: "view" });
    const candidates = await this.db.collection("clients").where("rootId", "==", this.identity.rootId).get();
    let count = 0;
    for (const client of candidates.docs) {
      const row: any = client.data();
      if (row.active === false) continue;
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
