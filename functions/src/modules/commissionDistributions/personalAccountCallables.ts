import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { commissionAccountActor } from "./userDestinations";
import { authorizeCommissionAccountRead } from "./accountReadAuthorization";
import { normalizePersonalCommissionAccount } from "./personalAccounts";
import { encryptCommissionInstrument, fingerprintCommissionInstrument } from "./instrumentEncryption";
import { defineSecret } from "firebase-functions/params";
const ACCOUNT_KEY = defineSecret("COMMISSION_ACCOUNT_ENCRYPTION_KEY");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const cleanId = (value: unknown) => {
  const id = String(value || "").trim();
  if (!id || id.length > 128 || id.includes("/")) throw new HttpsError("invalid-argument", "Identificador inválido.");
  return id;
};
/**
 * Read-only endpoint for personal commission accounts.
 * Returns masked account identifiers only. Never use a client-provided rootId.
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
      instrumentNumber: "••" + String(data.last4 || "").slice(-4),
      active: data.active === true, iqLinkStatus: String(data.iqLinkStatus || "PENDING"),
    };
  });
  return { ok: true, ownerUid, accounts };
});

/** Self-service account registration. New accounts remain PENDING until IQ verification. */
export const createPersonalCommissionAccount = onCall({ cors: true, secrets: [ACCOUNT_KEY] }, async request => {
  const actor = await commissionAccountActor(request);
  const ownerSnap = await db.doc(`users/${actor.uid}`).get();
  const owner = ownerSnap.data() || {};
  try {
    authorizeCommissionAccountRead(
      { uid: actor.uid, rootId: actor.rootId, role: actor.role as "superadmin" | "admin" | "operador", active: true },
      { uid: actor.uid, rootId: String(owner.rootId || actor.uid), active: ownerSnap.exists && owner.isActive !== false && owner.active !== false && owner.isDeleted !== true && owner.disabled !== true },
      "SELF_PROFILE",
    );
  } catch {
    throw new HttpsError("permission-denied", "No tienes permiso para registrar cuentas.");
  }
  let account: ReturnType<typeof normalizePersonalCommissionAccount>;
  try {
    account = normalizePersonalCommissionAccount({
      ownerUid: actor.uid, rootId: actor.rootId,
      bankName: request.data?.bankName, beneficiaryName: request.data?.beneficiaryName,
      instrumentType: request.data?.instrumentType, instrumentNumber: request.data?.instrumentNumber,
    });
  } catch (error: any) {
    throw new HttpsError("invalid-argument", String(error?.message || "Cuenta inválida."));
  }
  const keyBase64 = ACCOUNT_KEY.value();
  if (!keyBase64) throw new HttpsError("failed-precondition", "Cifrado de cuentas no configurado.");
  const collection = db.collection("personalCommissionAccounts");
  const fingerprint = fingerprintCommissionInstrument({ number: account.instrumentNumber, instrumentType: account.instrumentType, rootId: actor.rootId, ownerUid: actor.uid, keyBase64 });
  const accountRef = collection.doc(fingerprint);
  const encryptedInstrument = encryptCommissionInstrument({ number: account.instrumentNumber, rootId: actor.rootId, ownerUid: actor.uid, accountId: accountRef.id, keyBase64, keyVersion: "v1" });
  const last4 = account.instrumentNumber.slice(-4);
  await db.runTransaction(async tx => {
    const existing = await tx.get(collection.where("rootId", "==", actor.rootId).where("ownerUid", "==", actor.uid).limit(50));
    // Read the deterministic document as well as the owner query so a concurrent
    // registration cannot silently reuse the same account identifier.
    const exact = await tx.get(accountRef);
    if (exact.exists) throw new HttpsError("already-exists", "Esta cuenta ya está registrada.");
    if (existing.size >= 50) throw new HttpsError("resource-exhausted", "Límite de 50 cuentas.");
    if (existing.docs.some(doc => doc.id === fingerprint)) {
      throw new HttpsError("already-exists", "Esta cuenta ya está registrada.");
    }
    tx.create(accountRef, { ownerUid: account.ownerUid, rootId: account.rootId, bankName: account.bankName, beneficiaryName: account.beneficiaryName, instrumentType: account.instrumentType, active: true, iqLinkStatus: "PENDING", encryptedInstrument, instrumentFingerprint: fingerprint, last4, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    tx.create(db.collection("commissionAuditEvents").doc(), { rootId: actor.rootId, ownerUid: actor.uid, actorUid: actor.uid, event: "PERSONAL_COMMISSION_ACCOUNT_CREATED", accountId: accountRef.id, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  });
  return { ok: true, accountId: accountRef.id, iqLinkStatus: "PENDING" };
});

/** Revoke a personal destination without deleting historical payout references. */
export const deactivatePersonalCommissionAccount = onCall({ cors: true }, async request => {
  const actor = await commissionAccountActor(request);
  const accountId = cleanId(request.data?.accountId);
  const ref = db.doc(`personalCommissionAccounts/${accountId}`);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const account = snap.data();
    if (!account || account.rootId !== actor.rootId || account.ownerUid !== actor.uid) {
      throw new HttpsError("permission-denied", "Cuenta fuera de alcance.");
    }
    if (account.active === false) return { ok: true, idempotent: true };
    tx.update(ref, { active: false, iqLinkStatus: "STALE", updatedAt: admin.firestore.FieldValue.serverTimestamp(), deactivatedBy: actor.uid });
    tx.create(db.collection("commissionAuditEvents").doc(), { rootId: actor.rootId, ownerUid: actor.uid, actorUid: actor.uid, event: "PERSONAL_COMMISSION_ACCOUNT_DEACTIVATED", accountId, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    return { ok: true, idempotent: false };
  });
});
