import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { db } from "../sharedCallables/helpers";
import { logActivityTx } from "../../utils/logActivity";
import { assertAuthorized } from "../../utils/authGuard";
import { context } from "./callables";
import { ENGINEERING_MODULES, engineeringCatalog } from "./engineeringCatalog";
import { normalizeEngineeringEvidence } from "./engineeringEvidence";

export const getControlCenterEngineering = onCall(
  { region: "us-central1", cors: true, timeoutSeconds: 30, memory: "256MiB" },
  async request => {
    await context(request, true);
    return { ok: true, ...engineeringCatalog() };
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
