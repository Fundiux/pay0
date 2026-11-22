import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { logActivityBatch } from "../../utils/logActivity";
import { db, getMyUser, requireAuth } from "../sharedCallables/helpers";
import { listFacturamaReps, publicRep, repsToCancel } from "./repCancellation";

const clean = (value: unknown, max = 128) => String(value ?? "").trim().slice(0, max);

async function actor(request: any) {
  const uid = requireAuth(request);
  const user = await getMyUser(uid);
  assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"] });
  return { uid, rootId: clean(user?.rootId || uid) };
}

async function ownSolicitud(rootId: string, solicitudId: string) {
  if (!solicitudId || solicitudId.includes("/")) throw new HttpsError("invalid-argument", "Solicitud requerida.");
  const snap = await db.doc(`solicitudes/${solicitudId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Solicitud no encontrada.");
  if (clean(snap.data()?.rootId) !== rootId) throw new HttpsError("permission-denied", "Solicitud fuera de alcance.");
  return snap;
}

// Read-only: the live complements that cancelling this invoice would cancel first. The screen shows them in its warning.
export const getRepCancellationImpact = onCall({ region: "us-central1", timeoutSeconds: 30, memory: "256MiB" }, async request => {
  const { rootId } = await actor(request);
  const snap = await ownSolicitud(rootId, clean(request.data?.solicitudId));
  const reps = repsToCancel(await listFacturamaReps(db, rootId, snap.id));
  return { ok: true, reps: reps.map(publicRep) };
});

// The owner's manual confirmation that the complements are cancelled together with the invoice. The server checks it
// before it cancels the complements, so a direct call cannot skip the warning.
export const confirmRepCancellation = onCall({ region: "us-central1", timeoutSeconds: 30, memory: "256MiB" }, async request => {
  const { uid, rootId } = await actor(request);
  const snap = await ownSolicitud(rootId, clean(request.data?.solicitudId));
  const reps = repsToCancel(await listFacturamaReps(db, rootId, snap.id));
  if (!reps.length) return { ok: true, reps: 0 };
  const batch = db.batch();
  batch.set(snap.ref, { repCancellationConfirmedAt: FieldValue.serverTimestamp(), repCancellationConfirmedBy: uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  logActivityBatch(batch, db, { event: "FACTURAMA_CANCELACION_SOLICITADA", rootId, actorUid: uid, actorRole: "superadmin", referenceId: snap.id, referenceFolio: snap.data()?.folio || null, referenceType: "SOLICITUD",
    description: `Confirmó cancelar junto con la factura ${reps.length} complemento(s) de pago.` });
  await batch.commit();
  return { ok: true, reps: reps.length };
});
