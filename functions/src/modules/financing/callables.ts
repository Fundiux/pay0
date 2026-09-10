import {
  getApps,
  initializeApp } from "firebase-admin/app";
import { FieldValue,
  getFirestore } from "firebase-admin/firestore";
import { HttpsError,
  onCall } from "firebase-functions/v2/https";
import { buildBalanceAccountPatchFromMovement,
  buildBalanceMovement } from "../balances/service";
import { createBalanceMovementTx,
  readBalanceAccountTx,
  upsertBalanceAccountTx } from "../balances/repository";
import { assertAdvanceAmount,
  assertAdvanceReason,
  assertBeneficiaryId,
  assertClienteId,
  assertDispersionAmount,
  assertMethodId } from "./validators";
import { buildCanonicalFolio,
  buildCounterPath,
  nextSequenceTx } from "../sequences/service";
import { requireClientOperationalAccess } from "../clientDelegations/access";
import { logActivity,
  logActivityTx } from "../../utils/logActivity";
import { assertAuthorized } from "../../utils/authGuard";
import {
  applyForwardOnlyDispersionTx,
  prepareForwardOnlyDispersionTx,
  projectForwardOnlyDispersionBatchState,
  type ForwardOnlyBatchAccountState,
  } from "../dispatchBalances/forwardOnly";
import {
  applyCanonicalDispersionFinancialsTx,
  prepareCanonicalDispersionFinancialsTx,
  resolveDispersionOperationTypeKey,
  reverseCanonicalDispersionFinancialsTx,
  projectCanonicalDispersionFinancialBatchState,
  type CanonicalFinancialBatchAccountState,
} from "./dispersionFinancial";

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
async function getActiveClientDelegationAccess(uid: string, clientId: string) {
  const accessSnap = await db.doc(`userClientAccess/${uid}/clients/${clientId}`).get();
  if (!accessSnap.exists) return null;

  const data: any = accessSnap.data() || {};
  if (data?.active !== true) return null;
  if (data?.permissions?.view === false) return null;

  return {
    id: accessSnap.id,
    path: accessSnap.ref.path,
    data,
  };
}

export const listScopedClientDispersions = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = String(request.auth?.uid || "").trim();
    if (!uid) throw new HttpsError("unauthenticated", "Usuario no autenticado.");

    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) throw new HttpsError("permission-denied", "Perfil de usuario no encontrado.");

    const profile: any = userSnap.data() || {};
    assertAuthorized(request.auth, profile, {
      allowedRoles: ["superadmin", "admin", "operador"],
      requiredModule: "wallet",
      requiredAction: "dispersiones",
    });
    const rootId = String(profile.rootId || uid).trim();
    const limit = Math.min(Math.max(Math.trunc(Number(request.data?.limit || 500)), 1), 500);
    const snap = await db.collection("clientDispersions")
      .where("rootId", "==", rootId)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    return { rows: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })), limit };
  }
);

