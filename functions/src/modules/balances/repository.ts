import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import type { BalanceAccountDoc, BalanceMovementDoc, HolderType } from "../shared/domain";

export function buildBalanceAccountId(holderType: HolderType, holderId: string) {
  return `${holderType}_${holderId}`;
}

export function balanceAccountRef(db: Firestore, holderType: HolderType, holderId: string) {
  return db.collection("balanceAccounts").doc(buildBalanceAccountId(holderType, holderId));
}

export function balanceMovementRef(db: Firestore, movementId?: string) {
  return movementId
    ? db.collection("balanceMovements").doc(movementId)
    : db.collection("balanceMovements").doc();
}

export async function readBalanceAccountTx(
  tx: Transaction,
  db: Firestore,
  holderType: HolderType,
  holderId: string,
) {
  const ref = balanceAccountRef(db, holderType, holderId);
  const snap = await tx.get(ref);
  return { ref, snap };
}

export function upsertBalanceAccountTx(
  tx: Transaction,
  db: Firestore,
  holderType: HolderType,
  holderId: string,
  patch: Partial<BalanceAccountDoc>,
) {
  const ref = balanceAccountRef(db, holderType, holderId);
  tx.set(ref, patch, { merge: true });
  return ref;
}

export function createBalanceMovementTx(
  tx: Transaction,
  db: Firestore,
  doc: BalanceMovementDoc,
  movementId?: string,
) {
  const ref = balanceMovementRef(db, movementId);
  tx.set(ref, {
    ...doc,
    createdAt: doc.createdAt ?? FieldValue.serverTimestamp(),
    updatedAt: doc.updatedAt ?? FieldValue.serverTimestamp(),
  });
  return ref;
}
