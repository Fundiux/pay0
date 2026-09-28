import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { assertNoteScope, manualNoteAuthor } from "./domain";

import {
  db,
  getMyUser,
  getRootId,
  requireAuth,
} from "../sharedCallables/helpers";

export const addSolicitudNota = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const me = await getMyUser(uid);
    assertAuthorized(request.auth, me, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "solicitudes", requiredAction: "comment" });
    const rootId = await getRootId(uid);

    const { solicitudId, text } = request.data || {};
    if (!solicitudId || !String(text || "").trim()) {
      throw new HttpsError("invalid-argument", "solicitudId y text son obligatorios.");
    }

    const ref = db.doc(`solicitudes/${solicitudId}`);
    const snap = await ref.get();

    if (!snap.exists) {
      throw new HttpsError("not-found", "Solicitud no existe.");
    }

    const data = snap.data()!;

    assertNoteScope(data, { uid, rootId, role: getUserRole(me) });

    const now = FieldValue.serverTimestamp();

    await ref.collection("notas").add({
      rootId,
      ...manualNoteAuthor(uid, me),
      referenceType: "solicitud",
      referenceId: String(solicitudId),
      text: String(text).trim(),
      createdAt: now,
    });

    await ref.update({ hasUnreadMsg: true, updatedAt: now });

    return { ok: true };
  }
);

export const addPagoNota = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const rootId = await getRootId(uid);
    const me = await getMyUser(uid);
    assertAuthorized(request.auth, me, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "pagos", requiredAction: "view" });

    const { pagoId, text } = request.data || {};
    if (!pagoId || !String(text || "").trim()) {
      throw new HttpsError("invalid-argument", "pagoId y text son obligatorios.");
    }

    const ref = db.doc(`pagos/${pagoId}`);
    const snap = await ref.get();

    if (!snap.exists) {
      throw new HttpsError("not-found", "Pago no existe.");
    }

    const data = snap.data()!;

    assertNoteScope(data, { uid, rootId, role: getUserRole(me) });

    await ref.collection("notas").add({
      rootId,
      text: String(text).trim(),
      ...manualNoteAuthor(uid, me),
      referenceType: "pago",
      referenceId: String(pagoId),
      createdAt: FieldValue.serverTimestamp(),
    });

    await ref.update({
      hasUnreadMsg: true,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { ok: true };
  }
);
