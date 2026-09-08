import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue, type DocumentData, type DocumentSnapshot } from "firebase-admin/firestore";
import { money2 } from "../shared/money";
import { normalizePagoStatus } from "../pagos/domain";
import {
  applySolicitudCoverageAmount,
  getSolicitudCoverageState,
  normalizeSolicitudBackendStatus,
} from "../solicitudes/domain";
import { db } from "../sharedCallables/helpers";
import {
  PAYMENT_APPLICATION_IQ_PLAN_VERSION,
  buildPaymentApplicationSettlementPolicy,
  normalizePaymentApplicationInvoiceType,
  type PaymentApplicationInvoiceType,
  type PaymentApplicationPueSettlementStatus,
  type PaymentApplicationSettlementPolicy,
  type PaymentApplicationNextStep,
  type NormalizedPaymentApplicationBatch,
  normalizePaymentApplicationBatchInput,
  buildPaymentApplicationDocumentId,
  buildPaymentApplicationIqAttemptId,
  buildPaymentApplicationIqLockId,
  buildPaymentApplicationIqPlanHash,
  buildPaymentApplicationIqPlanId,
  buildPaymentApplicationIqPlanItemId,
  buildPaymentApplicationReservationId,
} from "./domain";
import type { PaymentApplicationActor } from "./service";

export type PaymentApplicationIqPlanResult = {
  ok: true;
  planId: string;
  reservationId: string;
  planHash: string;
  status: "PREVALIDATED" | "IQ_IN_PROGRESS" | "IQ_APPLIED" | "IQ_REJECTED_REVIEW_REQUIRED" | "IQ_UNKNOWN_REVIEW_REQUIRED";
  reused: boolean;
  iqExecutionStatus: "NOT_EXECUTED" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED_SAFE" | "REJECTED_REVIEW_REQUIRED" | "UNKNOWN_REVIEW_REQUIRED";
  iqActionExecuted: boolean;
  plan: Record<string, any>;
};


type PreparedItem = {
  planItemId: string;
  attemptId: string;
  lockId: string;
  applicationId: string;
  solicitudId: string;
  solicitudFolio: string;
  solicitudIqFolio: string;
  invoiceType: PaymentApplicationInvoiceType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  requiresComplement: boolean;
  requiresSameMonthSettlement: boolean;
  pueSettlementStatus: PaymentApplicationPueSettlementStatus;
  settlementPolicy: PaymentApplicationSettlementPolicy;
  nextStep: PaymentApplicationNextStep;
};

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanUpper(value: unknown): string {
  return cleanText(value).toUpperCase();
}



function normalizeIqNumericFolio(value: unknown, label: string): string {
  const raw = cleanText(value);
  if (!/^\d{3,20}$/.test(raw)) {
    throw new HttpsError("failed-precondition", `${label} no tiene folio IQ numerico valido.`);
  }
  return raw;
}

function getPagoIqFolio(pago: DocumentData): string {
  return normalizeIqNumericFolio(
    pago?.iqDepositId ??
      pago?.iqDepositFolio ??
      pago?.iqPagoDepositId ??
      pago?.iqPagoDepositFolio,
    "El pago",
  );
}

function getSolicitudIqFolio(solicitud: DocumentData, solicitudId: string): string {
  return normalizeIqNumericFolio(
    solicitud?.iqId ?? solicitud?.iqFolio,
    `La solicitud ${solicitudId}`,
  );
}

function assertRootScope(entity: DocumentData, rootId: string): void {
  if (cleanText(entity?.rootId) !== rootId) {
    throw new HttpsError("permission-denied", "Entidad fuera del alcance autorizado.");
  }
}

function assertEntityOwnership(
  entity: DocumentData,
  actor: PaymentApplicationActor,
  entityLabel: string,
): void {
  const adminId = cleanText(entity?.adminId);
  const createdBy = cleanText(entity?.createdBy);

  if (actor.role === "admin" && adminId && adminId !== actor.uid) {
    throw new HttpsError("permission-denied", `No autorizado para preparar ${entityLabel}.`);
  }

  if (actor.role === "operador") {
    if (adminId && adminId !== actor.adminId) {
      throw new HttpsError("permission-denied", `No autorizado para preparar ${entityLabel}.`);
    }
    if (createdBy && createdBy !== actor.uid) {
      throw new HttpsError("permission-denied", `No autorizado para preparar ${entityLabel}.`);
    }
  }
}

