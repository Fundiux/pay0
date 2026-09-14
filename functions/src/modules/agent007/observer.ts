import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

const OBSERVED_EVENTS = new Set([
  "SOLICITUD_CREADA",
  "SOLICITUD_CANCELADA",
  "SOLICITUD_COMPLETADA",
  "SOLICITUD_RECHAZADA",
  "SOLICITUD_STATUS_ACTUALIZADO",
  "DOCUMENTO_SOLICITUD_SUBIDO",
  "DOCUMENTO_SOLICITUD_DESACTIVADO",
  "PAGO_CREADO",
  "PAGO_STATUS_ACTUALIZADO",
  "PAGO_APLICADO_A_SOLICITUD",
  "PAGO_FINANCIAL_POSTED",
  "PAGO_POSTEO_FINANCIERO_PENDIENTE",
  "DISPERSION_REGISTRADA",
  "DISPERSION_INCIDENCIA_ABIERTA",
  "DISPERSION_INCIDENCIA_RESUELTA",
  "IQ_SOLICITUD_CREACION_INICIADA",
  "IQ_SOLICITUD_CREACION_EXITOSA",
  "IQ_SOLICITUD_CREACION_FALLIDA",
  "IQ_SOLICITUD_RESULTADO_INCIERTO",
  "IQ_PAGO_CREADO",
  "IQ_PAGO_CONCILIADO",
  "IQ_PAGO_ERROR",
  "FACTURA_BORRADOR_CREADO",
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

export async function observeActivityForAgent007(
  db: Firestore,
  activityId: string,
  payload: Record<string, any>,
) {
  const event = clean(payload.event || payload.type, 120);
  if (!OBSERVED_EVENTS.has(event)) return;
  if (event === "AGENTE_007_OBSERVACION") return;

  const rootId = clean(payload.rootId, 128);
  if (!rootId) return;

  const caseType = caseTypeFromPayload(payload);
  const caseId = caseIdFromPayload(payload, activityId);
  const eventLabel = clean(payload.eventLabel || event, 200);
  const description = clean(payload.description || payload.text || eventLabel, 700);

  await db.collection("agent007Observations").doc(`activity_${activityId}`).set({
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
      referenceFolio: clean(payload.referenceFolio, 120) || null,
    },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    expiresAt: null,
  }, { merge: true });
}
