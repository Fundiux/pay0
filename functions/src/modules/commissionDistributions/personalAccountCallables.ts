import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { commissionAccountActor } from "./userDestinations";
import { authorizeCommissionAccountRead } from "./accountReadAuthorization";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const cleanId = (value: unknown) => {
  const id = String(value || "").trim();
  if (!id || id.length > 128 || id.includes("/")) throw new HttpsError("invalid-argument", "Identificador inválido.");
  return id;
};
/**
 * Read-only endpoint for personal commission accounts.
 * The collection is not written by this branch yet: empty results are expected until
 * account creation and migration are implemented. Never use a client-provided rootId.
 */
export const listPersonalCommissionAccounts = onCall({ cors: true }, async request => {
  const actor = await commissionAccountActor(request);
  const ownerUid = request.data?.ownerUid ? cleanId(request.data.ownerUid) : actor.uid;
  const purpose = request.data?.purpose === "CLIENT_COSTS" ? "CLIENT_COSTS" : "SELF_PROFILE";
  const ownerSnap = await db.doc(`users/${ownerUid}`).get();
  const ownerData = ownerSnap.data() || {};
  try {
    authorizeCommissionAccountRead(
      { uid: actor.uid, rootId: actor.rootId, role: actor.role as "superadmin" | "admin" | "operador", active: true },
      { uid: ownerUid, rootId: String(ownerData.rootId || ownerUid), active: ownerSnap.exists && ownerData.isActive !== false && ownerData.active !== false && ownerData.isDeleted !== true && ownerData.disabled !== true },
      purpose,
    );
  } catch {
    throw new HttpsError("permission-denied", "No tienes autorización para consultar estas cuentas.");
  }
  const snapshot = await db.collection("personalCommissionAccounts")
    .where("rootId", "==", actor.rootId).where("ownerUid", "==", ownerUid).limit(50).get();
  const accounts = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id, bankName: String(data.bankName || ""), beneficiaryName: String(data.beneficiaryName || ""),
      instrumentType: data.instrumentType === "CARD" ? "CARD" : "CLABE",
      instrumentNumber: String(data.instrumentNumber || ""),
      active: data.active === true, iqLinkStatus: String(data.iqLinkStatus || "PENDING"),
    };
  });
  return { ok: true, ownerUid, accounts };
});
