import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue, type DocumentData, type DocumentSnapshot } from "firebase-admin/firestore";
import { buildPagoCoverageApplyPatch, getPagoCoverageState } from "../deposits/foundation";
import { normalizePagoStatus } from "../pagos/domain";
import { money2 } from "../shared/money";
import {
  applySolicitudCoverageAmount,
  getSolicitudCoverageState,
  normalizeSolicitudBackendStatus,
} from "../solicitudes/domain";
import { logActivityTx } from "../../utils/logActivity";
import { db } from "../sharedCallables/helpers";
import { requireClientOperationalAccess } from "../clientDelegations/access";
import {
  reserveSequenceRangeTx,
  buildCanonicalFolio,
} from "../sequences/service";
import {
  resolveCanonicalBusinessFolioContext,
  buildCanonicalBusinessFolioParts,
} from "../sequences/businessFolioContext";
import {
  PAYMENT_APPLICATION_VERSION,
  normalizePaymentApplicationInvoiceType,
  buildPaymentApplicationSettlementPolicy,
  type NormalizedPaymentApplicationBatch,
  buildPaymentApplicationActivityId,
  buildPaymentApplicationDocumentId,
  buildPaymentApplicationLedgerId,
  buildPaymentApplicationNoteId,
  buildPaymentApplicationReservationId,
} from "./domain";

export type PaymentApplicationActor = {
  uid: string;
  rootId: string;
  role: "superadmin" | "admin" | "operador";
  adminId: string;
  displayName: string;
  username: string;
};

type ReservationResult = {
  ok: true;
  reservationId: string;
  requestHash: string;
  status: "RESERVED" | "APPLIED";
  reused: boolean;
  iqExecutionStatus: "NOT_REQUESTED";
  iqActionExecuted: false;
  result?: Record<string, any> | null;
};



function assertRootScope(entity: DocumentData, rootId: string): void {
  if (String(entity?.rootId || "") !== rootId) {
    throw new HttpsError("permission-denied", "No autorizado.");
  }
}

async function requirePaymentApplicationClientAccess(
  actor: PaymentApplicationActor,
  pagoId: string,
) {
  const pagoSnap = await db.collection("pagos").doc(pagoId).get();

  if (!pagoSnap.exists) {
    throw new HttpsError("not-found", "Pago no existe.");
  }

  const pago = pagoSnap.data() || {};
  assertRootScope(pago, actor.rootId);

  const clientId = String(pago?.clienteId || pago?.clientId || "").trim();

  if (!clientId) {
    throw new HttpsError(
      "failed-precondition",
      "El pago no tiene cliente canonico asociado.",
    );
  }

  return requireClientOperationalAccess({
    uid: actor.uid,
    role: actor.role,
    rootId: actor.rootId,
    clientId,
    permission: "operatePagos",
    errorMessage: "No autorizado para aplicar pagos de este cliente.",
  });
}

function assertEntityOwnership(
  entity: DocumentData,
  actor: PaymentApplicationActor,
  entityLabel: string,
): void {
  const adminId = String(entity?.adminId || "").trim();
  const createdBy = String(entity?.createdBy || "").trim();

  if (actor.role === "admin" && adminId && adminId !== actor.uid) {
    throw new HttpsError(
      "permission-denied",
      `No autorizado para aplicar ${entityLabel}.`,
    );
  }

  if (actor.role === "operador") {
    if (adminId && adminId !== actor.adminId) {
      throw new HttpsError(
        "permission-denied",
        `No autorizado para aplicar ${entityLabel}.`,
      );
    }
    if (createdBy && createdBy !== actor.uid) {
      throw new HttpsError(
        "permission-denied",
        `No autorizado para aplicar ${entityLabel}.`,
      );
    }
  }
}

