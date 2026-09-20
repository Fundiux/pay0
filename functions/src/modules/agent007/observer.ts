import type { Firestore, Transaction, WriteBatch } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

const OBSERVED_EVENTS = new Set([
  "BENEFICIARIO_CREADO",
  "COMPLEMENTO_PAGO_SEGUIMIENTO",
  "SOLICITUD_CREADA",
  "SOLICITUD_CANCELADA",
  "SOLICITUD_COMPLETADA",
  "SOLICITUD_RECHAZADA",
  "SOLICITUD_STATUS_ACTUALIZADO",
  "DOCUMENTO_SOLICITUD_SUBIDO",
  "DOCUMENTO_SOLICITUD_DESACTIVADO",
  "COTIZACION_GENERADA",
  "CONSTANCIA_RECEPCION_GENERADA",
  "PAGO_CREADO",
  "PAGO_STATUS_ACTUALIZADO",
  "PAGO_APLICADO_A_SOLICITUD",
  "PAGO_FINANCIAL_POSTED",
  "PAGO_MONTO_CORREGIDO_RECHAZO_IQ",
  "PAGO_POSTEO_FINANCIERO_PENDIENTE",
  "DOCUMENTO_PAGO_SUBIDO",
  "DOCUMENTO_PAGO_DESACTIVADO",
  "DISPERSION_REGISTRADA",
  "DISPERSION_INCIDENCIA_ABIERTA",
  "DISPERSION_INCIDENCIA_RESUELTA",
  "IQ_SOLICITUD_CREACION_INICIADA",
  "IQ_SOLICITUD_CREACION_EXITOSA",
  "IQ_SOLICITUD_CREACION_FALLIDA",
  "IQ_SOLICITUD_RESULTADO_INCIERTO",
  "IQ_PAGO_CREADO",
  "IQ_PAGO_VINCULADO",
  "IQ_PAGO_CONCILIADO",
  "IQ_PAGO_REQUIERE_REVISION",
  "IQ_PAGO_ERROR",
  "IQ_PAGO_RECHAZADO",
  "IQ_PAGO_CANCELADO",
  "IQ_PAGO_NUEVO_COMPROBANTE",
  "IQ_PAGO_MONTO_CORREGIDO",
  "FACTURA_BORRADOR_CREADO",
  "FACTURA_EMITIDA",
  "OPERACION_RECUPERADA",
  "OPERACION_RECUPERACION_FALLIDA",
]);

function clean(value: unknown, max = 1000): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function caseTypeFromPayload(payload: Record<string, any>): string {
  const direct = clean(payload.referenceType || payload.entityType || payload.relatedEntityType, 40);
  if (direct) return direct.toUpperCase();

  const event = clean(payload.event || payload.type, 80);
  if (event.startsWith("PAGO_") || event.startsWith("IQ_PAGO_")) return "PAGO";
  if (event.startsWith("DISPERSION_")) return "DISPERSION";
  if (event.startsWith("DOCUMENTO_")) return "DOCUMENTO";
  if (event.startsWith("FACTURA_")) return "FACTURACION";
  if (event.startsWith("IQ_")) return "IQ";
  return "OPERACION";
}

function caseIdFromPayload(payload: Record<string, any>, activityId: string): string {
  return clean(payload.referenceId || payload.entityId || payload.relatedEntityId || payload.referenceFolio || activityId, 160);
}