function assertPagoSolicitudMatch(pago: DocumentData, solicitud: DocumentData): void {
  const pagoClienteId = cleanText(pago?.clienteId);
  const solicitudClienteId = cleanText(solicitud?.clienteId);
  const pagoClienteNombre = cleanText(pago?.clienteNombre).toLowerCase();
  const solicitudClienteNombre = cleanText(solicitud?.clienteNombre).toLowerCase();

  if (pagoClienteId && solicitudClienteId && pagoClienteId !== solicitudClienteId) {
    throw new HttpsError("failed-precondition", "Solicitud y pago pertenecen a clientes distintos.");
  }
  if (!solicitudClienteId && pagoClienteNombre && solicitudClienteNombre && pagoClienteNombre !== solicitudClienteNombre) {
    throw new HttpsError("failed-precondition", "Solicitud y pago no coinciden por cliente.");
  }

  const pagoCompanyId = cleanText(pago?.companyId);
  const solicitudCompanyId = cleanText(solicitud?.companyId);
  const pagoEmpresaNombre = cleanText(pago?.empresaNombre).toLowerCase();
  const solicitudEmpresaNombre = cleanText(solicitud?.empresaNombre).toLowerCase();

  if (!pagoCompanyId && !pagoEmpresaNombre) {
    throw new HttpsError("failed-precondition", "El pago no tiene empresa definida.");
  }
  if (!solicitudCompanyId && !solicitudEmpresaNombre) {
    throw new HttpsError("failed-precondition", "La solicitud no tiene empresa definida.");
  }
  if (pagoCompanyId && solicitudCompanyId && pagoCompanyId !== solicitudCompanyId) {
    throw new HttpsError("failed-precondition", "Solicitud y pago pertenecen a empresas distintas.");
  }
  if ((!pagoCompanyId || !solicitudCompanyId) && pagoEmpresaNombre && solicitudEmpresaNombre && pagoEmpresaNombre !== solicitudEmpresaNombre) {
    throw new HttpsError("failed-precondition", "Solicitud y pago no coinciden por empresa.");
  }
}

function assertReservationCompatible(
  reservation: DocumentData,
  actor: PaymentApplicationActor,
  batch: NormalizedPaymentApplicationBatch,
): void {
  if (cleanText(reservation?.rootId) !== actor.rootId) {
    throw new HttpsError("permission-denied", "Reserva fuera del alcance autorizado.");
  }
  if (cleanText(reservation?.pagoId) !== batch.pagoId) {
    throw new HttpsError("already-exists", "La reserva pertenece a otro pago.");
  }
  if (cleanText(reservation?.requestHash) !== batch.requestHash) {
    throw new HttpsError("already-exists", "La reserva no coincide con el lote solicitado.");
  }
  const createdBy = cleanText(reservation?.createdBy);
  if (createdBy && createdBy !== actor.uid && actor.role !== "superadmin") {
    throw new HttpsError("permission-denied", "La reserva pertenece a otro usuario.");
  }
}

function assertPagoIqReady(pago: DocumentData): void {
  const pagoStatus = normalizePagoStatus(pago?.status);
  if (!["CONCILIADO", "APLICADO_PARCIAL", "APLICADO_TOTAL"].includes(pagoStatus)) {
    throw new HttpsError("failed-precondition", "El pago debe estar conciliado antes de preparar IQ.");
  }

  const iqStatus = cleanUpper(pago?.iqDepositStatus ?? pago?.iqPagoDepositStatus ?? pago?.iqStatus);
  const terminalOutcome = cleanUpper(pago?.iqDepositTerminalOutcome ?? pago?.iqTerminalOutcome);
  const terminalLocked = pago?.iqDepositTerminalLocked === true || pago?.iqTerminalLocked === true;

  if (terminalLocked || ["REJECTED", "RECHAZADO", "CANCELLED", "CANCELADO"].includes(iqStatus) || ["REJECTED", "CANCELLED"].includes(terminalOutcome)) {
    throw new HttpsError("failed-precondition", "El folio IQ del pago esta cerrado o rechazado.");
  }
}

