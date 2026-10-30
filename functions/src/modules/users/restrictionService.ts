import { randomUUID } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { isCanonicalUserActive, normalizeCanonicalRole } from "./authorization";
import { DEFAULT_RESTRICTION_TTL_MS, MAX_RESTRICTION_TTL_MS, RESTRICTION_REASONS, REVOCATION_REASONS, TRUSTED_RESTRICTION_POLICY, TRUSTED_RESTRICTION_WRITER, TrustedRestriction, evaluateTrustedRestriction } from "./restrictions";

// Intentionally not exported from the deployed Functions entrypoint.
type Snapshot = { exists: boolean; data(): any };
type Reference = unknown;
export interface RestrictionDatabase {
  collection(name: string): { doc(id: string): Reference };
  runTransaction<T>(callback: (tx: {
    get(ref: Reference): Promise<Snapshot>;
    update(ref: Reference, data: Record<string, unknown>): unknown;
    create(ref: Reference, data: Record<string, unknown>): unknown;
  }) => Promise<T>): Promise<T>;
}
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const fail = (code: "invalid-argument" | "permission-denied" | "failed-precondition" | "aborted", message: string): never => { throw new HttpsError(code, message); };
const rootOf = (user: any, uid: string) => user?.rootId || uid;
function authenticatedUid(auth: any): string {
  if (!identifier(auth?.uid)) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  return auth.uid;
}
function recentAuthentication(auth: any, now: number) {
  const seconds = auth?.token?.auth_time;
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds * 1000 > now || now - seconds * 1000 > 300000) {
    fail("permission-denied", "Vuelve a autenticarte para realizar esta acción.");
  }
}
function cleanInput(raw: unknown, fields: string[]): Record<string, any> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("invalid-argument", "Solicitud inválida.");
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Object.keys(descriptors).some(key => !fields.includes(key) || !("value" in descriptors[key]))) return fail("invalid-argument", "Solicitud inválida.");
  return raw as Record<string, any>;
}