export const grantClientAdvance = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = String(request.auth?.uid || "").trim();
    if (!uid) {
      throw new HttpsError("unauthenticated", "Usuario no autenticado.");
    }

    const data = request.data || {};
    const idempotencyOperation = "grantClientAdvance";
    const idempotencyKey = normalizeOperationIdempotencyKey(data);
    const idempotencyDocRef = idempotencyKey ? operationIdempotencyRef(idempotencyOperation, uid, idempotencyKey) : null;
    const clienteId = assertClienteId(data.clienteId);
    const amount = assertAdvanceAmount(data.amount);
    const reason = assertAdvanceReason(data.reason);
    const note = String(data.note || "").trim() || null;
    const reference = String(data.reference || "").trim() || null;
    const empresaId = String(data.empresaId || "").trim() || null;
    const asociadoId = String(data.asociadoId || "").trim() || null;

    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) {
      throw new HttpsError("permission-denied", "Perfil de usuario no encontrado.");
    }

    const profile = userSnap.data() || {};
    assertAuthorized(request.auth, profile, { allowedRoles: ["superadmin"], requiredModule: "wallet", requiredAction: "adelantos" });
    const role = String(profile.role || "").trim().toLowerCase();
    if (role !== "superadmin") {
      throw new HttpsError("permission-denied", "Solo superadmin puede otorgar adelantos.");
    }

    const rootId = String(profile.rootId || uid).trim();
    const actorUsername = String(
      profile.username ||
      profile.actorUsername ||
      profile.displayName ||
      request.auth?.token?.email ||
      uid
    ).trim();

    const clientSnap = await db.doc(`clients/${clienteId}`).get();
    if (!clientSnap.exists) {
      throw new HttpsError("not-found", "Cliente no encontrado.");
    }

    const client = clientSnap.data() || {};
    if (client.rootId && String(client.rootId).trim() !== rootId) {
      throw new HttpsError("permission-denied", "Cliente fuera de alcance.");
    }

    const clienteNombre = String(
      client.name ||
      client.nombre ||
      client.clientName ||
      client.razonSocial ||
      client.businessName ||
      clienteId
    ).trim();

    const adminId = String(client.adminId || "").trim() || null;
    const managedByUserId = String(client.managedByUserId || "").trim() || null;
    const operadorId = String(client.operadorId || managedByUserId || "").trim() || null;

    let result:
      | {
          advanceId: string;
          movementId: string;
          beforeBalance: number;
          afterBalance: number;
          clienteNombre: string;
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

      const { snap } = await readBalanceAccountTx(tx, db, "CLIENT", clienteId);
      const current = snap.exists ? (snap.data() as any) : undefined;
      const beforeBalance = Number(current?.availableBalance || 0);

      const movementRef = db.collection("balanceMovements").doc();
      const advanceRef = db.collection("clientAdvances").doc();

      const movement = buildBalanceMovement({
        rootId,
        holderType: "CLIENT",
        holderId: clienteId,
        holderRole: null,
        holderName: clienteNombre,
        movementType: "ADELANTO_OTORGADO",
        direction: "IN",
        amount,
        beforeBalance,
        sourceModule: "FINANCING",
        referenceType: "ADVANCE",
        referenceId: advanceRef.id,
        clienteId,
        empresaId,
        asociadoId,
        adminId,
        operadorId,
        note: note || reason,
        createdBy: uid,
        actorUsername,
        isSystemGenerated: false,
      });

      const accountPatch = buildBalanceAccountPatchFromMovement(current, movement);

      createBalanceMovementTx(tx, db, movement, movementRef.id);
      upsertBalanceAccountTx(tx, db, "CLIENT", clienteId, accountPatch);

      tx.set(advanceRef, {
        rootId,
        clienteId,
        clientId: clienteId,
        clienteNombre,
        adminId,
        operadorId,
        empresaId,
        asociadoId,
        amount,
        pendingAmount: amount,
        status: "OTORGADO",
        reason,
        note,
        reference,
        grantedBy: uid,
        grantedUsername: actorUsername,
        approvedBy: uid,
        approvedUsername: actorUsername,
        balanceMovementId: movementRef.id,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      logActivityTx(tx, db, {
        event: "ADELANTO_OTORGADO",
        rootId,
        adminId,
        actorUid: uid,
        actorUsername,
        actorRole: role,
        entityType: "CLIENT",
        entityId: clienteId,
        amount,
        referenceId: advanceRef.id,
        referenceType: "clientAdvance",
        description: `Adelanto otorgado por ${amount} al cliente ${clienteNombre}.`,
        createdBy: uid,
        extra: {
          note: note || reason,
          operadorId,
          empresaId,
          asociadoId,
        },
      });

      result = {
        advanceId: advanceRef.id,
        movementId: movementRef.id,
        beforeBalance: movement.beforeBalance,
        afterBalance: movement.afterBalance,
        clienteNombre,
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
      advanceId: result?.advanceId || null,
      movementId: result?.movementId || null,
      clienteId,
      clienteNombre: result?.clienteNombre || null,
      amount,
      beforeBalance: result?.beforeBalance ?? null,
      afterBalance: result?.afterBalance ?? null,
      status: "OTORGADO",
    };
  }
);




export const createClientDispersion = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = String(request.auth?.uid || "").trim();
    if (!uid) {
      throw new HttpsError("unauthenticated", "Usuario no autenticado.");
    }

    const data = request.data || {};
    const idempotencyOperation = "createClientDispersion";
    const idempotencyKey = normalizeOperationIdempotencyKey(data);
    const idempotencyDocRef = idempotencyKey ? operationIdempotencyRef(idempotencyOperation, uid, idempotencyKey) : null;
    const clienteId = assertClienteId(data.clienteId);
    const beneficiaryId = assertBeneficiaryId(data.beneficiaryId);
    const methodId = assertMethodId(data.methodId);
    const amount = assertDispersionAmount(data.amount);
    const note = String(data.note || "").trim() || null;
    const reference = String(data.reference || "").trim() || null;
    const empresaId = String(data.empresaId || "").trim() || null;
    const asociadoId = String(data.asociadoId || "").trim() || null;
    const despachoId = String(data.despachoId || "").trim();

    if (!despachoId) {
      throw new HttpsError(
        "invalid-argument",
        "despachoId requerido.",
      );
    }

    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) {
      throw new HttpsError("permission-denied", "Perfil de usuario no encontrado.");
    }

    const profile = userSnap.data() || {};
    assertAuthorized(request.auth, profile, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "wallet", requiredAction: "dispersiones" });
    const role = String(profile.role || "").trim().toLowerCase();
    if (role !== "superadmin" && role !== "admin" && role !== "operador" && role !== "operator") {
      throw new HttpsError("permission-denied", "Solo superadmin, admin u operador puede crear dispersiones.");
    }

    const rootId = String(profile.rootId || uid).trim();
    const actorUsername = String(
      profile.username ||
      profile.actorUsername ||
      profile.displayName ||
      request.auth?.token?.email ||
      uid
    ).trim();

    const access = await requireClientOperationalAccess({
      uid,
      role: role === "operator" ? "operador" : (role as any),
      rootId,
      clientId: clienteId,
      permission: "operateDispersiones",
      errorMessage: "No autorizado para crear dispersiones de este cliente.",
    });

    const client = access.client || {};
    const clientAdminId = access.economicOwnerAdminId;
    const operadorId = access.economicOwnerOperadorId;
    const accessSource = access.source;
    const delegatedClientAccessPath = access.delegationPath;

    const clienteNombre = String(
      client.name ||
      client.nombre ||
      client.clientName ||
      client.razonSocial ||
      client.businessName ||
      clienteId
    ).trim();

    const beneficiarySnap = await db.doc(`clientBeneficiaries/${beneficiaryId}`).get();
    if (!beneficiarySnap.exists) {
      throw new HttpsError("not-found", "Beneficiario no encontrado.");
    }

    const beneficiary = beneficiarySnap.data() || {};
    if (String(beneficiary.clientId || beneficiary.clienteId || "").trim() !== clienteId) {
      throw new HttpsError("failed-precondition", "El beneficiario no pertenece al cliente.");
    }
    if (beneficiary.active === false) {
      throw new HttpsError("failed-precondition", "El beneficiario esta inactivo.");
    }
    if (beneficiary.rootId && String(beneficiary.rootId).trim() !== rootId) {
      throw new HttpsError("permission-denied", "Beneficiario fuera de alcance.");
    }

    const beneficiaryNombre = String(
      beneficiary.nombre ||
      beneficiary.nombreNormalizado ||
      beneficiaryId
    ).trim();
    const dispersionConcept = `Dispersion a ${beneficiaryNombre}`;

    const methodSnap = await db.doc(`clientBeneficiaryMethods/${methodId}`).get();
    if (!methodSnap.exists) {
      throw new HttpsError("not-found", "Metodo del beneficiario no encontrado.");
    }

    const method = methodSnap.data() || {};
    if (String(method.clientId || method.clienteId || "").trim() !== clienteId) {
      throw new HttpsError("failed-precondition", "El metodo no pertenece al cliente.");
    }
    if (String(method.beneficiaryId || "").trim() !== beneficiaryId) {
      throw new HttpsError("failed-precondition", "El metodo no pertenece al beneficiario.");
    }
    if (method.active === false) {
      throw new HttpsError("failed-precondition", "El metodo esta inactivo.");
    }
    if (method.rootId && String(method.rootId).trim() !== rootId) {
      throw new HttpsError("permission-denied", "Metodo fuera de alcance.");
    }

    const methodTipo = String(method.tipo || "").trim() || null;
    const destinationKind = String(method.destinationKind || "").trim() || null;
    const bankCode = String(method.bankCode || "").trim() || null;
    const bankName = String(method.bankName || "").trim() || null;
    const clabe = String(method.clabe || "").trim() || null;
    const cardNumber = String(method.cardNumber || "").trim() || null;
    const operationTypeKey =
      resolveDispersionOperationTypeKey(
        methodTipo,
        destinationKind,
      );

    const clientNumber = Number(client.clientNumber ?? client.numeroCliente ?? client.sequenceNumber ?? 0);
    const userNumber = Number((profile as any)?.userNumber ?? (profile as any)?.numeroUsuario ?? (profile as any)?.sequenceNumber ?? 0);

    if (!Number.isFinite(clientNumber) || clientNumber <= 0) {
      throw new HttpsError("failed-precondition", "Numero canonico de cliente faltante. Repara numeracion de clientes antes de crear dispersiones.");
    }

    if (!Number.isFinite(userNumber) || userNumber <= 0) {
      throw new HttpsError("failed-precondition", "Numero canonico de usuario faltante. Repara numeracion de usuarios antes de crear dispersiones.");
    }

    if (destinationKind === "CLABE" && !clabe) {
      throw new HttpsError("failed-precondition", "Metodo CLABE invalido.");
    }
    if (destinationKind === "TARJETA" && !cardNumber) {
      throw new HttpsError("failed-precondition", "Metodo TARJETA invalido.");
    }
    if (destinationKind === "EFECTIVO" && (clabe || cardNumber)) {
      throw new HttpsError("failed-precondition", "Metodo EFECTIVO inconsistente.");
    }

    let result:
      | {
          dispersionId: string;
          movementId: string;
          commissionMovementId: string | null;
          beforeBalance: number;
          afterBalance: number;
          clientChargeAmount: number;
          totalClientDebitAmount: number;
          despachoCostAmount: number;
          superadminEarningAmount: number;
          adminEarningAmount: number;
          operadorEarningAmount: number;
          totalEarningsAmount: number;
          operationTypeKey: string;
          despachoId: string;
          folio: string;
          sequenceNumber: number;
          sequenceCounterPath: string;
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

      const { snap } = await readBalanceAccountTx(tx, db, "CLIENT", clienteId);
      const current = snap.exists ? (snap.data() as any) : undefined;
      const beforeBalance = Number(current?.availableBalance || 0);

      const preparedFinancials =
        await prepareCanonicalDispersionFinancialsTx({
          tx,
          db,
          rootId,
          clientId: clienteId,
          client,
          adminId: clientAdminId,
          operadorId,
          despachoId,
          operationTypeKey,
          amount,
          currency: "MXN",
        });

      if (
        beforeBalance <
        preparedFinancials.pricing
          .totalClientDebitAmount
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Saldo insuficiente para monto y comision de la dispersion.",
        );
      }

      const dispersionRef = db.collection("clientDispersions").doc();

      // H4_D82_A3_A2_FORWARD_ONLY_DISPERSION_HOOK
      const preparedForwardOnlyDispersion =
        await prepareForwardOnlyDispersionTx({
          tx,
          db,
          rootId,
          clientId: clienteId,
          clientName:
            String(
              (access.client as any)?.name ||
                (access.client as any)?.nombre ||
                (access.client as any)
                  ?.razonSocial ||
                clienteId,
            ).trim() || clienteId,
          principalDispersionId:
            dispersionRef.id,
          operationTypeKey,
          preferredDespachoId:
            despachoId,
          pricing:
            preparedFinancials.pricing,
          fallbackNames: {
            superadminName: rootId,
            adminName:
              access.economicOwnerAdminId ||
              "",
            operadorName:
              access.economicOwnerOperadorId ||
              "",
          },
        });


      const seq = await nextSequenceTx({
        db,
        tx,
        rootId,
        scope: "dispersions",
          scopeKey: `cliente_${clienteId}__usuario_${uid}`,
      });

      const folio = buildCanonicalFolio("D", seq.sequenceNumber, [
        { label: "C", value: clientNumber },
        { label: "U", value: userNumber },
      ]);

      const destinationDataForConcept =
        methodTipo === "EFECTIVO"
          ? ""
          : String(cardNumber || clabe || "").trim();

      const dispersionConceptBase =
        methodTipo === "DEBITO"
          ? "TRANSFERENCIA"
          : methodTipo === "TDC"
            ? "PAGO TDC"
            : methodTipo === "AMEX"
              ? "PAGO AMEX"
              : methodTipo === "EFECTIVO"
                ? "RETIRO EFECTIVO"
                : "OTRO TIPO";

      const dispersionConcept = destinationDataForConcept
        ? `${dispersionConceptBase} ${destinationDataForConcept}`
        : dispersionConceptBase;
      const financial =
        applyCanonicalDispersionFinancialsTx({
          tx,
          db,
          prepared: preparedFinancials,
          clientAccountCurrent: current,
          clientId: clienteId,
          clientName: clienteNombre,
          dispersionId: dispersionRef.id,
          folio,
          empresaId,
          asociadoId,
          beneficiaryId,
          beneficiaryNombre,
          methodId,
          methodTipo,
          destinationKind,
          bankName,
          createdBy: uid,
          actorUsername,
          principalConcept:
            dispersionConcept,
        });

      const forwardOnlyResult =
        applyForwardOnlyDispersionTx({
          tx,
          db,
          prepared:
            preparedForwardOnlyDispersion,
          dispersionRef,
          folio,
          createdBy: uid,
          actorUsername,
          operationTypeKey,
        });


      tx.set(dispersionRef, {
        rootId,
        clienteId,
        clientId: clienteId,
        clienteNombre,
        adminId: clientAdminId,
        actorUid: uid,
        actorRole: role,
        accessSource,
        delegatedClientAccessPath,
        folio,
        referenceFolio: folio,
        dispersionFolio: folio,
        sourceFolio: folio,
        operationalReference: folio,
        displayConcept: dispersionConcept,
        folioVersion: 1,
        sequenceNumber: seq.sequenceNumber,
        sequenceScope: `dispersions:${rootId}:C${clientNumber}:U${userNumber}`,
        sequenceCounterPath: seq.counterPath,
        clientNumber,
        userNumber,
        operadorId,
        empresaId,
        asociadoId,
        beneficiaryId,
        beneficiaryNombre,
        methodId,
        methodTipo,
        destinationKind,
        bankCode,
        bankName,
        clabe,
        cardNumber,
        despachoId,
        operationTypeKey,
        operationTypeName:
          financial.pricing
            .operationTypeName,
        amount,
        clientChargeAmount:
          financial.pricing
            .clientChargeAmount,
        totalClientDebitAmount:
          financial.pricing
            .totalClientDebitAmount,
        despachoCostAmount:
          financial.pricing
            .despachoCostAmount,
        superadminEarningAmount:
          financial.pricing
            .superadminEarningAmount,
        adminEarningAmount:
          financial.pricing
            .adminEarningAmount,
        operadorEarningAmount:
          financial.pricing
            .operadorEarningAmount,
        totalEarningsAmount:
          financial.pricing
            .totalEarningsAmount,
        pricingSnapshot:
          financial.pricingSnapshot,
        financialSnapshotId:
          dispersionRef.id,
        earningsDistributionId:
          `DISPERSION__${dispersionRef.id}`,
        status: "REGISTRADA",
        note,
        reference,
        balanceMovementId:
          financial.principalMovementId,
        principalMovementId:
          financial.principalMovementId,
        commissionMovementId:
          financial.commissionMovementId,
        earningMovementIds:
          financial.earningMovementIds,
        createdBy: uid,
        createdUsername: actorUsername,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      logActivityTx(tx, db, {
        event: "DISPERSION_REGISTRADA",
        rootId,
        adminId: clientAdminId,
        actorUid: uid,
        actorUsername,
        actorRole: role,
        entityType: "CLIENT",
        entityId: clienteId,
        amount:
          financial.pricing
            .totalClientDebitAmount,
        referenceId: dispersionRef.id,
        referenceFolio: folio,
        referenceType: "DISPERSION",
        description: `Dispersion ${folio} registrada por ${amount} para ${beneficiaryNombre}.`,
        createdBy: uid,
        extra: {
          accessSource,
          delegatedClientAccessPath,
          note: note || null,
          operadorId,
          beneficiaryId,
          beneficiaryNombre,
          methodId,
          methodTipo,
          destinationKind,
          bankName,
          despachoId,
          operationTypeKey,
          requestedAmount: amount,
          clientChargeAmount:
            financial.pricing
              .clientChargeAmount,
          totalClientDebitAmount:
            financial.pricing
              .totalClientDebitAmount,
          totalEarningsAmount:
            financial.pricing
              .totalEarningsAmount,
        },
      });

      tx.set(

        dispersionRef,

        forwardOnlyResult.principalPatch,

        { merge: true },

      );



      result = {
        dispersionId: dispersionRef.id,
        movementId:
          financial.principalMovementId,
        commissionMovementId:
          financial.commissionMovementId,
        beforeBalance:
          financial.beforeBalance,
        afterBalance:
          financial.afterBalance,
        clientChargeAmount:
          financial.pricing
            .clientChargeAmount,
        totalClientDebitAmount:
          financial.pricing
            .totalClientDebitAmount,
        despachoCostAmount:
          financial.pricing
            .despachoCostAmount,
        superadminEarningAmount:
          financial.pricing
            .superadminEarningAmount,
        adminEarningAmount:
          financial.pricing
            .adminEarningAmount,
        operadorEarningAmount:
          financial.pricing
            .operadorEarningAmount,
        totalEarningsAmount:
          financial.pricing
            .totalEarningsAmount,
        operationTypeKey,
        despachoId,
        folio,
        sequenceNumber: seq.sequenceNumber,
        sequenceCounterPath: seq.counterPath,
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
      dispersionId: result?.dispersionId || null,
      folio: result?.folio || null,
      movementId: result?.movementId || null,
      clienteId,
      beneficiaryId,
      methodId,
      despachoId:
        result?.despachoId ||
        despachoId,
      operationTypeKey:
        result?.operationTypeKey ||
        operationTypeKey,
      amount,
      clientChargeAmount:
        result?.clientChargeAmount ?? 0,
      totalClientDebitAmount:
        result?.totalClientDebitAmount ??
        amount,
      despachoCostAmount:
        result?.despachoCostAmount ?? 0,
      superadminEarningAmount:
        result?.superadminEarningAmount ??
        0,
      adminEarningAmount:
        result?.adminEarningAmount ?? 0,
      operadorEarningAmount:
        result?.operadorEarningAmount ??
        0,
      totalEarningsAmount:
        result?.totalEarningsAmount ?? 0,
      commissionMovementId:
        result?.commissionMovementId ||
        null,
      beforeBalance: result?.beforeBalance ?? null,
      afterBalance: result?.afterBalance ?? null,
      status: "REGISTRADA",
    };
  }
);



