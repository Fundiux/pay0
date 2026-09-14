import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { logActivity } from "../../utils/logActivity";
import { db, getActivityAdminId, getMyUser, requireAuth } from "../sharedCallables/helpers";

const clean = (value: unknown, max = 1000) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

async function actor(request: any) {
  const uid = requireAuth(request);
  const user = await getMyUser(uid);
  assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"] });
  return { uid, user, rootId: clean(user?.rootId || uid, 128) };
}

export const recordAgent007Observation = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const { uid, user, rootId } = await actor(request);
    const caseType = clean(request.data?.caseType, 40).toUpperCase();
    const caseId = clean(request.data?.caseId, 128);
    const intent = clean(request.data?.intent, 500);
    const humanDecision = clean(request.data?.humanDecision, 500);
    const outcome = clean(request.data?.outcome, 500);
    if (!caseType || !caseId || !intent || !humanDecision || !outcome) {
      throw new HttpsError("invalid-argument", "Caso, intención, decisión humana y resultado son obligatorios.");
    }
    const ref = db.collection("agent007Observations").doc();
    await ref.create({
      rootId, agentId: "AGENTE_007", phase: "OBSERVATION", caseType, caseId, intent, humanDecision, outcome,
      actorUid: uid, actorRole: String(getUserRole(user)), authorization: { role: String(getUserRole(user)), scope: "rootId", rootId },
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), expiresAt: null,
    });
    await logActivity({ event: "AGENTE_007_OBSERVACION", rootId, adminId: getActivityAdminId(user, uid, rootId), actorUid: uid, actorName: clean(user?.email || uid), actorRole: String(getUserRole(user)), referenceId: ref.id, referenceType: "agent007Observation", relatedEntityId: caseId, relatedEntityType: caseType, description: `Hugo registró observación supervisada: ${intent}` });
    return { ok: true, observationId: ref.id };
  }
);

export const listAgent007Observations = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const { rootId } = await actor(request);
    const snapshot = await db.collection("agent007Observations").where("rootId", "==", rootId).orderBy("createdAt", "desc").limit(50).get();
    return { ok: true, observations: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) };
  }
);
