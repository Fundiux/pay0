import { Firestore } from "firebase-admin/firestore";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { getEffectiveUserModules } from "../users/authorization";
import { resolveClientOperationalAccess } from "../clientDelegations/access";
import type { Pay0ToolResult } from "./pay0Connector";
import { HUGO_SYSTEM_CATALOG } from "./systemCatalog";

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
    return this.result("getAuthorizedCapabilities", { role: this.identity.role, modules }, "authorization", [this.identity.uid]);
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
      const access = await resolveClientOperationalAccess({ uid: target.id, role: targetRole as any, rootId: this.identity.rootId, clientId: client.id, client: row });
      if (access.allowed && access.permissions.view === true && row.active !== false) count++;
    }
    return this.result("countClientsForUser", { matchStatus: "EXACT", user: { uid: target.id, displayName: targetData.displayName || targetData.nombreUsuario || null }, clientCount: count }, "user", [target.id]);
  }
}