export function createRestrictionService(db: RestrictionDatabase, now = () => Date.now(), newId = () => randomUUID()) {
  async function mutate(auth: any, raw: unknown, action: "ISSUE" | "REVOKE") {
    const actorUid = authenticatedUid(auth);
    const input = cleanInput(raw, action === "ISSUE" ? ["subjectUid", "reasonCode", "incidentId", "ttlMs"] : ["subjectUid", "restrictionId", "authorizationVersion", "revocationReason"]);
    if (!identifier(input.subjectUid) || input.subjectUid === actorUid) fail("permission-denied", "No puedes modificar tu propia restricción.");
    if (action === "ISSUE") {
      if (!identifier(input.incidentId) || !RESTRICTION_REASONS.includes(input.reasonCode)) fail("invalid-argument", "Motivo o incidente inválido.");
      const ttl = input.ttlMs ?? DEFAULT_RESTRICTION_TTL_MS;
      if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > MAX_RESTRICTION_TTL_MS) fail("invalid-argument", "Vigencia inválida.");
    } else if (!identifier(input.restrictionId) || !Number.isSafeInteger(input.authorizationVersion) || input.authorizationVersion < 1 || !REVOCATION_REASONS.includes(input.revocationReason)) {
      fail("invalid-argument", "Referencia de recuperación inválida.");
    }
    const eventId = newId();
    if (!identifier(eventId)) throw new Error("Invalid server restriction identifier");
    const actorRef = db.collection("users").doc(actorUid);
    const targetRef = db.collection("users").doc(input.subjectUid);
    const auditRef = db.collection("trustedRestrictionAudit").doc(eventId);
    return db.runTransaction(async tx => {
      const instant = now();
      recentAuthentication(auth, instant);
      const actor = await tx.get(actorRef);
      const target = await tx.get(targetRef);
      const actorData = actor.exists ? actor.data() : null;
      assertAuthorized(auth, actorData, { allowedRoles: ["superadmin"] });
      const targetData = target.exists ? target.data() : null;
      const rootId = rootOf(actorData, actorUid);
      if (!identifier(rootId) || !targetData || !isCanonicalUserActive(targetData) || !normalizeCanonicalRole(targetData.role ?? targetData.supervisorRole) || rootOf(targetData, input.subjectUid) !== rootId) {
        fail("permission-denied", "No puedes modificar esta cuenta.");
      }
      const previous = evaluateTrustedRestriction(targetData, input.subjectUid, instant);
      const old: TrustedRestriction | undefined = targetData.trustedRestrictionV1;
      if (previous.state === "INVALID") fail("failed-precondition", "La cuenta requiere recuperación de soporte especializada.");
      if (old && old.authorizationVersion >= Number.MAX_SAFE_INTEGER) fail("failed-precondition", "Versión de autorización agotada.");
      let next: TrustedRestriction;
      if (action === "ISSUE") {
        if (previous.state === "ACTIVE") fail("failed-precondition", "Ya existe una restricción vigente.");
        next = {
          schemaVersion: 1, writer: TRUSTED_RESTRICTION_WRITER, policyVersion: TRUSTED_RESTRICTION_POLICY,
          restrictionId: eventId, rootId, subjectUid: input.subjectUid, state: "ACTIVE", scope: "ACCOUNT_OPERATIONS",
          authority: "HUMAN_SECURITY_ADMIN", authorityUid: actorUid, reasonCode: input.reasonCode, incidentId: input.incidentId,
          issuedAtMs: instant, expiresAtMs: instant + (input.ttlMs ?? DEFAULT_RESTRICTION_TTL_MS), authorizationVersion: (old?.authorizationVersion ?? 0) + 1,
        };
      } else {
        if (!old || old.restrictionId !== input.restrictionId || old.authorizationVersion !== input.authorizationVersion) return fail("aborted", "La restricción cambió; actualiza la información.");
        if (old.state === "REVOKED") fail("failed-precondition", "La restricción ya fue revocada.");
        next = { ...old, state: "REVOKED", revokedAtMs: instant, revokedBy: actorUid, revocationReason: input.revocationReason, authorizationVersion: old.authorizationVersion + 1 };
      }
      // Audit and restriction share one transaction; no detached log can fail open.
      tx.update(targetRef, { trustedRestrictionV1: next });
      tx.create(auditRef, { schemaVersion: 1, eventId, action, rootId, actorUid, subjectUid: input.subjectUid, restrictionId: next.restrictionId, previousAuthorizationVersion: old?.authorizationVersion ?? 0, authorizationVersion: next.authorizationVersion, occurredAtMs: instant, reasonCode: action === "ISSUE" ? next.reasonCode : next.revocationReason, incidentId: next.incidentId });
      return { restrictionId: next.restrictionId, authorizationVersion: next.authorizationVersion, state: next.state, expiresAtMs: next.expiresAtMs };
    });
  }
  return {
    issue: (auth: any, input: unknown) => mutate(auth, input, "ISSUE"),
    revoke: (auth: any, input: unknown) => mutate(auth, input, "REVOKE"),
    async getMyStatus(auth: any) {
      const uid = authenticatedUid(auth);
      return db.runTransaction(async tx => {
        const snapshot = await tx.get(db.collection("users").doc(uid));
        const user = snapshot.exists ? snapshot.data() : null;
        // Narrow exception: own state only, no financial read, mutation or bypass token.
        if (!user || !isCanonicalUserActive(user) || !normalizeCanonicalRole(user.role ?? user.supervisorRole)) fail("permission-denied", "No tienes acceso a esta cuenta.");
        const result = evaluateTrustedRestriction(user, uid, now());
        return { state: result.state, restricted: result.restricted, expiresAtMs: result.state === "INVALID" || result.state === "NONE" ? null : user.trustedRestrictionV1.expiresAtMs, recovery: "CONTACT_SUPPORT" as const };
      });
    },
  };
}