function assertSolicitudIqReady(solicitud: DocumentData, solicitudId: string, reservationStatus: string): void {
  const status = normalizeSolicitudBackendStatus(solicitud?.status);
  if (["RECHAZADA", "CANCELADA", "ELIMINADA"].includes(status)) {
    throw new HttpsError("failed-precondition", `La solicitud ${solicitudId} no esta apta para aplicacion IQ.`);
  }
  if (status === "COMPLETADA" && reservationStatus !== "APPLIED") {
    throw new HttpsError("failed-precondition", `La solicitud ${solicitudId} ya esta completada.`);
  }

  const iqStatus = cleanUpper(solicitud?.iqStatus);
  const terminalOutcome = cleanUpper(solicitud?.iqTerminalOutcome);
  const terminalLocked = solicitud?.iqTerminalLocked === true;
  if (terminalLocked || ["REJECTED", "RECHAZADO", "CANCELLED", "CANCELADO"].includes(iqStatus) || ["REJECTED", "CANCELLED"].includes(terminalOutcome)) {
    throw new HttpsError("failed-precondition", `El folio IQ de la solicitud ${solicitudId} esta cerrado.`);
  }
}

function resultApplicationMap(reservation: DocumentData): Map<string, DocumentData> {
  const rows = Array.isArray(reservation?.result?.applications)
    ? reservation.result.applications
    : [];
  return new Map(rows.map((row: any) => [cleanText(row?.solicitudId), row]));
}

function isActiveForeignLock(lock: DocumentData, reservationId: string): boolean {
  if (cleanText(lock?.reservationId) === reservationId) return false;
  return ["RESERVED", "PREVALIDATED", "READY_FOR_IQ", "IQ_IN_PROGRESS"].includes(cleanUpper(lock?.status));
}

function assertExistingApplicationSafe(
  applicationSnap: DocumentSnapshot,
  reservationId: string,
  amount: number,
): void {
  if (!applicationSnap.exists) return;
  const application = applicationSnap.data() || {};
  if (cleanText(application?.batchReservationId) !== reservationId) {
    throw new HttpsError("already-exists", "La aplicacion determinista ya pertenece a otra reserva.");
  }
  if (money2(application?.montoAplicado) !== amount) {
    throw new HttpsError("already-exists", "La aplicacion existente tiene un monto diferente.");
  }
  const executionStatus = cleanUpper(application?.iqExecutionStatus);
  if (application?.iqActionExecuted === true || ["IN_PROGRESS", "SUCCEEDED", "COMPLETED"].includes(executionStatus)) {
    throw new HttpsError("already-exists", "La aplicacion ya fue enviada o ejecutada en IQ.");
  }
}

function planResultFromData(planId: string, plan: DocumentData, reused: boolean): PaymentApplicationIqPlanResult {
  const rawStatus = cleanUpper(plan?.status);
  const status: PaymentApplicationIqPlanResult["status"] =
    rawStatus === "IQ_IN_PROGRESS"
      ? "IQ_IN_PROGRESS"
      : rawStatus === "IQ_APPLIED"
        ? "IQ_APPLIED"
        : rawStatus === "IQ_REJECTED_REVIEW_REQUIRED"
          ? "IQ_REJECTED_REVIEW_REQUIRED"
          : rawStatus === "IQ_UNKNOWN_REVIEW_REQUIRED"
            ? "IQ_UNKNOWN_REVIEW_REQUIRED"
            : "PREVALIDATED";
  const rawExecution = cleanUpper(plan?.iqExecutionStatus);
  const iqExecutionStatus: PaymentApplicationIqPlanResult["iqExecutionStatus"] =
    rawExecution === "IN_PROGRESS"
      ? "IN_PROGRESS"
      : rawExecution === "SUCCEEDED"
        ? "SUCCEEDED"
        : rawExecution === "FAILED_SAFE"
          ? "FAILED_SAFE"
          : rawExecution === "REJECTED_REVIEW_REQUIRED"
            ? "REJECTED_REVIEW_REQUIRED"
            : rawExecution === "UNKNOWN_REVIEW_REQUIRED"
              ? "UNKNOWN_REVIEW_REQUIRED"
              : "NOT_EXECUTED";

  return {
    ok: true,
    planId,
    reservationId: cleanText(plan?.reservationId),
    planHash: cleanText(plan?.planHash),
    status,
    reused,
    iqExecutionStatus,
    iqActionExecuted: plan?.iqActionExecuted === true,
    plan: {
      ...(plan?.plan || {}),
      iqExecutionAttemptId: cleanText(plan?.iqExecutionAttemptId),
      actualIqAttemptCount: Number(plan?.actualIqAttemptCount || 0),
      iqApplicationId: cleanText(plan?.iqApplicationId),
      iqExecutionStatus,
      iqExecutionMessage: cleanText(plan?.iqExecutionMessage),
      iqExecutionResult: plan?.iqExecutionResult || null,
    },
  };
}

