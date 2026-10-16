import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { db } from "../sharedCallables/helpers";
import { logActivityTx } from "../../utils/logActivity";
import { assertAuthorized } from "../../utils/authGuard";
import { context } from "./callables";
import { ENGINEERING_MODULES, engineeringCatalog } from "./engineeringCatalog";
import { normalizeEngineeringEvidence } from "./engineeringEvidence";

function assertEngineeringParticipant(uid: string, user: any, rootId: string) {
  assertAuthorized({ uid }, user, { allowedRoles: ["superadmin"], requiredModule: "reportes", requiredAction: "view" });
  if (String(user?.rootId || uid).trim() !== rootId || user?.modules?.reportes === false || user?.modules?.reportes?.view === false)
    throw new HttpsError("permission-denied", "El usuario no tiene acceso vigente al seguimiento de este ámbito.");
}
const participantName = (user: any) => String(user?.displayName || user?.name || user?.username || "Superadmin").trim().slice(0, 120);

export const getControlCenterEngineering = onCall(
  { region: "us-central1", cors: true, timeoutSeconds: 30, memory: "256MiB" },
  async request => {
    const { uid, rootId } = await context(request, true);
    const [actor, users] = await Promise.all([db.collection("users").doc(uid).get(), db.collection("users").where("rootId", "==", rootId).limit(101).get()]);
    assertEngineeringParticipant(uid, actor.data(), rootId);
    const rows = new Map([[actor.id, actor], ...users.docs.slice(0, 100).map(doc => [doc.id, doc] as const)]);
    const assignees: Array<{ uid: string; name: string }> = [];
    for (const [id, user] of rows) {
      try { assertEngineeringParticipant(id, user.data(), rootId); assignees.push({ uid: id, name: participantName(user.data()) }); }
      catch (error) { if ((error as { code?: string }).code !== "permission-denied") throw error; }
    }
    return { ok: true, ...engineeringCatalog(), assignees, assigneesTruncated: users.size > 100 };
  },
);

export const assignControlCenterEngineeringTask = onCall(
  { region: "us-central1", cors: true, timeoutSeconds: 30, memory: "256MiB" },
  async request => {
    const { uid, rootId } = await context(request, true);
    const { observationId, assigneeUid, requestId, note } = request.data || {};
    if (![observationId, assigneeUid].every(value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(value)) ||
        typeof requestId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requestId) ||
        typeof note !== "string" || !note.trim() || note.length > 500) throw new HttpsError("invalid-argument", "Selecciona incidencia, responsable y motivo de asignación.");
    const digest = createHash("sha256").update(JSON.stringify([observationId, assigneeUid, note.trim()])).digest("hex");
    const id = createHash("sha256").update(JSON.stringify([rootId, uid, requestId])).digest("hex");
    const ref = db.collection("agent007Observations").doc(`assignment-${id}`);
    return db.runTransaction(async tx => {
      const [actor, assignee, source, existing] = await Promise.all([
        tx.get(db.collection("users").doc(uid)), tx.get(db.collection("users").doc(assigneeUid)),
        tx.get(db.collection("agent007Observations").doc(observationId)), tx.get(ref),
      ]);
      assertEngineeringParticipant(uid, actor.data(), rootId);
      assertEngineeringParticipant(assigneeUid, assignee.data(), rootId);
      if (!source.exists || source.get("rootId") !== rootId || source.get("caseType") !== "ENGINEERING")
        throw new HttpsError("permission-denied", "La incidencia no pertenece a tu ámbito.");
      if (existing.exists) {
        if (existing.get("rootId") !== rootId || existing.get("actorUid") !== uid)
          throw new HttpsError("permission-denied", "La referencia existente no pertenece a este usuario.");
        if (existing.get("assignmentDigest") !== digest) throw new HttpsError("already-exists", "Este intento ya registró una asignación diferente.");
        return { ok: true, id: ref.id, created: false };
      }
      const caseId = source.get("caseId"), now = FieldValue.serverTimestamp();
      if (typeof caseId !== "string" || !caseId.trim() || typeof source.get("intent") !== "string")
        throw new HttpsError("failed-precondition", "La observación no contiene una referencia de caso válida.");
      tx.create(ref, { rootId, caseType: "ENGINEERING", caseId, phase: "OBSERVATION", source: "HUMAN_TASK_ASSIGNMENT",
        intent: source.get("intent"), humanDecision: note.trim(), outcome: "Responsable asignado", assignmentDigest: digest,
        engineeringAssignment: { assigneeUid, assigneeName: participantName(assignee.data()), assignedBy: uid, sourceObservationId: observationId },
        actorUid: uid, actorRole: "superadmin", createdAt: now, updatedAt: now, expiresAt: null });
      logActivityTx(tx, db, { event: "AGENTE_007_OBSERVACION", rootId, actorUid: uid, actorRole: "superadmin",
        referenceId: ref.id, referenceType: "agent007Observation", relatedEntityId: caseId, relatedEntityType: "ENGINEERING",
        description: `Responsable de ingeniería asignado: ${participantName(assignee.data())}.` });
      return { ok: true, id: ref.id, created: true };
    });
  },
);