function assertPagoSolicitudMatch(pago: DocumentData, solicitud: DocumentData): void {
  const pagoClienteId = String(pago?.clienteId || "").trim();
  const solicitudClienteId = String(solicitud?.clienteId || "").trim();
  const pagoClienteNombre = String(pago?.clienteNombre || "").trim().toLowerCase();
  const solicitudClienteNombre = String(solicitud?.clienteNombre || "").trim().toLowerCase();

  if (pagoClienteId && solicitudClienteId && pagoClienteId !== solicitudClienteId) {
    throw new HttpsError(
      "failed-precondition",
      "La solicitud no pertenece al cliente del pago.",
    );
  }

  if (
    !solicitudClienteId &&
    pagoClienteNombre &&
    solicitudClienteNombre &&
    pagoClienteNombre !== solicitudClienteNombre
  ) {
    throw new HttpsError(
      "failed-precondition",
      "La solicitud no coincide con el cliente del pago.",
    );
  }

  const pagoCompanyId = String(pago?.companyId || "").trim();
  const solicitudCompanyId = String(solicitud?.companyId || "").trim();
  const pagoEmpresaNombre = String(pago?.empresaNombre || "").trim().toLowerCase();
  const solicitudEmpresaNombre = String(solicitud?.empresaNombre || "").trim().toLowerCase();

  if (!pagoCompanyId && !pagoEmpresaNombre) {
    throw new HttpsError("failed-precondition", "El pago no tiene empresa definida.");
  }

  if (!solicitudCompanyId && !solicitudEmpresaNombre) {
    throw new HttpsError("failed-precondition", "La solicitud no tiene empresa definida.");
  }

  if (pagoCompanyId && solicitudCompanyId && pagoCompanyId !== solicitudCompanyId) {
    throw new HttpsError(
      "failed-precondition",
      "La solicitud no pertenece a la empresa del pago.",
    );
  }

  if (
    (!pagoCompanyId || !solicitudCompanyId) &&
    pagoEmpresaNombre &&
    solicitudEmpresaNombre &&
    pagoEmpresaNombre !== solicitudEmpresaNombre
  ) {
    throw new HttpsError(
      "failed-precondition",
      "La solicitud no coincide con la empresa del pago.",
    );
  }
}

function assertReservationCompatible(
  reservation: DocumentData,
  actor: PaymentApplicationActor,
  batch: NormalizedPaymentApplicationBatch,
): void {
  if (String(reservation?.rootId || "") !== actor.rootId) {
    throw new HttpsError("permission-denied", "Reserva fuera del alcance autorizado.");
  }

  if (String(reservation?.pagoId || "") !== batch.pagoId) {
    throw new HttpsError(
      "already-exists",
      "La llave idempotente ya fue usada para otro pago.",
    );
  }

  if (String(reservation?.requestHash || "") !== batch.requestHash) {
    throw new HttpsError(
      "already-exists",
      "La llave idempotente ya fue usada con un lote diferente.",
    );
  }

  const createdBy = String(reservation?.createdBy || "").trim();
  if (createdBy && createdBy !== actor.uid && actor.role !== "superadmin") {
    throw new HttpsError(
      "permission-denied",
      "La reserva idempotente pertenece a otro usuario.",
    );
  }
}

function buildReservationPayload(params: {
  actor: PaymentApplicationActor;
  batch: NormalizedPaymentApplicationBatch;
  status: "RESERVED" | "APPLIED";
  result?: Record<string, any> | null;
}) {
  const { actor, batch, status } = params;
  return {
    version: PAYMENT_APPLICATION_VERSION,
    rootId: actor.rootId,
    adminId: actor.adminId,
    pagoId: batch.pagoId,
    idempotencyKey: batch.idempotencyKey,
    requestHash: batch.requestHash,
    applications: batch.applications,
    applicationCount: batch.applications.length,
    totalAmount: batch.totalAmount,
    status,
    iqExecutionStatus: "NOT_REQUESTED",
    iqActionExecuted: false,
    createdBy: actor.uid,
    createdByRole: actor.role,
    createdByName: actor.displayName,
    updatedAt: FieldValue.serverTimestamp(),
    ...(status === "RESERVED" ? { reservedAt: FieldValue.serverTimestamp() } : {}),
    ...(status === "APPLIED"
      ? {
          appliedAt: FieldValue.serverTimestamp(),
          result: params.result || null,
        }
      : {}),
  };
}

