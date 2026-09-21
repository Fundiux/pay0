import { db } from "../sharedCallables/helpers";
import { inspectIqComplementGate } from "./complementGates";
import { complementRequestId } from "./complementFollowup";
import { hash, text } from "./complementPolicy";

export type LocalIqRecoveryState = "READY_FOR_IQ_LOOKUP" | "WAITING_IQ_APPLICATION" | "LOCAL_EVIDENCE_INCOMPLETE" | "GATE_BLOCKED" | "ALREADY_RECEIVED" | "NOT_APPLICABLE";

// A deterministic preview only. It never authenticates with IQ, reserves a
// quota, creates a job, downloads a file or changes a follow-up.
export async function assessLocalIqRecovery(rootId: string, applicationId: string) {
  const app = (await db.doc(`pagoAplicaciones/${applicationId}`).get()).data();
  if (!app || app.rootId !== rootId || app.status !== "APLICADA" || app.invoiceType !== "PPD")
    return { state: "NOT_APPLICABLE" as LocalIqRecoveryState, reason: "REP_NOT_APPLICABLE" };
  const [solicitudSnap, pagoSnap, requestSnap] = await Promise.all([
    db.doc(`solicitudes/${app.solicitudId}`).get(), db.doc(`pagos/${app.pagoId}`).get(),
    db.doc(`paymentComplementRequests/${complementRequestId(rootId, applicationId)}`).get(),
  ]);
  const solicitud = solicitudSnap.data(), pago = pagoSnap.data(), request = requestSnap.data();
  if (!solicitud || !pago || solicitud.rootId !== rootId || pago.rootId !== rootId || solicitud.tipoFactura !== "PPD" ||
      !text(solicitud.iqId || solicitud.iqFolio || solicitud.folioIq || solicitud.iqSolicitudId) ||
      !request || request.rootId !== rootId || request.applicationId !== applicationId || request.provider !== "IQ")
    return { state: "LOCAL_EVIDENCE_INCOMPLETE" as LocalIqRecoveryState, reason: "REP_SOURCE_INCOMPLETE" };
  if (request.status === "RECEIVED") return { state: "ALREADY_RECEIVED" as LocalIqRecoveryState, reason: "REP_ALREADY_RECEIVED" };
  if (app.iqApplicationStatus !== "IQ_APPLIED" || app.iqActionExecuted !== true)
    return { state: "WAITING_IQ_APPLICATION" as LocalIqRecoveryState, reason: "REP_IQ_APPLICATION_NOT_CONFIRMED" };
  if (!app.iqPlanId || !app.iqExecutionAttemptId || !/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(request.invoiceUuid || "") ||
      request.invoiceUuid !== text(solicitud.facturaUuid || solicitud.uuidCfdi || solicitud.iqInvoiceUuid).toUpperCase() ||
      request.amountMinor !== Math.round(Number(app.montoAplicado) * 100) || request.installment !== app.numeroParcialidad ||
      request.balanceBefore !== app.saldoAnterior || request.balanceAfter !== app.saldoInsoluto)
    return { state: "LOCAL_EVIDENCE_INCOMPLETE" as LocalIqRecoveryState, reason: "REP_FISCAL_OR_APPLICATION_MISMATCH" };
  const [planSnap, attemptSnap] = await Promise.all([
    db.doc(`pagoApplicationIqPlans/${app.iqPlanId}`).get(), db.doc(`pagoApplicationIqAttempts/${app.iqExecutionAttemptId}`).get(),
  ]);
  const plan = planSnap.data(), attempt = attemptSnap.data();
  const profileId = text(plan?.iqExecutionProfileId), depositId = text(plan?.plan?.pagoIqFolio || plan?.pagoIqFolio);
  if (!plan || plan.rootId !== rootId || plan.pagoId !== app.pagoId || !attempt || attempt.rootId !== rootId ||
      attempt.planId !== app.iqPlanId || attempt.profileId !== profileId || !text(attempt.createdBy) ||
      !profileId || !/^\d{3,20}$/.test(depositId))
    return { state: "LOCAL_EVIDENCE_INCOMPLETE" as LocalIqRecoveryState, reason: "REP_IQ_PLAN_OR_ATTEMPT_INVALID" };
  const jobLike = { rootId, provider: "IQ", profileId, depositId, actorUid: attempt.createdBy, clientId: solicitud.clienteId };
  const gate = await inspectIqComplementGate(jobLike, "LOOKUP");
  if (!gate.allowed) return { state: "GATE_BLOCKED" as LocalIqRecoveryState, reason: gate.reason };
  return { state: "READY_FOR_IQ_LOOKUP" as LocalIqRecoveryState, reason: "LOCAL_EVIDENCE_READY",
    applicationId, planFingerprint: hash(`${rootId}:${applicationId}:${profileId}:${depositId}:${request.fingerprint || request.revision || ""}`),
    nextCapability: "LOOKUP" as const, externalCallsMade: 0 };
}