export async function preparePaymentApplicationIqPlan(params: {
  actor: PaymentApplicationActor;
  batch: NormalizedPaymentApplicationBatch;
}): Promise<PaymentApplicationIqPlanResult> {
  const { actor, batch } = params;
  const reservationId = buildPaymentApplicationReservationId({
    rootId: actor.rootId,
    pagoId: batch.pagoId,
    idempotencyKey: batch.idempotencyKey,
  });
  const planId = buildPaymentApplicationIqPlanId(reservationId);
  const reservationRef = db.collection("pagoApplicationReservations").doc(reservationId);
  const planRef = db.collection("pagoApplicationIqPlans").doc(planId);
  const pagoRef = db.collection("pagos").doc(batch.pagoId);
  const solicitudRefs = batch.applications.map((item) => db.collection("solicitudes").doc(item.solicitudId));
  const applicationRefs = batch.applications.map((item) => db.collection("pagoAplicaciones").doc(buildPaymentApplicationDocumentId(reservationId, item.solicitudId)));
  const lockRefs = batch.applications.map((item) => db.collection("pagoApplicationIqLocks").doc(buildPaymentApplicationIqLockId(actor.rootId, item.solicitudId)));

  return db.runTransaction(async (tx) => {
    const reservationSnap = await tx.get(reservationRef);
    const planSnap = await tx.get(planRef);
    const pagoSnap = await tx.get(pagoRef);

    const solicitudSnaps: DocumentSnapshot[] = [];
    const applicationSnaps: DocumentSnapshot[] = [];
    const lockSnaps: DocumentSnapshot[] = [];
    for (const ref of solicitudRefs) solicitudSnaps.push(await tx.get(ref));
    for (const ref of applicationRefs) applicationSnaps.push(await tx.get(ref));
    for (const ref of lockRefs) lockSnaps.push(await tx.get(ref));

    if (!reservationSnap.exists) {
      throw new HttpsError("failed-precondition", "Primero reserva el lote de aplicacion PAY0.");
    }
    if (!pagoSnap.exists) {
      throw new HttpsError("not-found", "Pago no existe.");
    }

    const reservation = reservationSnap.data() || {};
    assertReservationCompatible(reservation, actor, batch);
    const reservationStatus = cleanUpper(reservation?.status);
    if (!["RESERVED", "APPLIED"].includes(reservationStatus)) {
      throw new HttpsError("failed-precondition", "La reserva no esta disponible para preparar IQ.");
    }

    if (planSnap.exists) {
      const existingPlan = planSnap.data() || {};
      if (
        cleanText(existingPlan?.reservationId) !== reservationId ||
        cleanText(existingPlan?.requestHash) !== batch.requestHash ||
        !/^[a-f0-9]{64}$/i.test(cleanText(existingPlan?.planHash))
      ) {
        throw new HttpsError("already-exists", "El plan IQ existente no coincide con esta reserva.");
      }
      return planResultFromData(planId, existingPlan, true);
    }

    const pago = pagoSnap.data() || {};
    assertRootScope(pago, actor.rootId);
    assertEntityOwnership(pago, actor, "este pago");
    assertPagoIqReady(pago);
    const pagoIqFolio = getPagoIqFolio(pago);
    const paymentFolio = cleanText(pago?.folio ?? pago?.pagoFolio) || batch.pagoId;
    const appliedResults = resultApplicationMap(reservation);
    const preparedItems: PreparedItem[] = [];

    for (let index = 0; index < batch.applications.length; index += 1) {
      const requested = batch.applications[index];
      const solicitudSnap = solicitudSnaps[index];
      const applicationSnap = applicationSnaps[index];
      const lockSnap = lockSnaps[index];

      if (!solicitudSnap.exists) {
        throw new HttpsError("not-found", `Solicitud ${requested.solicitudId} no existe.`);
      }

      const solicitud = solicitudSnap.data() || {};
      assertRootScope(solicitud, actor.rootId);
      assertEntityOwnership(solicitud, actor, "esta solicitud");
      assertPagoSolicitudMatch(pago, solicitud);
      assertSolicitudIqReady(solicitud, requested.solicitudId, reservationStatus);

      const invoiceType = normalizePaymentApplicationInvoiceType(solicitud?.tipoFactura ?? solicitud?.invoiceType);
      if (!invoiceType) {
        throw new HttpsError("failed-precondition", `La solicitud ${requested.solicitudId} no tiene tipo PUE/PPD valido.`);
      }

      const solicitudIqFolio = getSolicitudIqFolio(solicitud, requested.solicitudId);
      const solicitudFolio = cleanText(solicitud?.folio ?? solicitud?.solicitudFolio ?? solicitud?.folioSolicitud) || requested.solicitudId;
      let balanceBefore: number;
      let balanceAfter: number;

      if (reservationStatus === "APPLIED") {
        const applied = appliedResults.get(requested.solicitudId);
        if (!applied || money2(applied?.montoAplicado) !== requested.montoAplicado) {
          throw new HttpsError("failed-precondition", `La aplicacion PAY0 de ${requested.solicitudId} no coincide con la reserva.`);
        }
        balanceBefore = money2(applied?.saldoAnterior);
        balanceAfter = money2(applied?.saldoInsoluto);
      } else {
        const coverage = getSolicitudCoverageState(solicitud);
        balanceBefore = coverage.pending;
        if (balanceBefore <= 0 || requested.montoAplicado > balanceBefore) {
          throw new HttpsError("failed-precondition", `Monto invalido contra el saldo de ${requested.solicitudId}.`);
        }
        balanceAfter = applySolicitudCoverageAmount(solicitud, requested.montoAplicado).pending;
      }

      const applicationId = buildPaymentApplicationDocumentId(reservationId, requested.solicitudId);
      assertExistingApplicationSafe(applicationSnap, reservationId, requested.montoAplicado);

      if (lockSnap.exists && isActiveForeignLock(lockSnap.data() || {}, reservationId)) {
        throw new HttpsError("aborted", `La solicitud ${solicitudFolio} ya esta reservada por otro lote.`);
      }

      const planItemId = buildPaymentApplicationIqPlanItemId(planId, applicationId);
      const settlementDecision = buildPaymentApplicationSettlementPolicy({
        invoiceType,
        balanceAfter,
      });

      preparedItems.push({
        planItemId,
        attemptId: buildPaymentApplicationIqAttemptId(planItemId),
        lockId: buildPaymentApplicationIqLockId(actor.rootId, requested.solicitudId),
        applicationId,
        solicitudId: requested.solicitudId,
        solicitudFolio,
        solicitudIqFolio,
        invoiceType,
        amount: requested.montoAplicado,
        balanceBefore,
        balanceAfter,
        ...settlementDecision,
      });
    }

    preparedItems.sort((a, b) => a.solicitudId.localeCompare(b.solicitudId));
    const planHash = buildPaymentApplicationIqPlanHash({
      version: PAYMENT_APPLICATION_IQ_PLAN_VERSION,
      reservationId,
      requestHash: batch.requestHash,
      pagoId: batch.pagoId,
      pagoIqFolio,
      items: preparedItems.map((item) => ({
        lockId: item.lockId,
        applicationId: item.applicationId,
        solicitudId: item.solicitudId,
        solicitudIqFolio: item.solicitudIqFolio,
        invoiceType: item.invoiceType,
        amount: item.amount,
        balanceBefore: item.balanceBefore,
        balanceAfter: item.balanceAfter,
        requiresComplement: item.requiresComplement,
        requiresSameMonthSettlement: item.requiresSameMonthSettlement,
        pueSettlementStatus: item.pueSettlementStatus,
        settlementPolicy: item.settlementPolicy,
        nextStep: item.nextStep,
      })),
    });

    const pueCount = preparedItems.filter((item) => item.invoiceType === "PUE").length;
    const ppdCount = preparedItems.length - pueCount;
    const plan = {
      version: PAYMENT_APPLICATION_IQ_PLAN_VERSION,
      planId,
      reservationId,
      pagoId: batch.pagoId,
      paymentFolio,
      pagoIqFolio,
      requestHash: batch.requestHash,
      applicationCount: preparedItems.length,
      totalAmount: batch.totalAmount,
      pueCount,
      ppdCount,
      requiresComplementCount: ppdCount,
      requiresComplementSolicitudIds: preparedItems.filter((item) => item.requiresComplement).map((item) => item.solicitudId),
      puePartialPendingCount: preparedItems.filter((item) => item.pueSettlementStatus === "PARTIAL_PENDING_SAME_MONTH").length,
      puePartialPendingSolicitudIds: preparedItems
        .filter((item) => item.pueSettlementStatus === "PARTIAL_PENDING_SAME_MONTH")
        .map((item) => item.solicitudId),
      items: preparedItems.map((item) => ({
        planItemId: item.planItemId,
        lockId: item.lockId,
        applicationId: item.applicationId,
        solicitudId: item.solicitudId,
        solicitudFolio: item.solicitudFolio,
        solicitudIqFolio: item.solicitudIqFolio,
        invoiceType: item.invoiceType,
        amount: item.amount,
        balanceBefore: item.balanceBefore,
        balanceAfter: item.balanceAfter,
        requiresComplement: item.requiresComplement,
        requiresSameMonthSettlement: item.requiresSameMonthSettlement,
        pueSettlementStatus: item.pueSettlementStatus,
        settlementPolicy: item.settlementPolicy,
        nextStep: item.nextStep,
        prevalidationStatus: "PASSED",
        iqExecutionStatus: "NOT_EXECUTED",
        iqActionExecuted: false,
      })),
      deterministic: true,
      prevalidationStatus: "PASSED",
      iqExecutionStatus: "NOT_EXECUTED",
      iqActionExecuted: false,
    };

    tx.set(planRef, {
      version: PAYMENT_APPLICATION_IQ_PLAN_VERSION,
      rootId: actor.rootId,
      adminId: actor.adminId,
      createdBy: actor.uid,
      createdByRole: actor.role,
      createdByName: actor.displayName,
      planId,
      reservationId,
      pagoId: batch.pagoId,
      requestHash: batch.requestHash,
      planHash,
      status: "PREVALIDATED",
      prevalidationStatus: "PASSED",
      iqExecutionStatus: "NOT_EXECUTED",
      iqActionExecuted: false,
      plan,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    for (const item of preparedItems) {
      tx.set(db.collection("pagoApplicationIqPlanItems").doc(item.planItemId), {
        version: PAYMENT_APPLICATION_IQ_PLAN_VERSION,
        rootId: actor.rootId,
        adminId: actor.adminId,
        createdBy: actor.uid,
        planId,
        reservationId,
        planItemId: item.planItemId,
        applicationId: item.applicationId,
        pagoId: batch.pagoId,
        pagoIqFolio,
        solicitudId: item.solicitudId,
        solicitudFolio: item.solicitudFolio,
        solicitudIqFolio: item.solicitudIqFolio,
        invoiceType: item.invoiceType,
        amount: item.amount,
        balanceBefore: item.balanceBefore,
        balanceAfter: item.balanceAfter,
        requiresComplement: item.requiresComplement,
        requiresSameMonthSettlement: item.requiresSameMonthSettlement,
        pueSettlementStatus: item.pueSettlementStatus,
        settlementPolicy: item.settlementPolicy,
        nextStep: item.nextStep,
        status: "PREVALIDATED",
        prevalidationStatus: "PASSED",
        iqExecutionStatus: "NOT_EXECUTED",
        iqActionExecuted: false,
        actualIqAttemptCount: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.set(db.collection("pagoApplicationIqAttempts").doc(item.attemptId), {
        version: PAYMENT_APPLICATION_IQ_PLAN_VERSION,
        rootId: actor.rootId,
        adminId: actor.adminId,
        createdBy: actor.uid,
        planId,
        reservationId,
        planItemId: item.planItemId,
        applicationId: item.applicationId,
        pagoId: batch.pagoId,
        solicitudId: item.solicitudId,
        attemptId: item.attemptId,
        attemptNumber: 0,
        attemptType: "PREVALIDATION_ONLY",
        status: "PASSED",
        resultCode: "READY_FOR_IQ",
        resultMessage: item.requiresComplement
          ? "Aplicacion PPD prevalidada; requerira complemento despues de IQ."
          : item.requiresSameMonthSettlement
            ? "Aplicacion PUE parcial prevalidada; no genera complemento y queda pendiente de liquidacion dentro del mes."
            : "Aplicacion PUE prevalidada; no genera complemento y liquida la solicitud.",
        iqExecutionStatus: "NOT_EXECUTED",
        iqActionExecuted: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.set(db.collection("pagoApplicationIqLocks").doc(item.lockId), {
        version: PAYMENT_APPLICATION_IQ_PLAN_VERSION,
        rootId: actor.rootId,
        adminId: actor.adminId,
        createdBy: actor.uid,
        lockId: item.lockId,
        solicitudId: item.solicitudId,
        pagoId: batch.pagoId,
        reservationId,
        planId,
        applicationId: item.applicationId,
        status: "PREVALIDATED",
        iqExecutionStatus: "NOT_EXECUTED",
        iqActionExecuted: false,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }


    tx.set(pagoRef, {
      iqPaymentApplicationPlanId: planId,
      iqPaymentApplicationReservationId: reservationId,
      iqPaymentApplicationStatus: "PREVALIDATED",
      iqPaymentApplicationExecutionStatus: "NOT_EXECUTED",
      iqPaymentApplicationActionExecuted: false,
      iqPaymentApplicationPlanHash: planHash,
      iqPaymentApplicationUpdatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    tx.set(reservationRef, {
      iqPlanVersion: PAYMENT_APPLICATION_IQ_PLAN_VERSION,
      iqPlanId: planId,
      iqPlanHash: planHash,
      iqPlanStatus: "PREVALIDATED",
      iqPrevalidationStatus: "PASSED",
      iqExecutionStatus: "NOT_EXECUTED",
      iqActionExecuted: false,
      iqPlanPreparedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return {
      ok: true,
      planId,
      reservationId,
      planHash,
      status: "PREVALIDATED",
      reused: false,
      iqExecutionStatus: "NOT_EXECUTED",
      iqActionExecuted: false,
      plan,
    };
  });
}

export async function resumePaymentApplicationIqPlan(params: {
  actor: PaymentApplicationActor;
  pagoId: string;
}): Promise<PaymentApplicationIqPlanResult> {
  const pagoId = cleanText(params.pagoId);
  if (!pagoId) {
    throw new HttpsError("invalid-argument", "pagoId requerido para continuar la aplicacion IQ.");
  }

  const pagoSnap = await db.collection("pagos").doc(pagoId).get();
  if (!pagoSnap.exists) {
    throw new HttpsError("not-found", "Pago no existe.");
  }

  const pago = pagoSnap.data() || {};
  assertRootScope(pago, params.actor.rootId);
  assertEntityOwnership(pago, params.actor, "este pago");

  const reservationId = cleanText(
    pago?.iqPaymentApplicationReservationId ?? pago?.lastPaymentApplicationReservationId,
  );
  if (!reservationId) {
    throw new HttpsError("failed-precondition", "El pago no tiene una reserva de aplicacion pendiente para IQ.");
  }

  const reservationSnap = await db.collection("pagoApplicationReservations").doc(reservationId).get();
  if (!reservationSnap.exists) {
    throw new HttpsError("not-found", "La reserva de aplicacion del pago no existe.");
  }

  const reservation = reservationSnap.data() || {};
  if (cleanText(reservation?.rootId) !== params.actor.rootId || cleanText(reservation?.pagoId) !== pagoId) {
    throw new HttpsError("permission-denied", "La reserva de aplicacion esta fuera del alcance autorizado.");
  }

  const batch = normalizePaymentApplicationBatchInput({
    pagoId,
    idempotencyKey: reservation?.idempotencyKey,
    aplicaciones: reservation?.applications,
  });

  return preparePaymentApplicationIqPlan({ actor: params.actor, batch });
}
