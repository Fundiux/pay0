import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { assertNoteScope, manualNoteAuthor } from "./domain";
import { documentId } from "./readPagination";

import {
  db,
  requireAuth,
} from "../sharedCallables/helpers";

export const addSolicitudNota = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const { solicitudId, text } = request.data || {};
    if (!documentId(solicitudId) || !String(text || "").trim()) {
      throw new HttpsError("invalid-argument", "solicitudId y text son obligatorios.");
    }

    const ref = db.doc(`solicitudes/${solicitudId}`);
    // One identity per invocation, retained across transaction retries. This does
    // not provide idempotency across separate HTTP calls.
    const noteRef = ref.collection("notas").doc();
    await db.runTransaction(async (transaction) => {
      const user = await transaction.get(db.doc(`users/${uid}`));
      const me = user.exists ? user.data() : null;
      const role = assertAuthorized(request.auth, me, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "solicitudes", requiredAction: "comment" });
      // Preserve the existing profile-derived fallback, never infer from parent.
      const rootId = String(me!.rootId || uid);
      const snap = await transaction.get(ref);
      if (!snap.exists) throw new HttpsError("not-found", "Solicitud no existe.");
      assertNoteScope(snap.data()!, { uid, rootId, role });
      const now = FieldValue.serverTimestamp();
      transaction.create(noteRef, {
        rootId,
        ...manualNoteAuthor(uid, me!),
        referenceType: "solicitud",
        referenceId: solicitudId,
        text: String(text).trim(),
        createdAt: now,
      });
      transaction.update(ref, { hasUnreadMsg: true, updatedAt: now });
    }, { maxAttempts: 3 });

    return { ok: true };
  }
);

export const addPagoNota = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const { pagoId, text } = request.data || {};
    if (!documentId(pagoId) || !String(text || "").trim()) {
      throw new HttpsError("invalid-argument", "pagoId y text son obligatorios.");
    }

    const ref = db.doc(`pagos/${pagoId}`);
    // One identity per invocation, retained across transaction retries. This does
    // not provide idempotency across separate HTTP calls.
    const noteRef = ref.collection("notas").doc();
    await db.runTransaction(async (transaction) => {
      const user = await transaction.get(db.doc(`users/${uid}`));
      const me = user.exists ? user.data() : null;
      const role = assertAuthorized(request.auth, me, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "pagos", requiredAction: "view" });
      // Preserve the existing profile-derived fallback, never infer from parent.
      const rootId = String(me!.rootId || uid);
      const snap = await transaction.get(ref);
      if (!snap.exists) throw new HttpsError("not-found", "Pago no existe.");
      assertNoteScope(snap.data()!, { uid, rootId, role });
      const now = FieldValue.serverTimestamp();
      transaction.create(noteRef, {
        rootId,
        ...manualNoteAuthor(uid, me!),
        referenceType: "pago",
        referenceId: pagoId,
        text: String(text).trim(),
        createdAt: now,
      });
      transaction.update(ref, { hasUnreadMsg: true, updatedAt: now });
    }, { maxAttempts: 3 });

    return { ok: true };
  }
);