export const createClientDispersionsMassive = onCall(
  { cors: true, timeoutSeconds: 120, memory: "512MiB" },
  async (request) => {
    const uid = String(request.auth?.uid || "").trim();
    if (!uid) {
      throw new HttpsError("unauthenticated", "Usuario no autenticado.");
    }

    const data = request.data || {};
    const idempotencyOperation = "createClientDispersionsMassive";
    const idempotencyKey = normalizeOperationIdempotencyKey(data);
    const idempotencyDocRef = idempotencyKey ? operationIdempotencyRef(idempotencyOperation, uid, idempotencyKey) : null;
    const clienteId = assertClienteId(data.clienteId);
    // H4_D87_A58_A33_MASSIVE_DESPACHO_CONTRACT
    const despachoId = String(data.despachoId || "").trim();
    if (!despachoId) {
      throw new HttpsError(
        "invalid-argument",
        "despachoId requerido para dispersion masiva.",
      );
    }
    const rawItems: any[] = Array.isArray(data.items) ? data.items : [];

    if (rawItems.length === 0) {
      throw new HttpsError("invalid-argument", "items requerido.");
    }

    if (rawItems.length > 100) {
      throw new HttpsError("invalid-argument", "Maximo 100 dispersiones por carga.");
    }

    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) {
      throw new HttpsError("permission-denied", "Perfil de usuario no encontrado.");
    }

    const profile = userSnap.data() || {};
    assertAuthorized(request.auth, profile, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "wallet", requiredAction: "dispersiones" });
    const role = String(profile.role || "").trim().toLowerCase();

    if (role !== "superadmin" && role !== "admin" && role !== "operador" && role !== "operator") {
      throw new HttpsError("permission-denied", "Solo superadmin, admin u operador puede crear dispersiones masivas.");
    }

    const rootId = String(profile.rootId || uid).trim();
    const actorUsername = String(
      profile.username ||
      profile.actorUsername ||
      profile.displayName ||
      request.auth?.token?.email ||
      uid
    ).trim();

    const access = await requireClientOperationalAccess({
      uid,
      role: role === "operator" ? "operador" : (role as any),
      rootId,
      clientId: clienteId,
      permission: "operateDispersiones",
      errorMessage: "No autorizado para crear dispersiones de este cliente.",
    });

    const client = access.client || {};
    const clientAdminId = access.economicOwnerAdminId;
    const operadorId = access.economicOwnerOperadorId;
    const accessSource = access.source;
    const delegatedClientAccessPath = access.delegationPath;

    const clienteNombre = String(
      client.name ||
      client.nombre ||
      client.clientName ||
      client.razonSocial ||
      client.businessName ||
      clienteId
    ).trim();

    const clientNumber = Number(client.clientNumber ?? client.numeroCliente ?? client.sequenceNumber ?? 0);
    const userNumber = Number(
      (profile as any)?.userNumber ??
      (profile as any)?.numeroUsuario ??
      (profile as any)?.sequenceNumber ??
      0
    );

    if (!Number.isFinite(clientNumber) || clientNumber <= 0) {
      throw new HttpsError("failed-precondition", "Numero canonico de cliente faltante. Repara numeracion de clientes antes de crear dispersiones.");
    }

    if (!Number.isFinite(userNumber) || userNumber <= 0) {
      throw new HttpsError("failed-precondition", "Numero canonico de usuario faltante. Repara numeracion de usuarios antes de crear dispersiones.");
    }

    function normalizeText(value: unknown) {
      return String(value || "")
        .trim()
        .toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ");
    }

    function onlyDigits(value: unknown) {
      return String(value || "").replace(/\D/g, "");
    }

    function normalizeAmount(value: unknown) {
      const amount = Math.round(Number(value || 0) * 100) / 100;
      return Number.isFinite(amount) ? amount : 0;
    }

    function normalizeMethodTipo(value: unknown) {
      const raw = normalizeText(value || "DEBITO");
      if (raw === "TDC") return "TDC";
      if (raw === "AMEX" || raw === "AMERICAN EXPRESS") return "AMEX";
      return "DEBITO";
    }

    function normalizeDestinationKind(raw: any) {
      const explicit = normalizeText(raw.destinationKind || raw.destino || raw.kind || "");
      if (explicit === "CLABE") return "CLABE";
      if (explicit === "TARJETA") return "TARJETA";
      if (explicit === "EFECTIVO") return "EFECTIVO";

      const clabe = onlyDigits(raw.clabe || raw.CLABE);
      const cardNumber = onlyDigits(raw.numeroTarjeta || raw.cardNumber || raw.tarjeta || raw["NUMERO DE TARJETA"]);

      if (clabe) return "CLABE";
      if (cardNumber) return "TARJETA";
      return "EFECTIVO";
    }

    function normalizeInputRow(raw: any, index: number) {
      const rowNumber = Number(raw?.rowNumber || index + 2);
      const methodTipo = normalizeMethodTipo(raw?.methodTipo || raw?.tipo || data.methodTipo || "DEBITO");
      const destinationKind = normalizeDestinationKind(raw || {});
      const clabe = onlyDigits(raw?.clabe || raw?.CLABE);
      const cardNumber = onlyDigits(raw?.numeroTarjeta || raw?.cardNumber || raw?.tarjeta || raw?.["NUMERO DE TARJETA"]);
      const beneficiaryName = String(
        raw?.nombre ||
        raw?.beneficiario ||
        raw?.beneficiaryNombre ||
        raw?.beneficiaryName ||
        ""
      ).trim();

      const amount = normalizeAmount(raw?.amount ?? raw?.monto);
      const banco = String(raw?.banco || raw?.bankName || "").trim();
      const bankCodeFromClabe = clabe.length === 18 ? clabe.slice(0, 3) : "";
      const bankCode = String(raw?.bankCode || raw?.codigoBanco || bankCodeFromClabe || "").trim();

      return {
        rowNumber,
        beneficiaryId: String(raw?.beneficiaryId || "").trim(),
        methodId: String(raw?.methodId || "").trim(),
        beneficiaryName,
        beneficiaryNameKey: normalizeText(beneficiaryName),
        methodTipo,
        destinationKind,
        banco,
        bankName: banco,
        bankCode,
        clabe,
        cardNumber,
        cuenta: String(raw?.cuenta || raw?.accountNumber || "").trim(),
        amount,
        note: String(raw?.note || raw?.nota || "").trim() || null,
        reference: String(raw?.reference || raw?.referencia || raw?.referenciaOperativa || "").trim() || null,
        empresaId: String(raw?.empresaId || data.empresaId || "").trim() || null,
        asociadoId: String(raw?.asociadoId || data.asociadoId || "").trim() || null,
      };
    }

    function validateCandidate(candidate: any) {
      const errors: string[] = [];

    if (candidate.methodTipo === "EFECTIVO") {
      errors.push("EFECTIVO no esta permitido en dispersion masiva.");
    }

      if (!candidate.beneficiaryId && !candidate.beneficiaryNameKey) {
        errors.push("NOMBRE requerido.");
      }

      if (!Number.isFinite(candidate.amount) || candidate.amount <= 0) {
        errors.push("MONTO requerido y mayor a 0.");
      }

      if (candidate.destinationKind === "CLABE") {
        if (candidate.methodTipo !== "DEBITO" && candidate.methodTipo !== "EFECTIVO") {
          errors.push(`${candidate.methodTipo} requiere NUMERO DE TARJETA.`);
        }

        if (candidate.clabe.length !== 18) {
          errors.push("CLABE debe tener 18 digitos.");
        }
      } else if (candidate.destinationKind === "TARJETA") {
        const requiredLength = candidate.methodTipo === "AMEX" ? 15 : 16;
        if (candidate.cardNumber.length !== requiredLength) {
          errors.push(
            candidate.methodTipo === "AMEX"
              ? "NUMERO DE TARJETA AMEX debe tener 15 digitos."
              : "NUMERO DE TARJETA debe tener 16 digitos."
          );
        }

        if (!candidate.bankName) {
          errors.push("BANCO requerido para tarjeta.");
        }
      } else {
        errors.push("CLABE o NUMERO DE TARJETA requerido.");
      }

      return errors;
    }

    function methodKeyFromParts(methodTipo: string, destinationKind: string, clabe: string, cardNumber: string) {
      const dato = destinationKind === "CLABE" ? clabe : destinationKind === "TARJETA" ? cardNumber : "EFECTIVO";
      return `${normalizeText(methodTipo)}|${normalizeText(destinationKind)}|${dato}`;
    }

    const candidates = rawItems.map((raw: any, index: number) => normalizeInputRow(raw, index));

    const skippedRows: Array<{
      rowNumber: number;
      nombre: string;
      amount: number;
      reason: string;
    }> = [];

    const prevalidCandidates: any[] = [];

    for (const candidate of candidates) {
      const errors = validateCandidate(candidate);
      if (errors.length > 0) {
        skippedRows.push({
          rowNumber: candidate.rowNumber,
          nombre: candidate.beneficiaryName,
          amount: candidate.amount,
          reason: errors.join(" "),
        });
        continue;
      }

      prevalidCandidates.push(candidate);
    }

    if (prevalidCandidates.length === 0) {
      return {
        ok: true,
        batchId: "",
        clienteId,
        totalRows: candidates.length,
        createdCount: 0,
        skippedCount: skippedRows.length,
        beneficiariesCreated: 0,
        methodsCreated: 0,
        totalAmount: 0,
        beforeBalance: null,
        afterBalance: null,
        sequenceStart: null,
        sequenceEnd: null,
        sequenceCounterPath: null,
        dispersions: [],
        skippedRows,
      };
    }

    const batchRef = db.collection("clientDispersionBatches").doc();

    let result:
      | {
          batchId: string;
          created: Array<{
            rowNumber: number;
            dispersionId: string;
            movementId: string;
            folio: string;
            amount: number;
            beforeBalance: number;
            afterBalance: number;
          }>;
          beforeBalance: number;
          afterBalance: number;
          totalAmount: number;
          sequenceStart: number;
          sequenceEnd: number;
          sequenceCounterPath: string;
          beneficiariesCreated: number;
          methodsCreated: number;
          skippedRows: Array<{
            rowNumber: number;
            nombre: string;
            amount: number;
            reason: string;
          }>;
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

      const { snap } = await readBalanceAccountTx(tx, db, "CLIENT", clienteId);
      const currentAccount = snap.exists ? (snap.data() as any) : undefined;
      const beforeBatchBalance = Number(currentAccount?.availableBalance || 0);

      const beneficiarySnapByClienteId = await tx.get(
        db.collection("clientBeneficiaries").where("clienteId", "==", clienteId)
      );

      const beneficiarySnapByClientId = await tx.get(
        db.collection("clientBeneficiaries").where("clientId", "==", clienteId)
      );

      const methodSnapByClienteId = await tx.get(
        db.collection("clientBeneficiaryMethods").where("clienteId", "==", clienteId)
      );

      const methodSnapByClientId = await tx.get(
        db.collection("clientBeneficiaryMethods").where("clientId", "==", clienteId)
      );

      const existingBeneficiariesById = new Map<string, any>();
      const activeBeneficiariesByName = new Map<string, any[]>();

      function addBeneficiaryDoc(doc: any) {
        if (!doc.exists) return;
        const data = doc.data() || {};
        const id = doc.id;

        if (existingBeneficiariesById.has(id)) return;

        const row = { id, ...data };
        existingBeneficiariesById.set(id, row);

        const nameKey = normalizeText(data.nombre || data.nombreNormalizado || data.name || "");
        if (!nameKey) return;

        if (!activeBeneficiariesByName.has(nameKey)) {
          activeBeneficiariesByName.set(nameKey, []);
        }

        if (data.active !== false) {
          activeBeneficiariesByName.get(nameKey)?.push(row);
        }
      }

      beneficiarySnapByClienteId.docs.forEach(addBeneficiaryDoc);
      beneficiarySnapByClientId.docs.forEach(addBeneficiaryDoc);

      const existingMethodsByBeneficiaryId = new Map<string, any[]>();

      function addMethodDoc(doc: any) {
        if (!doc.exists) return;
        const data = doc.data() || {};
        const id = doc.id;

        if (data.active === false) return;

        const beneficiaryId = String(data.beneficiaryId || data.beneficiarioId || "").trim();
        if (!beneficiaryId) return;

        if (!existingMethodsByBeneficiaryId.has(beneficiaryId)) {
          existingMethodsByBeneficiaryId.set(beneficiaryId, []);
        }

        existingMethodsByBeneficiaryId.get(beneficiaryId)?.push({ id, ...data });
      }

      methodSnapByClienteId.docs.forEach(addMethodDoc);
      methodSnapByClientId.docs.forEach(addMethodDoc);

      const plannedBeneficiariesByName = new Map<string, any>();
      const plannedMethodsByKey = new Map<string, any>();

      const processable: any[] = [];
      let beneficiariesCreated = 0;
      let methodsCreated = 0;

      for (const candidate of prevalidCandidates) {
        let beneficiaryId = candidate.beneficiaryId;
        let beneficiaryNombre = candidate.beneficiaryName;
        let beneficiaryRef: any = null;
        let beneficiaryWasCreated = false;

        if (beneficiaryId) {
          const existing = existingBeneficiariesById.get(beneficiaryId);
          if (!existing) {
            skippedRows.push({
              rowNumber: candidate.rowNumber,
              nombre: candidate.beneficiaryName,
              amount: candidate.amount,
              reason: "beneficiaryId no encontrado.",
            });
            continue;
          }

          if (existing.active === false) {
            skippedRows.push({
              rowNumber: candidate.rowNumber,
              nombre: candidate.beneficiaryName,
              amount: candidate.amount,
              reason: "beneficiario inactivo.",
            });
            continue;
          }

          beneficiaryRef = db.doc(`clientBeneficiaries/${beneficiaryId}`);
          beneficiaryNombre = String(existing.nombre || existing.nombreNormalizado || candidate.beneficiaryName || beneficiaryId).trim();
        } else {
          const matches = activeBeneficiariesByName.get(candidate.beneficiaryNameKey) || [];

          if (matches.length > 1) {
            skippedRows.push({
              rowNumber: candidate.rowNumber,
              nombre: candidate.beneficiaryName,
              amount: candidate.amount,
              reason: "beneficiario duplicado. Revisa Beneficiarios antes de dispersar.",
            });
            continue;
          }

          if (matches.length === 1) {
            beneficiaryId = matches[0].id;
            beneficiaryRef = db.doc(`clientBeneficiaries/${beneficiaryId}`);
            beneficiaryNombre = String(matches[0].nombre || matches[0].nombreNormalizado || candidate.beneficiaryName).trim();
          } else {
            const planned = plannedBeneficiariesByName.get(candidate.beneficiaryNameKey);
            if (planned) {
              beneficiaryId = planned.id;
              beneficiaryRef = planned.ref;
              beneficiaryNombre = planned.nombre;
            } else {
              beneficiaryRef = db.collection("clientBeneficiaries").doc();
              beneficiaryId = beneficiaryRef.id;
              beneficiaryNombre = candidate.beneficiaryName;
              beneficiaryWasCreated = true;

              plannedBeneficiariesByName.set(candidate.beneficiaryNameKey, {
                id: beneficiaryId,
                ref: beneficiaryRef,
                nombre: beneficiaryNombre,
                data: {
                  rootId,
                  clientId: clienteId,
                  clienteId,
                  clienteNombre,
                  nombre: beneficiaryNombre,
                  nombreNormalizado: candidate.beneficiaryNameKey,
                  active: true,
                  actorUid: uid,
                  actorRole: role,
                  accessSource,
                  delegatedClientAccessPath,
                  createdBy: uid,
                  createdUsername: actorUsername,
                  createdAt: FieldValue.serverTimestamp(),
                  updatedAt: FieldValue.serverTimestamp(),
                },
              });
            }
          }
        }

        const methodKey = methodKeyFromParts(
          candidate.methodTipo,
          candidate.destinationKind,
          candidate.clabe,
          candidate.cardNumber
        );

        let methodId = candidate.methodId;
        let methodRef: any = null;
        let methodWasCreated = false;

        if (methodId) {
          methodRef = db.doc(`clientBeneficiaryMethods/${methodId}`);
        } else {
          const existingMethods = existingMethodsByBeneficiaryId.get(beneficiaryId) || [];

          const exactMethod = existingMethods.find((method) => {
            const methodTipo = normalizeText(method.tipo || method.methodTipo || method.type || "");
            const destinationKind = normalizeText(method.destinationKind || method.destino || method.kind || "");
            const methodClabe = onlyDigits(method.clabe || method.CLABE);
            const methodCard = onlyDigits(method.cardNumber || method.numeroTarjeta || method.tarjeta);

            return methodKeyFromParts(methodTipo, destinationKind, methodClabe, methodCard) === methodKey;
          });

          if (exactMethod) {
            methodId = exactMethod.id;
            methodRef = db.doc(`clientBeneficiaryMethods/${methodId}`);
          } else {
            const plannedMethodKey = `${beneficiaryId}|${methodKey}`;
            const planned = plannedMethodsByKey.get(plannedMethodKey);

            if (planned) {
              methodId = planned.id;
              methodRef = planned.ref;
            } else {
              methodRef = db.collection("clientBeneficiaryMethods").doc();
              methodId = methodRef.id;
              methodWasCreated = true;

              plannedMethodsByKey.set(plannedMethodKey, {
                id: methodId,
                ref: methodRef,
                data: {
                  rootId,
                  clientId: clienteId,
                  clienteId,
                  clienteNombre,
                  beneficiaryId,
                  beneficiarioId: beneficiaryId,
                  beneficiaryNombre,
                  tipo: candidate.methodTipo,
                  methodTipo: candidate.methodTipo,
                  destinationKind: candidate.destinationKind,
                  bankCode: candidate.bankCode || null,
                  bankName: candidate.bankName || null,
                  banco: candidate.bankName || null,
                  clabe: candidate.destinationKind === "CLABE" ? candidate.clabe : null,
                  cardNumber: candidate.destinationKind === "TARJETA" ? candidate.cardNumber : null,
                  numeroTarjeta: candidate.destinationKind === "TARJETA" ? candidate.cardNumber : null,
                  cuenta: candidate.cuenta || null,
                  active: true,
                  actorUid: uid,
                  actorRole: role,
                  accessSource,
                  delegatedClientAccessPath,
                  createdBy: uid,
                  createdUsername: actorUsername,
                  createdAt: FieldValue.serverTimestamp(),
                  updatedAt: FieldValue.serverTimestamp(),
                },
              });
            }
          }
        }

        if (beneficiaryWasCreated) beneficiariesCreated += 1;
        if (methodWasCreated) methodsCreated += 1;

        processable.push({
          ...candidate,
          despachoId,
          beneficiaryId,
          beneficiaryRef,
          beneficiaryNombre,
          methodId,
          methodRef,
          methodKey,
          beneficiaryWasCreated,
          methodWasCreated,
        });
      }

      const totalAmount = Math.round(
        processable.reduce((sum: number, item: any) => sum + item.amount, 0) * 100
      ) / 100;

      if (processable.length === 0) {
        result = {
          batchId: "",
          created: [],
          beforeBalance: beforeBatchBalance,
          afterBalance: beforeBatchBalance,
          totalAmount: 0,
          sequenceStart: 0,
          sequenceEnd: 0,
          sequenceCounterPath: "",
          beneficiariesCreated: 0,
          methodsCreated: 0,
          skippedRows,
        };
        return;
      }

      const counterPath = buildCounterPath({
        rootId,
        scope: "dispersions",
        scopeKey: `cliente_${clienteId}__usuario_${uid}`,
      });

      const counterRef = db.doc(counterPath);
      const counterSnap = await tx.get(counterRef);
      const currentSequence = counterSnap.exists ? Number((counterSnap.data() as any)?.value || 0) : 0;
      const sequenceStart = currentSequence + 1;
      const sequenceEnd = currentSequence + processable.length;

      // H4_D87_A58_A40_MASSIVE_CANONICAL_FORWARD_ONLY
      // Fase 1: todas las lecturas y preparaciones ocurren antes de la primera escritura.
      const canonicalBatchAccountState:
        CanonicalFinancialBatchAccountState =
          new Map();

      const forwardOnlyBatchAccountState:
        ForwardOnlyBatchAccountState =
          new Map();

      let canonicalClientCurrent: any =
        currentAccount
          ? { ...currentAccount }
          : undefined;

      const preparedRows: any[] = [];
      const created: Array<{
        rowNumber: number;
        dispersionId: string;
        movementId: string;
        folio: string;
        amount: number;
        beforeBalance: number;
        afterBalance: number;
      }> = [];

      // H4_D87_A58_A42_MASSIVE_SAFE_BUDGET_15_SINGLE_LEG
      // El presupuesto interno usa ponderacion conservadora (~3x writes).
      // 1200 cubre 15 filas single-leg incluso con comision y hasta
      // 3 earnings canonicos + 3 allocations forward-only, sin quitar el guard.
      const SAFE_TRANSACTION_BUDGET_UNITS = 1200;
      const FIXED_SAFETY_OVERHEAD_UNITS = 20;

      const newBeneficiaryCount =
        plannedBeneficiariesByName.size;
      const newMethodCount =
        plannedMethodsByKey.size;

      let transactionBudgetUnits =
        FIXED_SAFETY_OVERHEAD_UNITS +
        6 +
        (newBeneficiaryCount > 0 ? 3 : 0) +
        newBeneficiaryCount * 5 +
        newMethodCount * 5 +
        (idempotencyKey ? 3 : 0);

      for (
        let index = 0;
        index < processable.length;
        index += 1
      ) {
        const item = processable[index];
        const dispersionRef =
          db.collection("clientDispersions").doc();

        const sequenceNumber =
          sequenceStart + index;

        const folio =
          buildCanonicalFolio(
            "D",
            sequenceNumber,
            [
              { label: "C", value: clientNumber },
              { label: "U", value: userNumber },
            ],
          );

        const operationTypeKey =
          resolveDispersionOperationTypeKey(
            item.methodTipo,
            item.destinationKind,
          );

        const destinationDataForConcept =
          item.methodTipo === "EFECTIVO"
            ? ""
            : String(
                item.cardNumber ||
                item.clabe ||
                "",
              ).trim();

        const dispersionConceptBase =
          item.methodTipo === "DEBITO"
            ? "TRANSFERENCIA"
            : item.methodTipo === "TDC"
              ? "PAGO TDC"
              : item.methodTipo === "AMEX"
                ? "PAGO AMEX"
                : item.methodTipo === "EFECTIVO"
                  ? "RETIRO EFECTIVO"
                  : "OTRO TIPO";

        const dispersionConcept =
          destinationDataForConcept
            ? `${dispersionConceptBase} ${destinationDataForConcept}`
            : dispersionConceptBase;

        const clientAccountCurrent =
          canonicalClientCurrent;

        const preparedFinancials =
          await prepareCanonicalDispersionFinancialsTx({
            tx,
            db,
            rootId,
            clientId: clienteId,
            client,
            adminId: clientAdminId,
            operadorId,
            despachoId:
              item.despachoId ||
              despachoId,
            operationTypeKey,
            amount: item.amount,
            currency: "MXN",
            batchAccountState:
              canonicalBatchAccountState,
          });

        const canonicalProjection =
          projectCanonicalDispersionFinancialBatchState({
            prepared: preparedFinancials,
            batchAccountState:
              canonicalBatchAccountState,
            clientAccountCurrent,
            clientId: clienteId,
            clientName: clienteNombre,
          });

        canonicalClientCurrent =
          canonicalProjection.clientFinalAccount;

        const preparedForwardOnlyDispersion =
          await prepareForwardOnlyDispersionTx({
            tx,
            db,
            rootId,
            clientId: clienteId,
            clientName: clienteNombre,
            principalDispersionId:
              dispersionRef.id,
            operationTypeKey,
            preferredDespachoId:
              item.despachoId ||
              despachoId,
            pricing:
              preparedFinancials.pricing,
            batchAccountState:
              forwardOnlyBatchAccountState,
            fallbackNames: {
              superadminName: rootId,
              adminName:
                access.economicOwnerAdminId || "",
              operadorName:
                access.economicOwnerOperadorId || "",
            },
          });

        projectForwardOnlyDispersionBatchState(
          preparedForwardOnlyDispersion,
          forwardOnlyBatchAccountState,
        );

        const canonicalEarningCount =
          [
            preparedFinancials.superadminState,
            preparedFinancials.adminState,
            preparedFinancials.operadorState,
          ].filter(Boolean).length;

        const commissionCount =
          Number(
            preparedFinancials.pricing.clientChargeAmount || 0,
          ) > 0
            ? 1
            : 0;

        const routeLegCount =
          preparedForwardOnlyDispersion.route.legs.length;

        const forwardEarningCount =
          preparedForwardOnlyDispersion.earnings.length;

        // Presupuesto conservador por fila:
        // 23 base + 6/comision + 6/earning canonico
        // + 9/leg Forward-Only + 7/earning Forward-Only.
        transactionBudgetUnits +=
          23 +
          commissionCount * 6 +
          canonicalEarningCount * 6 +
          routeLegCount * 9 +
          forwardEarningCount * 7;

        preparedRows.push({
          item,
          dispersionRef,
          sequenceNumber,
          folio,
          operationTypeKey,
          dispersionConcept,
          clientAccountCurrent,
          preparedFinancials,
          preparedForwardOnlyDispersion,
        });
      }

      const batchAfterBalance =
        Math.round(
          Number(
            canonicalClientCurrent?.availableBalance || 0,
          ) * 100,
        ) / 100;

      if (
        transactionBudgetUnits >
        SAFE_TRANSACTION_BUDGET_UNITS
      ) {
        throw new HttpsError(
          "failed-precondition",
          "La carga masiva excede el presupuesto seguro de la transaccion. Divide el archivo en bloques mas pequenos.",
          {
            filasValidas: processable.length,
            unidadesEstimadas: transactionBudgetUnits,
            limiteSeguro: SAFE_TRANSACTION_BUDGET_UNITS,
            beneficiariosNuevos: newBeneficiaryCount,
            metodosNuevos: newMethodCount,
          },
        );
      }

      let autoBeneficiaryCounterPath = "";
      let autoBeneficiarySequenceStart = 0;

      if (plannedBeneficiariesByName.size > 0) {
        autoBeneficiaryCounterPath = buildCounterPath({
          rootId,
          scope: "beneficiaries",
          scopeKey: `cliente_${clienteId}__usuario_${uid}`,
        });

        const autoBeneficiaryCounterRef = db.doc(autoBeneficiaryCounterPath);
        const autoBeneficiaryCounterSnap = await tx.get(autoBeneficiaryCounterRef);
        const currentAutoBeneficiarySequence = autoBeneficiaryCounterSnap.exists
          ? Number((autoBeneficiaryCounterSnap.data() as any)?.value || 0)
          : 0;

        autoBeneficiarySequenceStart = currentAutoBeneficiarySequence + 1;
        const autoBeneficiarySequenceEnd = currentAutoBeneficiarySequence + plannedBeneficiariesByName.size;

        let autoBeneficiaryIndex = 0;
        for (const planned of plannedBeneficiariesByName.values()) {
          const beneficiaryNumber = autoBeneficiarySequenceStart + autoBeneficiaryIndex;
          const beneficiaryFolio = buildCanonicalFolio("B", beneficiaryNumber, [
            { label: "C", value: clientNumber },
            { label: "U", value: userNumber },
          ]);

          planned.data = {
            ...planned.data,
            beneficiaryNumber,
            numeroBeneficiario: beneficiaryNumber,
            sequenceNumber: beneficiaryNumber,
            beneficiaryFolio,
            folio: beneficiaryFolio,
            sequenceScope: `beneficiaries:${rootId}:C${clientNumber}:U${userNumber}`,
            sequenceCounterPath: autoBeneficiaryCounterPath,
          };

          autoBeneficiaryIndex += 1;
        }

        tx.set(
          autoBeneficiaryCounterRef,
          {
            rootId,
            scope: "beneficiaries",
            scopeKey: `cliente_${clienteId}__usuario_${uid}`,
            value: autoBeneficiarySequenceEnd,
            updatedAt: FieldValue.serverTimestamp(),
            createdAt: autoBeneficiaryCounterSnap.exists
              ? (autoBeneficiaryCounterSnap.data() as any)?.createdAt || FieldValue.serverTimestamp()
              : FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      for (const planned of plannedBeneficiariesByName.values()) {
        tx.set(planned.ref, planned.data);

        logActivityTx(tx, db, {
          event: "BENEFICIARIO_CREADO",
          rootId,
          adminId: clientAdminId,
          actorUid: uid,
          actorUsername,
          actorRole: role,
          entityType: "CLIENT",
          entityId: clienteId,
          relatedEntityType: "beneficiary",
          relatedEntityId: planned.id,
          referenceId: planned.id,
          referenceFolio: planned.data.beneficiaryFolio || planned.id,
          referenceType: "beneficiary",
          description: `Beneficiario ${planned.data.beneficiaryFolio || planned.id} creado por dispersion masiva: ${planned.nombre}.`,
          createdBy: uid,
          extra: {
            operadorId,
            accessSource,
            delegatedClientAccessPath,
            massiveBatchId: batchRef.id,
          },
        });
      }

      for (const planned of plannedMethodsByKey.values()) {
        tx.set(planned.ref, planned.data);

        logActivityTx(tx, db, {
          event: "BENEFICIARIO_METODO_CREADO",
          rootId,
          adminId: clientAdminId,
          actorUid: uid,
          actorUsername,
          actorRole: role,
          entityType: "CLIENT",
          entityId: clienteId,
          relatedEntityType: "beneficiary",
          relatedEntityId: planned.data.beneficiaryId || null,
          referenceId: planned.id,
          referenceFolio: planned.data.beneficiaryId || planned.id,
          referenceType: "beneficiaryMethod",
          description: `Metodo ${planned.data.tipo}/${planned.data.destinationKind} creado por dispersion masiva para ${planned.data.beneficiaryNombre}.`,
          createdBy: uid,
          extra: {
            operadorId,
            accessSource,
            delegatedClientAccessPath,
            massiveBatchId: batchRef.id,
          },
        });
      }

      // Fase 2: solo escrituras; no agregar lecturas Firestore aqui.
      for (const preparedRow of preparedRows) {
        const item = preparedRow.item;
        const dispersionRef = preparedRow.dispersionRef;
        const sequenceNumber = preparedRow.sequenceNumber;
        const folio = preparedRow.folio;
        const operationTypeKey =
          preparedRow.operationTypeKey;
        const dispersionConcept =
          preparedRow.dispersionConcept;

        const financial =
          applyCanonicalDispersionFinancialsTx({
            tx,
            db,
            prepared: preparedRow.preparedFinancials,
            clientAccountCurrent:
              preparedRow.clientAccountCurrent,
            clientId: clienteId,
            clientName: clienteNombre,
            dispersionId: dispersionRef.id,
            folio,
            empresaId: item.empresaId,
            asociadoId: item.asociadoId,
            beneficiaryId: item.beneficiaryId,
            beneficiaryNombre: item.beneficiaryNombre,
            methodId: item.methodId,
            methodTipo: item.methodTipo,
            destinationKind: item.destinationKind,
            bankName: item.bankName,
            createdBy: uid,
            actorUsername,
            principalConcept: dispersionConcept,
          });

        tx.set(dispersionRef, {
          rootId,
          clienteId,
          clientId: clienteId,
          clienteNombre,
          adminId: clientAdminId,
          actorUid: uid,
          actorRole: role,
          accessSource,
          delegatedClientAccessPath,
          folio,
          referenceFolio: folio,
          dispersionFolio: folio,
          sourceFolio: folio,
          operationalReference: folio,
          displayConcept: dispersionConcept,
          folioVersion: 1,
          sequenceNumber,
          sequenceScope:
            `dispersions:${rootId}:C${clientNumber}:U${userNumber}`,
          sequenceCounterPath: counterPath,
          clientNumber,
          userNumber,
          operadorId,
          empresaId: item.empresaId,
          asociadoId: item.asociadoId,
          beneficiaryId: item.beneficiaryId,
          beneficiaryNombre: item.beneficiaryNombre,
          methodId: item.methodId,
          methodTipo: item.methodTipo,
          destinationKind: item.destinationKind,
          bankCode: item.bankCode || null,
          bankName: item.bankName || null,
          clabe:
            item.destinationKind === "CLABE"
              ? item.clabe
              : null,
          cardNumber:
            item.destinationKind === "TARJETA"
              ? item.cardNumber
              : null,
          despachoId:
            item.despachoId || despachoId,
          operationTypeKey,
          operationTypeName:
            financial.pricing.operationTypeName,
          amount: item.amount,
          clientChargeAmount:
            financial.pricing.clientChargeAmount,
          totalClientDebitAmount:
            financial.pricing.totalClientDebitAmount,
          despachoCostAmount:
            financial.pricing.despachoCostAmount,
          superadminEarningAmount:
            financial.pricing.superadminEarningAmount,
          adminEarningAmount:
            financial.pricing.adminEarningAmount,
          operadorEarningAmount:
            financial.pricing.operadorEarningAmount,
          totalEarningsAmount:
            financial.pricing.totalEarningsAmount,
          pricingSnapshot: financial.pricingSnapshot,
          financialSnapshotId: dispersionRef.id,
          earningsDistributionId:
            `DISPERSION__${dispersionRef.id}`,
          status: "REGISTRADA",
          note: item.note,
          reference: item.reference,
          balanceMovementId:
            financial.principalMovementId,
          principalMovementId:
            financial.principalMovementId,
          commissionMovementId:
            financial.commissionMovementId,
          earningMovementIds:
            financial.earningMovementIds,
          massiveBatchId: batchRef.id,
          massiveRowNumber: item.rowNumber,
          autoCreatedBeneficiary:
            Boolean(item.beneficiaryWasCreated),
          autoCreatedMethod:
            Boolean(item.methodWasCreated),
          createdBy: uid,
          createdUsername: actorUsername,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        const forwardOnlyResult =
          applyForwardOnlyDispersionTx({
            tx,
            db,
            prepared:
              preparedRow.preparedForwardOnlyDispersion,
            dispersionRef,
            folio,
            createdBy: uid,
            actorUsername,
            operationTypeKey,
          });

        tx.set(
          dispersionRef,
          forwardOnlyResult.principalPatch,
          { merge: true },
        );

        logActivityTx(tx, db, {
          event: "DISPERSION_REGISTRADA",
          rootId,
          adminId: clientAdminId,
          actorUid: uid,
          actorUsername,
          actorRole: role,
          entityType: "CLIENT",
          entityId: clienteId,
          amount:
            financial.pricing.totalClientDebitAmount,
          referenceId: dispersionRef.id,
          referenceFolio: folio,
          referenceType: "DISPERSION",
          description:
            `Dispersion ${folio} registrada por carga masiva para ${item.beneficiaryNombre}.`,
          createdBy: uid,
          extra: {
            accessSource,
            delegatedClientAccessPath,
            massiveBatchId: batchRef.id,
            rowNumber: item.rowNumber,
            beneficiaryId: item.beneficiaryId,
            methodId: item.methodId,
            despachoId:
              item.despachoId || despachoId,
            operationTypeKey,
            requestedAmount: item.amount,
            clientChargeAmount:
              financial.pricing.clientChargeAmount,
            totalClientDebitAmount:
              financial.pricing.totalClientDebitAmount,
            totalEarningsAmount:
              financial.pricing.totalEarningsAmount,
            beneficiaryWasCreated:
              Boolean(item.beneficiaryWasCreated),
            methodWasCreated:
              Boolean(item.methodWasCreated),
          },
        });

        created.push({
          rowNumber: item.rowNumber,
          dispersionId: dispersionRef.id,
          movementId: financial.principalMovementId,
          folio,
          amount: item.amount,
          beforeBalance: financial.beforeBalance,
          afterBalance: financial.afterBalance,
        });
      }

      tx.set(
        counterRef,
        {
          rootId,
          scope: "dispersions",
          scopeKey: `cliente_${clienteId}__usuario_${uid}`,
          value: sequenceEnd,
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: counterSnap.exists
            ? (counterSnap.data() as any)?.createdAt || FieldValue.serverTimestamp()
            : FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      tx.set(batchRef, {
        rootId,
        clienteId,
        clientId: clienteId,
        clienteNombre,
        adminId: clientAdminId,
        operadorId,
        actorUid: uid,
        actorRole: role,
        accessSource,
        delegatedClientAccessPath,
        totalRows: candidates.length,
        validRows: processable.length,
        skippedRowsCount: skippedRows.length,
        totalAmount,
        beforeBalance: beforeBatchBalance,
        afterBalance: batchAfterBalance,
        sequenceStart,
        sequenceEnd,
        beneficiariesCreated,
        methodsCreated,
        skippedRows,
        status: "CREADA",
        createdBy: uid,
        createdUsername: actorUsername,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      result = {
        batchId: batchRef.id,
        created,
        beforeBalance: beforeBatchBalance,
        afterBalance: batchAfterBalance,
        totalAmount,
        sequenceStart,
        sequenceEnd,
        sequenceCounterPath: counterPath,
        beneficiariesCreated,
        methodsCreated,
        skippedRows,
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
      batchId: result?.batchId || batchRef.id,
      clienteId,
      totalRows: candidates.length,
      createdCount: result?.created.length || 0,
      skippedCount: result?.skippedRows.length || skippedRows.length,
      beneficiariesCreated: result?.beneficiariesCreated || 0,
      methodsCreated: result?.methodsCreated || 0,
      totalAmount: result?.totalAmount || 0,
      beforeBalance: result?.beforeBalance ?? null,
      afterBalance: result?.afterBalance ?? null,
      sequenceStart: result?.sequenceStart || null,
      sequenceEnd: result?.sequenceEnd || null,
      sequenceCounterPath: result?.sequenceCounterPath || null,
      dispersions: result?.created || [],
      skippedRows: result?.skippedRows || skippedRows,
    };
  }
);

export const requestClientDispersionIncident = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = String(request.auth?.uid || "").trim();
    if (!uid) {
      throw new HttpsError("unauthenticated", "Usuario no autenticado.");
    }

    const data = request.data || {};
    const dispersionId = String(data.dispersionId || "").trim();
    const incidentType = String(data.incidentType || "").trim().toUpperCase();
    const reason = String(data.reason || `Incidencia ${incidentType}`).trim();
    const note = String(data.note || "").trim() || null;

    if (!dispersionId) {
      throw new HttpsError("invalid-argument", "dispersionId requerido.");
    }

    if (!["DEVOLUCION", "CANCELACION"].includes(incidentType)) {
      throw new HttpsError("invalid-argument", "incidentType invalido.");
    }

    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) {
      throw new HttpsError("permission-denied", "Perfil de usuario no encontrado.");
    }

    const profile = userSnap.data() || {};
    assertAuthorized(request.auth, profile, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "wallet", requiredAction: "dispersiones" });
    const role = String(profile.role || "").trim().toLowerCase();
    const rootId = String(profile.rootId || uid).trim();
    const actorUsername = String(
      profile.username ||
      profile.actorUsername ||
      profile.displayName ||
      request.auth?.token?.email ||
      uid
    ).trim();

    const dispersionRef = db.doc(`clientDispersions/${dispersionId}`);
    const dispersionSnap = await dispersionRef.get();

    if (!dispersionSnap.exists) {
      throw new HttpsError("not-found", "Dispersion no encontrada.");
    }

    const dispersion = dispersionSnap.data() || {};
    const dispersionRootId = String(dispersion.rootId || "").trim();
    const dispersionAdminId = String(dispersion.adminId || "").trim();
    const dispersionOperadorId = String(dispersion.operadorId || "").trim();
    const dispersionCreatedBy = String(dispersion.createdBy || "").trim();

    if (dispersionRootId && dispersionRootId !== rootId) {
      throw new HttpsError("permission-denied", "Dispersion fuera de alcance.");
    }

    const dispersionClientId = String(dispersion.clienteId || dispersion.clientId || "").trim();
    if (!dispersionClientId) {
      throw new HttpsError("failed-precondition", "Dispersion sin cliente asociado.");
    }

    await requireClientOperationalAccess({
      uid,
      role: role === "operator" ? "operador" : (role as any),
      rootId,
      clientId: dispersionClientId,
      permission: "requestDispersionIncidents",
      errorMessage: "No autorizado para solicitar incidencias de esta dispersion.",
    });

    const currentStatus = String(dispersion.status || "").trim().toUpperCase();
    if (currentStatus !== "REGISTRADA") {
      throw new HttpsError("failed-precondition", "Solo se pueden solicitar incidencias sobre dispersiones REGISTRADAS.");
    }

    const currentIncidentStatus = String(dispersion.incidentStatus || "").trim().toUpperCase();
    if (currentIncidentStatus === "SOLICITADA") {
      throw new HttpsError("failed-precondition", "La dispersion ya tiene una incidencia solicitada.");
    }

    await dispersionRef.set(
      {
        incidentStatus: "SOLICITADA",
        incidentType,
        incidentReason: reason,
        incidentNote: note,
        incidentRequestedBy: uid,
        incidentRequestedRole: role,
        incidentRequestedUsername: actorUsername,
        incidentRequestedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await logActivity({
      event: "DISPERSION_INCIDENCIA_SOLICITADA",
      rootId: dispersionRootId || rootId,
      adminId: dispersionAdminId || null,
      actorUid: uid,
      actorUsername,
      actorRole: role,
      entityType: "DISPERSION",
      entityId: dispersionId,
      amount: Number(dispersion.amount || 0),
      referenceId: dispersionId,
      referenceFolio: String(dispersion.folio || dispersionId),
      referenceType: "DISPERSION",
      description: `Incidencia ${incidentType} solicitada para dispersion ${String(dispersion.folio || dispersionId)}.`,
      createdBy: uid,
      extra: {
        note: note || reason,
        operadorId: dispersionOperadorId || null,
        incidentType,
      },
    });

    return {
      ok: true,
      dispersionId,
      status: "REGISTRADA",
      incidentStatus: "SOLICITADA",
      incidentType,
    };
  }
);
export const resolveClientDispersionIncident = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = String(request.auth?.uid || "").trim();
    if (!uid) {
      throw new HttpsError("unauthenticated", "Usuario no autenticado.");
    }

    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) {
      throw new HttpsError("permission-denied", "Perfil de usuario no encontrado.");
    }

    const profile = userSnap.data() || {};
    assertAuthorized(request.auth, profile, { allowedRoles: ["superadmin"], requiredModule: "wallet", requiredAction: "dispersiones" });
    const role = String(profile.role || "").trim().toLowerCase();
    if (role !== "superadmin") {
      throw new HttpsError("permission-denied", "Solo superadmin puede resolver incidencias.");
    }

    const data = request.data || {};
    const dispersionId = String(data.dispersionId || "").trim();
    const decision = String(data.decision || "").trim().toUpperCase();
    const resolutionNote = String(data.resolutionNote || `Resolucion ${decision}`).trim();

    if (!dispersionId) {
      throw new HttpsError("invalid-argument", "dispersionId requerido.");
    }
    if (!["RECHAZADA", "DEVOLUCION_APLICADA", "CANCELACION_APLICADA"].includes(decision)) {
      throw new HttpsError("invalid-argument", "decision invalida.");
    }

    const actorUsername = String(
      profile.username ||
      profile.actorUsername ||
      profile.displayName ||
      request.auth?.token?.email ||
      uid
    ).trim();
    const rootId = String(profile.rootId || uid).trim();

    const dispersionRef = db.doc(`clientDispersions/${dispersionId}`);

    let result:
      | {
          decision: string;
          reintegrated: boolean;
          reintegrationMovementId: string | null;
          beforeBalance: number | null;
          afterBalance: number | null;
          reintegrationAmount: number;
          reversedEarningsAmount: number;
          reversalMovementIds: Record<string, string>;
        }
      | undefined;

    await db.runTransaction(async (tx) => {
      const dispersionSnap = await tx.get(dispersionRef);
      if (!dispersionSnap.exists) {
        throw new HttpsError("not-found", "Dispersion no encontrada.");
      }

      const dispersion = dispersionSnap.data() || {};
      const currentStatus = String(dispersion.status || "").trim().toUpperCase();
      const currentIncidentStatus = String(dispersion.incidentStatus || "").trim().toUpperCase();

      if (currentStatus !== "REGISTRADA") {
        throw new HttpsError("failed-precondition", "Solo se pueden resolver dispersiones REGISTRADAS.");
      }
      if (currentIncidentStatus !== "SOLICITADA") {
        throw new HttpsError("failed-precondition", "La dispersion no tiene una incidencia solicitada.");
      }

      const clienteId = String(dispersion.clienteId || "").trim();
      const clienteNombre = String(dispersion.clienteNombre || clienteId).trim();
      const amount = Number(dispersion.amount || 0);
      const incidentType = String(dispersion.incidentType || "").trim().toUpperCase();

      const decisionMatchesIncident =
        decision === "RECHAZADA" ||
        
        (incidentType === "DEVOLUCION" && decision === "DEVOLUCION_APLICADA") ||
        (incidentType === "CANCELACION" && decision === "CANCELACION_APLICADA");

      if (!decisionMatchesIncident) {
        throw new HttpsError("failed-precondition", `Decision ${decision} incompatible con incidencia ${incidentType}.`);
      }

      const isMoneyReintegration =
        decision === "DEVOLUCION_APLICADA" ||
        decision === "CANCELACION_APLICADA";

      if (isMoneyReintegration && (!Number.isFinite(amount) || amount <= 0)) {
        throw new HttpsError("failed-precondition", "Monto de dispersion invalido para reintegro.");
      }

      const nextDispersionStatus =
        decision === "DEVOLUCION_APLICADA"
          ? "DEVUELTA"
          : decision === "CANCELACION_APLICADA"
            ? "CANCELADA"
            : "REGISTRADA";

      const dispersionRootId = String(dispersion.rootId || rootId).trim();
      const dispersionAdminId = String(dispersion.adminId || "").trim() || null;
      const dispersionOperadorId = String(dispersion.operadorId || "").trim() || null;
      const folio = String(dispersion.folio || dispersionId).trim();

      let reintegrated = false;
      let reintegrationMovementId: string | null = null;
      let beforeBalance: number | null = null;
      let afterBalance: number | null = null;

      let reintegrationAmount = 0;
      let reversedEarningsAmount = 0;
      let reversalMovementIds:
        Record<string, string> = {};

      if (isMoneyReintegration) {
        const reversal =
          await reverseCanonicalDispersionFinancialsTx({
            tx,
            db,
            dispersion,
            dispersionId,
            actorUid: uid,
            actorUsername,
            decision,
          });

        reintegrated =
          reversal.reintegrated;
        reintegrationMovementId =
          reversal.reintegrationMovementId;
        beforeBalance =
          reversal.beforeBalance;
        afterBalance =
          reversal.afterBalance;
        reintegrationAmount =
          reversal.reintegrationAmount;
        reversedEarningsAmount =
          reversal.reversedEarningsAmount;
        reversalMovementIds =
          reversal.reversalMovementIds;
      }

      tx.set(
        dispersionRef,
        {
          status: nextDispersionStatus,
          incidentStatus: "RESUELTA",
          incidentDecision: decision,
          incidentResolvedBy: uid,
          incidentResolvedRole: role,
          incidentResolvedUsername: actorUsername,
          incidentResolvedAt: FieldValue.serverTimestamp(),
          incidentResolutionNote: resolutionNote,
          reintegrated,
          reintegrationMovementId,
          reintegrationAmount,
          reversedEarningsAmount,
          reversalMovementIds,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      logActivityTx(tx, db, {
        event: "DISPERSION_INCIDENCIA_RESUELTA",
        rootId: dispersionRootId,
        adminId: dispersionAdminId,
        actorUid: uid,
        actorUsername,
        actorRole: role,
        entityType: "DISPERSION",
        entityId: dispersionId,
        referenceId: dispersionId,
        referenceFolio: folio,
        referenceType: "DISPERSION",
        amount:
          isMoneyReintegration
            ? reintegrationAmount
            : amount,
        description: `Incidencia ${incidentType} resuelta como ${decision} para dispersion ${folio}.`,
        createdBy: uid,
        extra: {
          note: resolutionNote,
          operadorId: dispersionOperadorId || null,
          incidentType,
          incidentDecision: decision,
          reintegrated,
          reintegrationMovementId,
          reintegrationAmount,
          reversedEarningsAmount,
          reversalMovementIds,
        },
      });

      result = {
        decision,
        reintegrated,
        reintegrationMovementId,
        beforeBalance,
        afterBalance,
        reintegrationAmount,
        reversedEarningsAmount,
        reversalMovementIds,
      };
    });

    return {
      ok: true,
      dispersionId,
      decision: result?.decision || "RECHAZADA",
      reintegrated: result?.reintegrated || false,
      reintegrationMovementId: result?.reintegrationMovementId || null,
      beforeBalance: result?.beforeBalance ?? null,
      afterBalance: result?.afterBalance ?? null,
      reintegrationAmount:
        result?.reintegrationAmount ?? 0,
      reversedEarningsAmount:
        result?.reversedEarningsAmount ??
        0,
      reversalMovementIds:
        result?.reversalMovementIds || {},
    };
  }
);

export const addClientDispersionNota = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = String(request.auth?.uid || "").trim();
    if (!uid) {
      throw new HttpsError("unauthenticated", "Usuario no autenticado.");
    }

    const data = request.data || {};
    const dispersionId = String(data.dispersionId || "").trim();
    const text = String(data.text || "").trim();

    if (!dispersionId) {
      throw new HttpsError("invalid-argument", "dispersionId requerido.");
    }

    if (!text) {
      throw new HttpsError("invalid-argument", "text requerido.");
    }

    if (text.length > 2000) {
      throw new HttpsError("invalid-argument", "La nota no puede exceder 2000 caracteres.");
    }

    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) {
      throw new HttpsError("permission-denied", "Perfil de usuario no encontrado.");
    }

    const profile = userSnap.data() || {};
    assertAuthorized(request.auth, profile, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "wallet", requiredAction: "dispersiones" });
    const role = String(profile.role || "").trim().toLowerCase();
    const rootId = String(profile.rootId || uid).trim();
    const actorUsername = String(
      profile.username ||
      profile.actorUsername ||
      profile.displayName ||
      request.auth?.token?.email ||
      uid
    ).trim();

    const dispersionRef = db.doc(`clientDispersions/${dispersionId}`);
    const dispersionSnap = await dispersionRef.get();

    if (!dispersionSnap.exists) {
      throw new HttpsError("not-found", "Dispersion no encontrada.");
    }

    const dispersion = dispersionSnap.data() || {};
    const dispersionRootId = String(dispersion.rootId || "").trim();
    const dispersionAdminId = String(dispersion.adminId || "").trim();
    const dispersionOperadorId = String(dispersion.operadorId || "").trim();
    const dispersionCreatedBy = String(dispersion.createdBy || "").trim();

    if (dispersionRootId && dispersionRootId !== rootId) {
      throw new HttpsError("permission-denied", "Dispersion fuera de alcance.");
    }

    const dispersionClientId = String(dispersion.clienteId || dispersion.clientId || "").trim();
    if (!dispersionClientId) {
      throw new HttpsError("failed-precondition", "Dispersion sin cliente asociado.");
    }

    await requireClientOperationalAccess({
      uid,
      role: role === "operator" ? "operador" : (role as any),
      rootId,
      clientId: dispersionClientId,
      permission: "commentDispersionNotes",
      errorMessage: "No autorizado para comentar esta dispersion.",
    });

    const now = FieldValue.serverTimestamp();

    const noteRef = await dispersionRef.collection("notas").add({
      text,
      createdBy: uid,
      createdByRole: role,
      createdByName: actorUsername,
      actorUsername,
      rootId: dispersionRootId || rootId,
      adminId: dispersionAdminId || null,
      operadorId: dispersionOperadorId || null,
      clienteId: String(dispersion.clienteId || "").trim() || null,
      dispersionId,
      folio: String(dispersion.folio || dispersionId).trim(),
      sourceModule: "FINANCING",
      entityType: "DISPERSION",
      entityId: dispersionId,
      createdAt: now,
    });

    await dispersionRef.set(
      {
        hasUnreadMsg: true,
        updatedAt: now,
      },
      { merge: true }
    );

    return {
      ok: true,
      dispersionId,
      noteId: noteRef.id,
    };
  }
);
