import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";
import { decryptCommissionInstrument } from "./instrumentEncryption";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
export const PERSONAL_COMMISSION_ACCOUNT_KEY = defineSecret("COMMISSION_ACCOUNT_ENCRYPTION_KEY");

/**
 * Only the authorized server-side commission IQ path may unwrap bank numbers.
 * The decrypted number must never be written to a client-scoped Firestore document.
 */
export async function loadPersonalCommissionInstrumentForIq(input: {
  rootId: string;
  ownerUid: string;
  accountId: string;
  fingerprint: string;
  expectedLast4: string;
}) {
  const ref = db.doc(`personalCommissionAccounts/${input.accountId}`);
  const snap = await ref.get();
  const account = snap.data();
  if (!account || account.rootId !== input.rootId || account.ownerUid !== input.ownerUid ||
      account.active !== true || !account.encryptedInstrument ||
      account.instrumentFingerprint !== input.fingerprint || account.last4 !== input.expectedLast4) {
    throw new Error("PERSONAL_COMMISSION_INSTRUMENT_REVOKED");
  }
  const keyBase64 = PERSONAL_COMMISSION_ACCOUNT_KEY.value();
  if (!keyBase64) throw new Error("PERSONAL_COMMISSION_KEY_NOT_CONFIGURED");
  const number = decryptCommissionInstrument({
    encrypted: account.encryptedInstrument, rootId: input.rootId, ownerUid: input.ownerUid,
    accountId: input.accountId, keyBase64,
  });
  if (number.slice(-4) !== account.last4 || !/^\d{16,19}$/.test(number)) throw new Error("PERSONAL_COMMISSION_INSTRUMENT_INVALID");
  if (account.instrumentType === "CLABE" && number.length !== 18) throw new Error("PERSONAL_COMMISSION_CLABE_INVALID");
  if (account.instrumentType !== "CLABE" && account.instrumentType !== "CARD") throw new Error("PERSONAL_COMMISSION_INSTRUMENT_TYPE_INVALID");
  return {
    ...account, number,
    operationTypeKey: account.instrumentType === "CLABE" ? "TRANSFERENCIA" as const : "TDC" as const,
  };
}