function buildObservationPayload(
  activityId: string,
  payload: Record<string, any>,
): Record<string, any> | null {
  const event = clean(payload.event || payload.type, 120);
  if (!OBSERVED_EVENTS.has(event)) return null;
  if (event === "AGENTE_007_OBSERVACION") return null;

  const rootId = clean(payload.rootId, 128);
  if (!rootId) return null;

  const caseType = caseTypeFromPayload(payload);
  const caseId = caseIdFromPayload(payload, activityId);
  const eventLabel = clean(payload.eventLabel || event, 200);
  const description = clean(payload.description || payload.text || eventLabel, 700);

  return {
    rootId,
    agentId: "AGENTE_007",
    phase: "OBSERVATION",
    source: "ACTIVITY_LOG",
    sourceActivityId: activityId,
    sourceEvent: event,
    caseType,
    caseId,
    intent: `Observar evento operativo: ${eventLabel}`,
    humanDecision: clean(payload.actorRole || "SYSTEM", 120),
    outcome: description,
    actorUid: clean(payload.actorUid, 128),
    actorRole: clean(payload.actorRole, 80),
    authorization: {
      role: clean(payload.actorRole, 80),
      scope: "rootId",
      rootId,
    },
    signal: {
      event,
      eventModule: clean(payload.eventModule, 80),
      eventCategory: clean(payload.eventCategory, 80),
      eventSeverity: clean(payload.eventSeverity, 80),
      amount: typeof payload.amount === "number" ? payload.amount : null,
      referenceFolio: clean(payload.referenceFolio || payload.referencia || payload.reference || payload.authorization, 120) || null,
      detectedBankName: clean(payload.detectedBankName, 120) || null,
      detectedSenderName: clean(payload.detectedSenderName, 180) || null,
      detectedBeneficiaryName: clean(payload.detectedBeneficiaryName, 180) || null,
      detectedSourceAccount: clean(payload.detectedSourceAccount, 80) || null,
      detectedDestinationAccount: clean(payload.detectedDestinationAccount, 80) || null,
      operatorSelectedBankName: clean(payload.operatorSelectedBankName, 120) || null,
      operatorSelectedAccount: clean(payload.operatorSelectedAccount, 80) || null,
      bankIdentificationNeedsReview: payload.bankIdentificationNeedsReview === true,
    },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    expiresAt: null,
  };
}