function reservationResultFromSnapshot(
  reservationId: string,
  reservation: DocumentData,
  reused: boolean,
): ReservationResult {
  const status = String(reservation?.status || "RESERVED") === "APPLIED"
    ? "APPLIED"
    : "RESERVED";
  return {
    ok: true,
    reservationId,
    requestHash: String(reservation?.requestHash || ""),
    status,
    reused,
    iqExecutionStatus: "NOT_REQUESTED",
    iqActionExecuted: false,
    result: reservation?.result || null,
  };
}

export async function reservePaymentApplicationBatch(params: {
  actor: PaymentApplicationActor;
  batch: NormalizedPaymentApplicationBatch;
}): Promise<ReservationResult> {
  const { actor, batch } = params;
  const reservationId = buildPaymentApplicationReservationId({
    rootId: actor.rootId,
    pagoId: batch.pagoId,
    idempotencyKey: batch.idempotencyKey,
  });
  const reservationRef = db.collection("pagoApplicationReservations").doc(reservationId);
  const pagoRef = db.collection("pagos").doc(batch.pagoId);

  await requirePaymentApplicationClientAccess(actor, batch.pagoId);
  return db.runTransaction(async (tx) => {
    const reservationSnap = await tx.get(reservationRef);
    const pagoSnap = await tx.get(pagoRef);

    if (!pagoSnap.exists) {
      throw new HttpsError("not-found", "Pago no existe.");
    }

    const pago = pagoSnap.data() || {};
    assertRootScope(pago, actor.rootId);

    if (reservationSnap.exists) {
      const reservation = reservationSnap.data() || {};
      assertReservationCompatible(reservation, actor, batch);
      return reservationResultFromSnapshot(reservationId, reservation, true);
    }

    tx.set(reservationRef, {
      ...buildReservationPayload({ actor, batch, status: "RESERVED" }),
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      ok: true,
      reservationId,
      requestHash: batch.requestHash,
      status: "RESERVED",
      reused: false,
      iqExecutionStatus: "NOT_REQUESTED",
      iqActionExecuted: false,
      result: null,
    };
  });
}

export async function applyPaymentApplicationBatchAtomic(params: {
  actor: PaymentApplicationActor;
  batch: NormalizedPaymentApplicationBatch;
}): Promise<ReservationResult> {
  const { actor, batch } = params;
  const reservationId = buildPaymentApplicationReservationId({
    rootId: actor.rootId,
    pagoId: batch.pagoId,
    idempotencyKey: batch.idempotencyKey,
  });
  const reservationRef = db.collection("pagoApplicationReservations").doc(reservationId);
  const pagoRef = db.collection("pagos").doc(batch.pagoId);
  const solicitudRefs = batch.applications.map((item) =>
    db.collection("solicitudes").doc(item.solicitudId),
  );

  const paymentApplicationAccess = await requirePaymentApplicationClientAccess(actor, batch.pagoId);
  const paymentApplicationFolioContext =
    await resolveCanonicalBusinessFolioContext({
      db,
      rootId: actor.rootId,
      clientId: paymentApplicationAccess.clientId,
      actorUid: actor.uid,
      actorRole: actor.role,
    });
  return db.runTransaction(async (tx) => {
    const reservationSnap = await tx.get(reservationRef);

    if (reservationSnap.exists) {
      const reservation = reservationSnap.data() || {};
      assertReservationCompatible(reservation, actor, batch);
      if (String(reservation?.status || "") === "APPLIED") {
        return reservationResultFromSnapshot(reservationId, reservation, true);
      }
    }

    const pagoSnap = await tx.get(pagoRef);
    const solicitudSnaps: DocumentSnapshot[] = [];
    for (const solicitudRef of solicitudRefs) {
      solicitudSnaps.push(await tx.get(solicitudRef));
    }

    if (!pagoSnap.exists) {
      throw new HttpsError("not-found", "Pago no existe.");
    }

    const pago = pagoSnap.data() || {};
    assertRootScope(pago, actor.rootId);

    const pagoStatus = normalizePagoStatus(pago?.status);
    if (!["CONCILIADO", "APLICADO_PARCIAL"].includes(pagoStatus)) {
      throw new HttpsError(
        "failed-precondition",
        "El pago debe estar conciliado antes de aplicarse.",
      );
    }

    const coverage = getPagoCoverageState(pago);
    if (coverage.available <= 0) {
      throw new HttpsError(
        "failed-precondition",
        "El pago ya no tiene saldo disponible.",
      );
    }

    if (batch.totalAmount > coverage.available) {
      throw new HttpsError(
        "failed-precondition",
        "La suma del lote excede el saldo disponible del pago.",
      );
    }

    const pagoCompanyId = String(
      pago?.companyId || pago?.empresaId || "",
    ).trim();

    if (!pagoCompanyId) {
      throw new HttpsError(
        "failed-precondition",
        "El pago no tiene empresa canonica asociada.",
      );
    }

    const companySnap = await tx.get(
      db.collection("companies").doc(pagoCompanyId),
    );

    if (!companySnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "La empresa del pago no existe.",
      );
    }

    const company = companySnap.data() || {};
    assertRootScope(company, actor.rootId);

    if (company?.active === false) {
      throw new HttpsError(
        "failed-precondition",
        "La empresa del pago esta inactiva.",
      );
    }

    const paymentApplicationCompanyNumber = Number(
      company?.companyNumber ??
        company?.numeroEmpresa ??
        company?.sequenceNumber ??
        0,
    );

    if (
      !Number.isFinite(paymentApplicationCompanyNumber) ||
      paymentApplicationCompanyNumber <= 0
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Numero canonico de empresa faltante para la aplicacion.",
      );
    }

    const applicationSequenceRange = await reserveSequenceRangeTx({
      db,
      tx,
      rootId: actor.rootId,
      scope: "paymentApplications",
      scopeKey:
        `cliente_${paymentApplicationFolioContext.clientId}` +
        `__usuario_${paymentApplicationFolioContext.ownerUid}` +
        `__empresa_${pagoCompanyId}`,
      count: batch.applications.length,
    });

    const applicationResults: Array<Record<string, any>> = [];
    const completedSolicitudIds: string[] = [];
    const paymentFolio = String(pago?.folio || pago?.pagoFolio || batch.pagoId).trim() || batch.pagoId;

    for (let index = 0; index < batch.applications.length; index += 1) {
      const requested = batch.applications[index];
      const solicitudSnap = solicitudSnaps[index];

      if (!solicitudSnap.exists) {
        throw new HttpsError(
          "not-found",
          `Solicitud ${requested.solicitudId} no existe.`,
        );
      }

      const solicitud = solicitudSnap.data() || {};
      assertRootScope(solicitud, actor.rootId);
      assertPagoSolicitudMatch(pago, solicitud);

      const solicitudStatus = normalizeSolicitudBackendStatus(solicitud?.status);
      if (solicitudStatus === "COMPLETADA") {
        throw new HttpsError(
          "failed-precondition",
          `La solicitud ${requested.solicitudId} ya no esta pendiente.`,
        );
      }

      if (["RECHAZADA", "CANCELADA", "ELIMINADA"].includes(solicitudStatus)) {
        throw new HttpsError(
          "failed-precondition",
          `La solicitud ${requested.solicitudId} no esta apta para pago.`,
        );
      }

      const coverage = getSolicitudCoverageState(solicitud);
      const solicitudMonto = coverage.total;
      const pendienteActual = coverage.pending;

      if (pendienteActual <= 0) {
        throw new HttpsError(
          "failed-precondition",
          `La solicitud ${requested.solicitudId} ya no tiene saldo pendiente.`,
        );
      }

      if (requested.montoAplicado > pendienteActual) {
        throw new HttpsError(
          "failed-precondition",
          `El monto para la solicitud ${requested.solicitudId} excede su saldo pendiente.`,
        );
      }

      const applicationState = applySolicitudCoverageAmount(solicitud, requested.montoAplicado);
      const nuevoAbonado = applicationState.applied;
      const nuevoPendiente = applicationState.pending;
      const numeroParcialidad = Math.max(
        1,
        Math.trunc(Number(solicitud?.parcialidadCount || 0)) + 1,
      );
      const nuevoStatusSolicitud = applicationState.status;
      const invoiceType = normalizePaymentApplicationInvoiceType(
        solicitud?.tipoFactura ?? solicitud?.invoiceType,
      );
      const settlementDecision = invoiceType
        ? buildPaymentApplicationSettlementPolicy({
            invoiceType,
            balanceAfter: nuevoPendiente,
          })
        : null;
      const applicationId = buildPaymentApplicationDocumentId(
        reservationId,
        requested.solicitudId,
      );
      const applicationSequenceNumber =
        applicationSequenceRange.sequenceNumbers[index];

      if (!applicationSequenceNumber) {
        throw new HttpsError(
          "internal",
          "No se pudo asignar numero canonico a la aplicacion.",
        );
      }

      const applicationFolio = buildCanonicalFolio(
        "AP",
        applicationSequenceNumber,
        buildCanonicalBusinessFolioParts({
          clientNumber: paymentApplicationFolioContext.clientNumber,
          ownerUserNumber: paymentApplicationFolioContext.ownerUserNumber,
          companyNumber: paymentApplicationCompanyNumber,
          delegateUserNumber: paymentApplicationFolioContext.delegateUserNumber,
        }),
      );

      const ledgerId = buildPaymentApplicationLedgerId(applicationId);
      const solicitudFolio = String(
        solicitud?.folio ||
        solicitud?.solicitudFolio ||
        solicitud?.folioSolicitud ||
        requested.solicitudId,
      ).trim() || requested.solicitudId;

      applicationResults.push({
        applicationId,
        folio: applicationFolio,
        sequenceNumber: applicationSequenceNumber,
        pagoId: batch.pagoId,
        solicitudId: requested.solicitudId,
        solicitudFolio,
        montoAplicado: requested.montoAplicado,
        numeroParcialidad,
        saldoAnterior: pendienteActual,
        saldoInsoluto: nuevoPendiente,
        solicitudStatus: nuevoStatusSolicitud,
      });

      if (nuevoPendiente === 0) {
        completedSolicitudIds.push(requested.solicitudId);
      }

      tx.update(solicitudSnap.ref, {
        totalAbonado: nuevoAbonado,
        parcialidadCount: numeroParcialidad,
        status: nuevoStatusSolicitud,
        hasUnreadMsg: true,
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.set(db.collection("pagoAplicaciones").doc(applicationId), {
        version: PAYMENT_APPLICATION_VERSION,
        rootId: actor.rootId,
        adminId: actor.adminId,
        operadorId: actor.role === "operador" ? actor.uid : null,
        pagoId: batch.pagoId,
        solicitudId: requested.solicitudId,
        clientId: paymentApplicationAccess.clientId,
        folio: applicationFolio,
        folioVersion: 1,
        sequenceNumber: applicationSequenceNumber,
        sequenceScope:
          `paymentApplications:${actor.rootId}` +
          `:C${paymentApplicationFolioContext.clientNumber}` +
          `:U${paymentApplicationFolioContext.ownerUserNumber}` +
          `:E${paymentApplicationCompanyNumber}`,
        sequenceCounterPath: applicationSequenceRange.counterPath,
        clientNumber: paymentApplicationFolioContext.clientNumber,
        userNumber: paymentApplicationFolioContext.ownerUserNumber,
        companyNumber: paymentApplicationCompanyNumber,
        folioOwnerUid: paymentApplicationFolioContext.ownerUid,
        accessSource: paymentApplicationFolioContext.accessSource,
        delegatedClientAccessPath:
          paymentApplicationFolioContext.delegatedClientAccessPath,
        delegatedClientAccessId:
          paymentApplicationFolioContext.delegatedClientAccessId,
        delegateUserNumber:
          paymentApplicationFolioContext.delegateUserNumber,
        invoiceType,
        requiresComplement: settlementDecision?.requiresComplement ?? null,
        requiresSameMonthSettlement:
          settlementDecision?.requiresSameMonthSettlement ?? null,
        pueSettlementStatus:
          settlementDecision?.pueSettlementStatus ?? null,
        settlementPolicy:
          settlementDecision?.settlementPolicy ?? null,
        nextStep:
          settlementDecision?.nextStep ?? null,
        montoAplicado: requested.montoAplicado,
        numeroParcialidad,
        saldoAnterior: pendienteActual,
        saldoInsoluto: nuevoPendiente,
        montoTotal: solicitudMonto,
        referenciaAplicacion: applicationId,
        batchReservationId: reservationId,
        requestHash: batch.requestHash,
        status: "APLICADA",
        iqExecutionStatus: "NOT_REQUESTED",
        iqActionExecuted: false,
        createdBy: actor.uid,
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.set(db.collection("ledgerEvents").doc(ledgerId), {
        version: PAYMENT_APPLICATION_VERSION,
        rootId: actor.rootId,
        adminId: actor.adminId,
        operadorId: actor.role === "operador" ? actor.uid : null,
        numeroParcialidad,
        saldoAnterior: pendienteActual,
        saldoInsoluto: nuevoPendiente,
        montoTotal: solicitudMonto,
        referenciaAplicacion: applicationId,
        metodoFactura: solicitud?.tipoFactura || null,
        relatedId: requested.solicitudId,
        pagoId: batch.pagoId,
        pagoAplicacionId: applicationId,
        batchReservationId: reservationId,
        type: "ABONO",
        monto: requested.montoAplicado,
        createdBy: actor.uid,
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.set(
        solicitudSnap.ref.collection("notas").doc(
          buildPaymentApplicationNoteId(reservationId, requested.solicitudId),
        ),
        {
          rootId: actor.rootId,
          text: `Pago ${paymentFolio} aplicado por ${requested.montoAplicado.toFixed(2)} en lote atomico ${reservationId}.`,
          createdBy: actor.uid,
          createdByName: actor.displayName,
          createdByRole: actor.role,
          batchReservationId: reservationId,
          createdAt: FieldValue.serverTimestamp(),
        },
      );

      logActivityTx(
        tx,
        db,
        {
          event: "PAGO_APLICADO_A_SOLICITUD",
          rootId: actor.rootId,
          adminId: actor.adminId,
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorUsername: actor.username,
          actorRole: actor.role,
          referenceId: batch.pagoId,
          referenceFolio: paymentFolio,
          referenceType: "pago",
          relatedEntityId: requested.solicitudId,
          relatedEntityType: "solicitud",
          amount: requested.montoAplicado,
          description: `Pago ${paymentFolio} aplicado a solicitud ${solicitudFolio} por ${requested.montoAplicado.toFixed(2)} en lote atomico.`,
          extra: {
            batchReservationId: reservationId,
            paymentApplicationId: applicationId,
            atomicBatch: true,
            iqExecutionStatus: "NOT_REQUESTED",
          },
        },
        db.collection("activityLog").doc(
          buildPaymentApplicationActivityId(applicationId, "APPLIED"),
        ),
      );

      if (nuevoPendiente === 0) {
        logActivityTx(
          tx,
          db,
          {
            event: "SOLICITUD_COMPLETADA",
            rootId: actor.rootId,
            adminId: actor.adminId,
            actorUid: actor.uid,
            actorName: actor.displayName,
            actorUsername: actor.username,
            actorRole: actor.role,
            referenceId: requested.solicitudId,
            referenceFolio: solicitudFolio,
            referenceType: "solicitud",
            relatedEntityId: batch.pagoId,
            relatedEntityType: "pago",
            amount: requested.montoAplicado,
            description: `Solicitud completada ${solicitudFolio} mediante lote atomico ${reservationId}.`,
            extra: {
              batchReservationId: reservationId,
              paymentApplicationId: applicationId,
              atomicBatch: true,
              iqExecutionStatus: "NOT_REQUESTED",
            },
          },
          db.collection("activityLog").doc(
            buildPaymentApplicationActivityId(applicationId, "COMPLETED"),
          ),
        );
      }
    }

    const coveragePatch = buildPagoCoverageApplyPatch(pago, batch.totalAmount);
    const nextAvailable = money2(coveragePatch.montoDisponibleSolicitudes);
    const nextApplied = money2(coveragePatch.montoAplicadoSolicitudes);
    const nextPagoStatus = nextAvailable === 0
      ? "APLICADO_TOTAL"
      : nextApplied > 0
        ? "APLICADO_PARCIAL"
        : "CONCILIADO";

    tx.update(pagoRef, {
      ...coveragePatch,
      status: nextPagoStatus,
      hasUnreadMsg: true,
      lastPaymentApplicationReservationId: reservationId,
      lastPaymentApplicationRequestHash: batch.requestHash,
      iqPaymentApplicationStatus: "PAY0_APPLIED_PENDING_IQ_PLAN",
      iqPaymentApplicationExecutionStatus: "NOT_EXECUTED",
      iqPaymentApplicationActionExecuted: false,

      // H4_D87_A59_R2_FORWARD_ONLY
      // Esta marca solo existe en aplicaciones creadas por
      // una version que ya conoce la automatizacion IQ.
      iqPaymentApplicationAutomationEligible: true,
      iqPaymentApplicationAutomationEligibilityVersion:
        "H4-D87-A59-R2",
      iqPaymentApplicationAutomationEligibleAt:
        FieldValue.serverTimestamp(),
      iqPaymentApplicationUpdatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.set(
      pagoRef.collection("notas").doc(
        buildPaymentApplicationNoteId(reservationId, batch.pagoId),
      ),
      {
        rootId: actor.rootId,
        text: `Lote atomico ${reservationId}: ${batch.applications.length} aplicacion(es) por ${batch.totalAmount.toFixed(2)}.`,
        createdBy: actor.uid,
        createdByName: actor.displayName,
        createdByRole: actor.role,
        batchReservationId: reservationId,
        createdAt: FieldValue.serverTimestamp(),
      },
    );

    const result = {
      version: PAYMENT_APPLICATION_VERSION,
      reservationId,
      pagoId: batch.pagoId,
      paymentFolio,
      applicationCount: batch.applications.length,
      totalApplied: batch.totalAmount,
      pagoAppliedBefore: coverage.applied,
      pagoAvailableBefore: coverage.available,
      pagoAppliedAfter: nextApplied,
      pagoAvailableAfter: nextAvailable,
      pagoStatus: nextPagoStatus,
      completedSolicitudIds,
      applications: applicationResults,
      atomic: true,
      iqExecutionStatus: "NOT_REQUESTED",
      iqActionExecuted: false,
    };

    tx.set(
      reservationRef,
      {
        ...buildReservationPayload({
          actor,
          batch,
          status: "APPLIED",
          result,
        }),
        createdAt: reservationSnap.exists
          ? reservationSnap.data()?.createdAt || FieldValue.serverTimestamp()
          : FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return {
      ok: true,
      reservationId,
      requestHash: batch.requestHash,
      status: "APPLIED",
      reused: false,
      iqExecutionStatus: "NOT_REQUESTED",
      iqActionExecuted: false,
      result,
    };
  });
}