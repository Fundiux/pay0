import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { commissionAccountActor } from "./userDestinations";
import { resolveCommissionPayoutMode } from "./payoutPreference";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const stamp = admin.firestore.FieldValue.serverTimestamp;

/** A preference belongs to the authenticated participant, never to the organization. */
export const saveMyCommissionPayoutMode = onCall({ cors: true }, async request => {
  const actor = await commissionAccountActor(request);
  const mode = request.data?.mode;
  if (mode !== "MANUAL" && mode !== "AUTOMATIC") throw new HttpsError("invalid-argument", "Modalidad inválida.");
  const ref = db.doc(`commissionPayoutPreferences/${actor.uid}`);
  return db.runTransaction(async tx => {
    const before = await tx.get(ref);
    const version = Number(before.data()?.version || 0);
    if (request.data?.expectedVersion !== version) throw new HttpsError("aborted", "La preferencia cambió. Recarga antes de guardar.");
    const next = version + 1;
    const payload = { rootId: actor.rootId, ownerUid: actor.uid, mode, version: next, updatedBy: actor.uid, updatedAt: stamp() };
    tx.set(ref, payload);
    tx.create(db.doc(`commissionPayoutPreferenceHistory/${actor.uid}__v${next}`), payload);
    tx.create(db.collection("commissionAuditEvents").doc(), { rootId: actor.rootId, ownerUid: actor.uid, actorUid: actor.uid, event: "COMMISSION_PAYOUT_MODE_CHANGED", mode, version: next, createdAt: stamp() });
    return { ok: true, mode, version: next };
  });
});

export const getMyCommissionPayoutMode = onCall({ cors: true }, async request => {
  const actor = await commissionAccountActor(request);
  const snap = await db.doc(`commissionPayoutPreferences/${actor.uid}`).get();
  return { ok: true, mode: resolveCommissionPayoutMode(snap.data()?.mode), version: Number(snap.data()?.version || 0) };
});
