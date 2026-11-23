import * as admin from "firebase-admin";
import { createHash } from "node:crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { commissionAccountActor } from "./userDestinations";
import { decryptCommissionInstrument } from "./instrumentEncryption";
import { isPostedCommissionPayment } from "./domain";
import { loadIqAccess, IQ_CREDENTIALS_KEY } from "../iq/dispersionCreationCallables";
import { resolveIqBeneficiaryInstrument } from "../iq/dispersionHttpCreateCore";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const ACCOUNT_KEY = defineSecret("COMMISSION_ACCOUNT_ENCRYPTION_KEY");
const text = (value: unknown) => String(value ?? "").trim();
const safe = (value: unknown, field: string) => {
  const v = text(value);
  if (!v || v.length > 128 || v.includes("/")) throw new HttpsError("invalid-argument", field + " inválido.");
  return v;
};
/** The IQ link is specific to the client: different clients may use different partners and IQ profiles. */
export function personalCommissionIqLinkId(rootId: string, clientId: string, ownerUid: string, accountId: string) {
  return createHash("sha256").update(JSON.stringify([rootId, clientId, ownerUid, accountId])).digest("hex");
}

/** Verify against the real IQ wizard. Only a full-number match can authorize later payouts. */
export const resolvePersonalCommissionAccountIq = onCall({
  cors: true, timeoutSeconds: 120, memory: "1GiB", maxInstances: 2,
  secrets: [ACCOUNT_KEY, IQ_CREDENTIALS_KEY],
}, async request => {
  const actor = await commissionAccountActor(request, true);
  const clientId = safe(request.data?.clientId, "Cliente");
  const ownerUid = safe(request.data?.ownerUid, "Usuario");
  const accountId = safe(request.data?.accountId, "Cuenta");
  const paymentId = safe(request.data?.paymentId, "Pago IQ de referencia");
  const [clientSnap, ownerSnap, accountSnap, paymentSnap, actorSnap] = await Promise.all([
    db.doc(`clients/${clientId}`).get(), db.doc(`users/${ownerUid}`).get(),
    db.doc(`personalCommissionAccounts/${accountId}`).get(),
    db.doc(`pagos/${paymentId}`).get(), db.doc(`users/${actor.uid}`).get(),
  ]);
  const owner = ownerSnap.data(), account = accountSnap.data(), client = clientSnap.data(), payment = paymentSnap.data();
  if (!client || client.rootId !== actor.rootId || !owner ||
      text(owner.rootId || ownerUid) !== actor.rootId ||
      owner.active === false || owner.isActive === false || owner.isDeleted === true || owner.disabled === true ||
      !account || account.rootId !== actor.rootId || account.ownerUid !== ownerUid || account.active !== true ||
      !payment || payment.rootId !== actor.rootId || text(payment.clienteId || payment.clientId) !== clientId ||
      !isPostedCommissionPayment(payment)) {
    throw new HttpsError("failed-precondition", "No hay una cuenta, cliente y pago contabilizado autorizados.");
  }
  const despachoId = safe(payment.despachoId, "Origen IQ");
  const clientIqId = text(client.iqLink?.clientId || client.iqClientId);
  if (!clientIqId) throw new HttpsError("failed-precondition", "Cliente sin vínculo IQ.");
  if (!account.encryptedInstrument || !text(account.last4)) throw new HttpsError("failed-precondition", "Cuenta sin instrumento cifrado válido.");
  const keyBase64 = ACCOUNT_KEY.value();
  if (!keyBase64) throw new HttpsError("failed-precondition", "Clave de cuentas no configurada.");
  const digits = decryptCommissionInstrument({
    encrypted: account.encryptedInstrument,
    rootId: actor.rootId, ownerUid, accountId, keyBase64,
  });
  if (digits.slice(-4) !== account.last4) throw new HttpsError("failed-precondition", "El instrumento bancario cambió.");
  const actorData = actorSnap.data() || {};
  const access = await loadIqAccess({
    uid: actor.uid, rootId: actor.rootId, role: actor.role,
    username: text(actorData.username || actor.uid),
  }, despachoId, "IQ", payment);
  const operationTypeKey = account.instrumentType === "CARD" ? "TDC" : "TRANSFERENCIA";
  const linkId = personalCommissionIqLinkId(actor.rootId, clientId, ownerUid, accountId);
  const ref = db.doc(`personalCommissionIqLinks/${linkId}`);
  try {
    const resolved = await resolveIqBeneficiaryInstrument({
      apiOrigin: access.erpUrl, username: access.username, password: access.password,
      associatedName: access.associatedName, clientIqId, beneficiaryCandidates: [text(account.beneficiaryName)],
      currency: "MXN", operationTypeKey, expectedDestinationLast4: digits.slice(-4), expectedDestinationDigits: digits,
    });
    if (!resolved.fullDigitsMatched || resolved.instrumentLast4 !== digits.slice(-4)) {
      throw new Error("IQ_FULL_ACCOUNT_MATCH_REQUIRED");
    }
    await db.runTransaction(async tx => {
      const freshAccount = await tx.get(accountSnap.ref);
      if (freshAccount.data()?.active !== true || freshAccount.data()?.instrumentFingerprint !== account.instrumentFingerprint) {
        throw new HttpsError("aborted", "La cuenta cambió durante la verificación.");
      }
      tx.set(ref, {
        rootId: actor.rootId, clientId, ownerUid, accountId, paymentId,
        despachoId, iqCredentialProfileId: access.profileId, iqClientId: resolved.clientIqId,
        iqPartnerId: resolved.partnerId, iqBeneficiaryId: resolved.iqBeneficiaryId,
        iqAccountId: resolved.iqAccountId, iqBeneficiaryName: resolved.iqBeneficiaryName,
        accountFingerprint: account.instrumentFingerprint, last4: account.last4,
        iqLinkStatus: "VERIFIED", verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        verifiedBy: actor.uid, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      tx.create(db.collection("commissionAuditEvents").doc(), {
        rootId: actor.rootId, clientId, ownerUid, accountId, actorUid: actor.uid,
        event: "PERSONAL_COMMISSION_IQ_ACCOUNT_VERIFIED", createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    return { ok: true, status: "VERIFIED", accountId, masked: "••" + account.last4 };
  } catch (error) {
    // An uncertain or failed lookup NEVER creates a VERIFIED link or authorizes a transfer.
    const code = text(error instanceof Error ? error.message : error).slice(0, 100);
    await ref.set({
      rootId: actor.rootId, clientId, ownerUid, accountId, iqLinkStatus: "STALE",
      errorCode: code, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: false, status: "STALE", reason: code };
  }
});