function buildRecommendationPayload(activityId: string, payload: Record<string, any>) {
  const observation = buildObservationPayload(activityId, payload);
  if (!observation) return null;
  const signal: any = observation.signal || {};
  const event = String(signal.event || "");
  const bankNeedsReview = signal.bankIdentificationNeedsReview === true;
  const requiresPaymentReview = ["IQ_PAGO_REQUIERE_REVISION", "PAGO_POSTEO_FINANCIERO_PENDIENTE"].includes(event);
  // Uploading an OC alone is not a concrete human decision. It remains in
  // observations, but Hugo only creates a confirmation when it has an actual
  // conflicting value or an unresolved operational exception.
  if (!bankNeedsReview && !requiresPaymentReview) return null;
  const kind = bankNeedsReview ? "BANK_CLASSIFICATION" : "PAYMENT_RECONCILIATION";
  const proposed = bankNeedsReview
    ? (signal.operatorSelectedBankName || signal.detectedBankName || "")
    : "Revisar la conciliación pendiente del pago";
  return {
    rootId: observation.rootId,
    agentId: "AGENTE_007",
    phase: "SUPERVISED_ASSISTANCE",
    status: "PENDING_REVIEW",
    kind,
    caseType: observation.caseType,
    caseId: observation.caseId,
    sourceActivityId: activityId,
    sourceEvent: event,
    proposal: proposed,
    confidence: bankNeedsReview && signal.operatorSelectedBankName ? 0.75 : 0.5,
    title: bankNeedsReview ? "Revisión de identificación bancaria" : "Revisión de conciliación de pago",
    explanation: bankNeedsReview
      ? "Detecté una posible diferencia entre el banco identificado y el seleccionado por el operador."
      : "Detecté una excepción que todavía puede modificar la conciliación del pago.",
    actionPrompt: bankNeedsReview ? "¿La identificación bancaria actual es correcta?" : "¿Debemos conservar la conciliación propuesta?",
    requiresHumanDecision: true,
    evidence: {
      detectedBankName: signal.detectedBankName || null,
      operatorSelectedBankName: signal.operatorSelectedBankName || null,
      referenceFolio: signal.referenceFolio || null,
    },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function buildProactiveMessage(activityId: string, payload: Record<string, any>, recommendation: any) {
  const observation = buildObservationPayload(activityId, payload);
  if (!observation) return null;
  const event = clean(payload.event || payload.type, 120);
  const important = new Set([
    "BENEFICIARIO_CREADO",
    "COMPLEMENTO_PAGO_SEGUIMIENTO",
    "PAGO_APLICADO_A_SOLICITUD",
    "DISPERSION_REGISTRADA",
    "DISPERSION_INCIDENCIA_ABIERTA",
    "DISPERSION_INCIDENCIA_RESUELTA",
    "OPERACION_RECUPERACION_FALLIDA",
    "OPERACION_RECUPERADA",
    "FACTURA_EMITIDA",
    "IQ_SOLICITUD_CREACION_FALLIDA",
    "IQ_SOLICITUD_RESULTADO_INCIERTO",
    "IQ_PAGO_REQUIERE_REVISION",
    "IQ_PAGO_ERROR",
    "PAGO_POSTEO_FINANCIERO_PENDIENTE",
    "FACTURA_BORRADOR_CREADO",
    "COTIZACION_GENERADA",
    "CONSTANCIA_RECEPCION_GENERADA",
  ]);
  if (!recommendation && !important.has(event)) return null;
  const folio = clean(payload.referenceFolio || payload.folio || observation.signal?.referenceFolio, 80);
  const description = clean(payload.description || observation.outcome, 500);
  const text = recommendation
    ? `Detecté algo que conviene revisar${folio ? ` en ${folio}` : ""}: ${clean(recommendation.proposal, 300)}. Te dejé la propuesta para confirmarla o corregirla.`
    : `Vi esta actualización${folio ? ` en ${folio}` : ""}: ${description}`;
  return {
    rootId: observation.rootId,
    conversationId: `${observation.rootId}_${observation.rootId}`,
    role: "assistant",
    text,
    source: "SYSTEM_EVENT",
    sourceActivityId: activityId,
    sourceEvent: event,
    recipientUid: observation.rootId,
    relatedCaseType: observation.caseType,
    relatedCaseId: observation.caseId,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  };
}

export async function observeActivityForAgent007(
  db: Firestore,
  activityId: string,
  payload: Record<string, any>,
) {
  const observation = buildObservationPayload(activityId, payload);
  if (!observation) return;

  await db.collection("agent007Observations").doc(`activity_${activityId}`).set(observation, { merge: true });
  const recommendation = buildRecommendationPayload(activityId, payload);
  if (recommendation) await db.collection("agent007Recommendations").doc(`activity_${activityId}`).set(recommendation, { merge: true });
  const proactiveMessage = buildProactiveMessage(activityId, payload, recommendation);
  if (proactiveMessage) await db.collection("agent007Messages").doc(`notice_${activityId}`).set(proactiveMessage, { merge: true });
}

export function observeActivityForAgent007Tx(
  tx: Transaction,
  db: Firestore,
  activityId: string,
  payload: Record<string, any>,
) {
  const observation = buildObservationPayload(activityId, payload);
  if (!observation) return;

  tx.set(db.collection("agent007Observations").doc(`activity_${activityId}`), observation, { merge: true });
  const recommendation = buildRecommendationPayload(activityId, payload);
  if (recommendation) tx.set(db.collection("agent007Recommendations").doc(`activity_${activityId}`), recommendation, { merge: true });
  const proactiveMessage = buildProactiveMessage(activityId, payload, recommendation);
  if (proactiveMessage) tx.set(db.collection("agent007Messages").doc(`notice_${activityId}`), proactiveMessage, { merge: true });
}

export function observeActivityForAgent007Batch(
  batch: WriteBatch,
  db: Firestore,
  activityId: string,
  payload: Record<string, any>,
) {
  const observation = buildObservationPayload(activityId, payload);
  if (!observation) return;

  batch.set(db.collection("agent007Observations").doc(`activity_${activityId}`), observation, { merge: true });
  const recommendation = buildRecommendationPayload(activityId, payload);
  if (recommendation) batch.set(db.collection("agent007Recommendations").doc(`activity_${activityId}`), recommendation, { merge: true });
  const proactiveMessage = buildProactiveMessage(activityId, payload, recommendation);
  if (proactiveMessage) batch.set(db.collection("agent007Messages").doc(`notice_${activityId}`), proactiveMessage, { merge: true });
}
