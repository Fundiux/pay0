import type {
  Firestore,
  Transaction,
} from "firebase-admin/firestore";
import {
  buildDispatchBalanceAccountId,
  buildDispatchBalanceMovementId,
  normalizeDispatchBalanceAccountKey,
  type DispatchBalanceAccountDoc,
  type DispatchBalanceAccountKey,
  type DispatchBalanceMovementDoc,
} from "./domain";

export const DISPATCH_BALANCE_ACCOUNTS_COLLECTION =
  "dispatchBalanceAccounts";

export const DISPATCH_BALANCE_MOVEMENTS_COLLECTION =
  "dispatchBalanceMovements";

export const CLIENT_DISPERSION_LEGS_COLLECTION =
  "clientDispersionLegs";

export function dispatchBalanceAccountRef(
  db: Firestore,
  keyInput: DispatchBalanceAccountKey,
) {
  const key =
    normalizeDispatchBalanceAccountKey(
      keyInput,
    );

  return db
    .collection(
      DISPATCH_BALANCE_ACCOUNTS_COLLECTION,
    )
    .doc(
      buildDispatchBalanceAccountId(key),
    );
}

export function dispatchBalanceMovementRef(
  db: Firestore,
  input: {
    rootId: string;
    sourceId: string;
    holderType: "CLIENT" | "USER";
    holderId: string;
    despachoId: string;
    currency: string;
    purpose: string;
  },
) {
  return db
    .collection(
      DISPATCH_BALANCE_MOVEMENTS_COLLECTION,
    )
    .doc(
      buildDispatchBalanceMovementId(input),
    );
}

export async function readDispatchBalanceAccountTx(
  tx: Transaction,
  db: Firestore,
  key: DispatchBalanceAccountKey,
) {
  const ref =
    dispatchBalanceAccountRef(db, key);
  const snap = await tx.get(ref);

  return {
    ref,
    snap,
  };
}

export function createDispatchBalanceMovementTx(
  tx: Transaction,
  db: Firestore,
  movementIdInput: {
    rootId: string;
    sourceId: string;
    holderType: "CLIENT" | "USER";
    holderId: string;
    sourceClientId?: string | null;
    despachoId: string;
    currency: string;
    purpose: string;
  },
  doc: DispatchBalanceMovementDoc,
) {
  const ref =
    dispatchBalanceMovementRef(
      db,
      movementIdInput,
    );

  tx.create(ref, doc);
  return ref;
}

export function upsertDispatchBalanceAccountTx(
  tx: Transaction,
  db: Firestore,
  key: DispatchBalanceAccountKey,
  patch: Partial<DispatchBalanceAccountDoc>,
) {
  const ref =
    dispatchBalanceAccountRef(db, key);

  tx.set(ref, patch, {
    merge: true,
  });

  return ref;
}