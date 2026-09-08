import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { buildBalanceAccountPatchFromMovement, buildBalanceMovement, assertSufficientBalance } from "./service";
import { createBalanceMovementTx, readBalanceAccountTx, upsertBalanceAccountTx } from "./repository";
import { assertHolderId, assertHolderType, assertMovementAmount, normalizeHolderRole } from "./validators";
import { logActivityTx } from "../../utils/logActivity";
import { assertAuthorized } from "../../utils/authGuard";

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

type OperationIdempotencyStoreInput = {
  operation: string;
  uid: string;
  rootId: string;
  key: string;
  result: any;
};

function normalizeOperationIdempotencyKey(data: any): string | null {
  const raw = String(data?.idempotencyKey || data?.operationId || "").trim();
  if (!raw) return null;

  if (raw.length < 8 || raw.length > 160) {
    throw new HttpsError("invalid-argument", "idempotencyKey invalido.");
  }

  if (!/^[A-Za-z0-9._:-]+$/.test(raw)) {
    throw new HttpsError("invalid-argument", "idempotencyKey contiene caracteres invalidos.");
  }

  return raw;
}

function operationIdempotencyRef(operation: string, uid: string, key: string) {
  return db.collection("operationIdempotency").doc(`${operation}__${uid}__${key}`);
}

function readOperationIdempotencyResult(snap: any) {
  if (!snap?.exists) return null;
  const data = snap.data() || {};
  return data.result || null;
}

function storeOperationIdempotencyTx(tx: any, ref: any, input: OperationIdempotencyStoreInput) {
  tx.set(ref, {
    operation: input.operation,
    uid: input.uid,
    rootId: input.rootId,
    key: input.key,
    result: input.result,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}
export const createManualAdjustment = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = String(request.auth?.uid || "").trim();
    if (!uid) {
      throw new HttpsError("unauthenticated", "Usuario no autenticado.");
    }

    const data = request.data || {};
    const idempotencyOperation = "createManualAdjustment";
    const idempotencyKey = normalizeOperationIdempotencyKey(data);
    const idempotencyDocRef = idempotencyKey ? operationIdempotencyRef(idempotencyOperation, uid, idempotencyKey) : null;
    const holderType = assertHolderType(data.holderType);
    const holderId = assertHolderId(data.holderId);
    const direction = data.direction === "OUT" ? "OUT" : data.direction === "IN" ? "IN" : null;
    if (!direction) {
      throw new HttpsError("invalid-argument", "direction invalida.");
    }

    const amount = assertMovementAmount(data.amount, "amount");
    const reason = String(data.reason || data.note || "").trim();
    if (!reason) {
      throw new HttpsError("invalid-argument", "reason requerido.");
    }

    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) {
      throw new HttpsError("permission-denied", "Perfil de usuario no encontrado.");
    }

    const profile = userSnap.data() || {};
    assertAuthorized(request.auth, profile, { allowedRoles: ["superadmin"], requiredModule: "wallet", requiredAction: "configuracion" });
    const role = String(profile.role || "").trim().toLowerCase();
    if (role !== "superadmin") {
      throw new HttpsError("permission-denied", "Solo superadmin puede hacer ajustes manuales.");
    }

    const rootId = String(profile.rootId || uid).trim();
    const actorUsername = String(
      profile.username ||
      profile.actorUsername ||
      profile.displayName ||
      request.auth?.token?.email ||
      uid
    ).trim();

    const requestedHolderName = String(data.holderName || "").trim();
    const requestedHolderRole = holderType === "USER" ? normalizeHolderRole(data.holderRole) : null;

    let result:
      | {
          movementId: string;
          beforeBalance: number;
          afterBalance: number;
          holderName: string;
          holderRole: "superadmin" | "admin" | "operador" | null;
        }
      | undefined;

    await db.runTransaction(async (tx) => {
      if (idempotencyDocRef) {
        const idempotencySnap = await tx.get(idempotencyDocRef);
        const storedResult = readOperationIdempotencyResult(idempotencySnap);
        if (storedResult) {
          result = storedResult;
          return;
        }
      }

      const { snap } = await readBalanceAccountTx(tx, db, holderType, holderId);
      const current = snap.exists ? (snap.data() as any) : undefined;

      const beforeBalance = Number(current?.availableBalance || 0);
      if (direction === "OUT") {
        assertSufficientBalance(beforeBalance, amount);
      }

      const holderName = requestedHolderName || String(current?.holderName || holderId).trim();
      const holderRole =
        holderType === "USER"
          ? (requestedHolderRole || current?.holderRole || null)
          : null;

      const movementRef = db.collection("balanceMovements").doc();

      const movement = buildBalanceMovement({
        rootId,
        holderType,
        holderId,
        holderRole,
        holderName,
        movementType: "AJUSTE_MANUAL",
        direction,
        amount,
        beforeBalance,
        sourceModule: "BALANCES",
        referenceType: "ADJUSTMENT",
        referenceId: movementRef.id,
        clienteId: holderType === "CLIENT" ? holderId : (data.clienteId ? String(data.clienteId) : null),
        empresaId: data.empresaId ? String(data.empresaId) : null,
        asociadoId: data.asociadoId ? String(data.asociadoId) : null,
        adminId: data.adminId ? String(data.adminId) : null,
        operadorId: data.operadorId ? String(data.operadorId) : null,
        note: reason,
        createdBy: uid,
        actorUsername,
        isSystemGenerated: false,
      });

      const accountPatch = buildBalanceAccountPatchFromMovement(current, movement);

      createBalanceMovementTx(tx, db, movement, movementRef.id);
      upsertBalanceAccountTx(tx, db, holderType, holderId, accountPatch);

      logActivityTx(tx, db, {
        event: "AJUSTE_MANUAL_APLICADO",
        rootId,
        actorUid: uid,
        actorUsername,
        actorRole: role,
        entityType: holderType,
        entityId: holderId,
        amount,
        referenceId: movementRef.id,
        referenceType: "balanceMovement",
        description: `Ajuste manual ${direction === "IN" ? "abono" : "cargo"} por ${amount} a ${holderType} ${holderId}.`,
        createdBy: uid,
        extra: {
          direction,
          note: reason,
        },
      });

      result = {
        movementId: movementRef.id,
        beforeBalance: movement.beforeBalance,
        afterBalance: movement.afterBalance,
        holderName,
        holderRole,
      };

      if (idempotencyDocRef && idempotencyKey && result) {
        storeOperationIdempotencyTx(tx, idempotencyDocRef, {
          operation: idempotencyOperation,
          uid,
          rootId,
          key: idempotencyKey,
          result,
        });
      }

    });

    return {
      ok: true,
      movementId: result?.movementId || null,
      holderType,
      holderId,
      holderName: result?.holderName || null,
      holderRole: result?.holderRole || null,
      direction,
      amount,
      beforeBalance: result?.beforeBalance ?? null,
      afterBalance: result?.afterBalance ?? null,
    };
  }
);