export const importControlCenterEngineeringEvidence = onCall(
  { region: "us-central1", cors: true, timeoutSeconds: 30, memory: "256MiB" },
  async request => {
    // reportes has only a view action in the canonical policy. Mutations here
    // use the existing superadmin-only observation capability plus report access.
    const { uid, rootId } = await context(request, true);
    const { report, digest } = normalizeEngineeringEvidence(request.data?.report);
    const moduleId = request.data?.moduleId;
    if (!ENGINEERING_MODULES.some(module => module.id === moduleId)) throw new HttpsError("invalid-argument", "Selecciona un módulo del catálogo.");
    const linkedId = request.data?.observationId;
    if (linkedId != null && (typeof linkedId !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(linkedId))) throw new HttpsError("invalid-argument", "Referencia de seguimiento inválida.");
    // Binding the content, root and case makes network retries safe without merging unrelated tasks.
    const id = createHash("sha256").update(JSON.stringify([rootId, moduleId, linkedId || null, digest])).digest("hex");
    const ref = db.collection("agent007Observations").doc(`engineering-${id}`);
    return db.runTransaction(async tx => {
      const actor = (await tx.get(db.collection("users").doc(uid))).data();
      assertAuthorized(request.auth, actor, { allowedRoles: ["superadmin"], requiredModule: "reportes", requiredAction: "view" });
      if (String(actor?.rootId || uid).trim() !== rootId) throw new HttpsError("permission-denied", "Tu ámbito cambió durante la importación.");
      const linked = linkedId ? await tx.get(db.collection("agent007Observations").doc(linkedId)) : null;
      if (linked && (!linked.exists || linked.get("rootId") !== rootId || linked.get("caseType") !== "ENGINEERING" ||
          !String(linked.get("caseId")).startsWith(`${moduleId}:`))) throw new HttpsError("permission-denied", "Seguimiento fuera del módulo o de tu ámbito.");
      const existing = await tx.get(ref);
      if (existing.exists) return { ok: true, id: ref.id, created: false, digest };
      const caseId = linked?.get("caseId") || `${moduleId}:candidate:${report.sourceCommit}`;
      const now = FieldValue.serverTimestamp();
      tx.create(ref, { rootId, caseType: "ENGINEERING", caseId, phase: "OBSERVATION", source: "HUMAN_IMPORTED_RELEASE_EVIDENCE",
        intent: `Evidencia de candidato ${report.sourceCommit.slice(0, 12)}`,
        humanDecision: "Importación humana de un reporte local; autenticidad y ejecución no verificadas por el servidor.",
        outcome: report.status === "validated-source-candidate" ? "Candidato con controles reportados" : "Controles reportados con fallo",
        actorUid: uid, actorRole: "superadmin", authorization: { role: "superadmin", scope: "rootId", rootId },
        engineeringEvidence: { ...report, digest, importedBy: uid, linkedObservationId: linkedId || null },
        createdAt: now, updatedAt: now, expiresAt: null });
      logActivityTx(tx, db, { event: "AGENTE_007_OBSERVACION", rootId, actorUid: uid, actorRole: "superadmin",
        referenceId: ref.id, referenceType: "agent007Observation", relatedEntityId: caseId, relatedEntityType: "ENGINEERING",
        description: `Superadmin importó evidencia de candidato ${report.sourceCommit.slice(0, 12)}; publicación no verificada.` });
      return { ok: true, id: ref.id, created: true, digest };
    });
  },
);
