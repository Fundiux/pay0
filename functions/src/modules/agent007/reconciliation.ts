import { FieldValue, Firestore } from "firebase-admin/firestore";
import { FirestoreHugoDataStore } from "./firestoreHugoDataStore";

const clean = (value: unknown, max = 160) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
const ISSUED = new Set([
  "PRODUCTION_ISSUED",
  "ISSUED",
  "TIMBRADO",
  "EMITIDA",
  "EMITIDO",
]);
const PAYMENT_RESOLVED = new Set([
  "CONCILIADO",
  "APLICADO",
  "COMPLETADO",
  "COMPLETADA",
  "CANCELADO",
  "CANCELADA",
  "RECHAZADO",
  "RECHAZADA",
]);

function issuedSolicitud(row: Record<string, any>): boolean {
  return (
    Boolean(clean(row.facturaUuid || row.uuidCfdi || row.iqInvoiceUuid, 80)) ||
    ISSUED.has(
      clean(
        row.facturamaStatus || row.invoiceStatus || row.status,
        80,
      ).toUpperCase(),
    )
  );
}

async function relatedSolicitud(
  db: Firestore,
  recommendation: Record<string, any>,
): Promise<Record<string, any> | null> {
  const direct = clean(recommendation.caseId);
  if (direct) {
    const snap = await db.doc(`solicitudes/${direct}`).get();
    if (snap.exists) return { id: snap.id, ...(snap.data() || {}) };
  }
  const folio = clean(recommendation.evidence?.referenceFolio, 80);
  if (!folio) return null;
  for (const field of ["folio", "folioIq"]) {
    const snap = await db
      .collection("solicitudes")
      .where("rootId", "==", recommendation.rootId)
      .where(field, "==", folio)
      .limit(1)
      .get();
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }
  return null;
}

function presentation(row: Record<string, any>) {
  const kind = clean(row.kind, 80).toUpperCase();
  if (kind === "OC_FISCAL_REVIEW")
    return {
      title: "Revisión de clasificación SAT",
      explanation:
        "Detecté que la orden de compra fue incorporada, pero no existe una clasificación alternativa concreta que requiera tu decisión.",
      actionPrompt: null,
    };
  if (kind === "PAYMENT_RECONCILIATION")
    return {
      title: "Revisión de conciliación de pago",
      explanation:
        "Detecté una excepción durante la conciliación del pago. Sólo requiere confirmación mientras el pago siga sin resolverse.",
      actionPrompt: "¿Debemos conservar la conciliación propuesta?",
    };
  if (kind === "BANK_CLASSIFICATION")
    return {
      title: "Revisión de identificación bancaria",
      explanation:
        "Detecté una posible diferencia entre el banco identificado y el seleccionado por el operador.",
      actionPrompt: "¿La identificación bancaria actual es correcta?",
    };
  return {
    title: clean(row.title || "Revisión operativa", 120),
    explanation: clean(
      row.explanation ||
        row.proposal ||
        "Hugo detectó una condición que conviene revisar.",
      600,
    ),
    actionPrompt:
      row.requiresHumanDecision === false
        ? null
        : clean(row.actionPrompt || "¿La información actual es correcta?", 240),
  };
}

export async function reconcileAgent007Recommendations(
  db: Firestore,
  rootId: string,
  limit = 100,
) {
  const snapshot = await new FirestoreHugoDataStore(db).pendingRecommendations(rootId, limit).get();
  let changed = 0;
  for (const doc of snapshot.docs) {
    const row = doc.data();
    const kind = clean(row.kind, 80).toUpperCase();
    const visible = presentation(row);
    let patch: Record<string, any> = { ...visible };
    let shouldWrite =
      row.title !== visible.title ||
      row.explanation !== visible.explanation ||
      row.actionPrompt !== visible.actionPrompt;
    if (kind === "OC_FISCAL_REVIEW") {
      const solicitud = await relatedSolicitud(db, row);
      if (solicitud && issuedSolicitud(solicitud)) {
        patch = {
          ...patch,
          status: "SUPERSEDED",
          requiresHumanDecision: false,
          resolvedAt: FieldValue.serverTimestamp(),
          resolvedByEvent: "CFDI_ISSUED",
          supersededBy: clean(
            solicitud.facturamaInvoiceId ||
              solicitud.iqInvoiceJobId ||
              solicitud.id,
          ),
          resolutionReason: "CFDI_ALREADY_ISSUED",
          explanation: `La observación se conserva para aprendizaje, pero ya no requiere acción porque el CFDI de ${clean(solicitud.folio || solicitud.id)} fue emitido.`,
          actionPrompt: null,
        };
        shouldWrite = true;
      } else {
        // A generic OC upload is evidence, not a concrete decision. Preserve it
        // as history without forcing Correcto/Corregir.
        patch = {
          ...patch,
          status: "OBSERVATION_ONLY",
          requiresHumanDecision: false,
          resolvedAt: FieldValue.serverTimestamp(),
          resolvedByEvent: "ACTIONABILITY_RECONCILIATION",
          resolutionReason: "NO_CONCRETE_HUMAN_DECISION",
          actionPrompt: null,
        };
        shouldWrite = true;
      }
    } else if (
      ["PAYMENT_RECONCILIATION", "BANK_CLASSIFICATION"].includes(kind)
    ) {
      const pago = await db.doc(`pagos/${clean(row.caseId)}`).get();
      const status = clean(
        pago.data()?.status || pago.data()?.estatus,
        80,
      ).toUpperCase();
      if (pago.exists && PAYMENT_RESOLVED.has(status)) {
        patch = {
          ...patch,
          status: "RESOLVED_BY_SYSTEM_EVENT",
          requiresHumanDecision: false,
          resolvedAt: FieldValue.serverTimestamp(),
          resolvedByEvent: `PAGO_${status}`,
          supersededBy: pago.id,
          resolutionReason: "PAYMENT_ALREADY_RESOLVED",
          actionPrompt: null,
        };
        shouldWrite = true;
      }
    }
    if (shouldWrite) {
      await doc.ref.set(
        { ...patch, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      changed += 1;
    }
  }
  return changed;
}
