import { createHash } from "crypto";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { db } from "../sharedCallables/helpers";
import { context } from "../controlCenter/callables";
import { logActivityTx } from "../../utils/logActivity";

const clean = (v: unknown) => String(v || "").trim();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const complementRequestId = (rootId: string, applicationId: string) => createHash("sha256").update(`${rootId}:${applicationId}`).digest("hex");

// Follow-up is NOT a request sent to IQ. The external contract has not yet been
// supplied. Never infer receipt from a generic PDF or a local application alone.
export async function reconcilePaymentComplement(applicationId: string, deletedApplication?: Record<string, any>) {
  await db.runTransaction(async tx => {
    const current = await tx.get(db.doc(`pagoAplicaciones/${applicationId}`));
    const app = current.data() || deletedApplication;
    if (!app?.rootId) return;
    const requestRef = db.doc(`paymentComplementRequests/${complementRequestId(app.rootId, applicationId)}`);
    const existing = await tx.get(requestRef);
    const required = app.invoiceType === "PPD" || app.requiresComplement === true || app.requiresPaymentComplement === true;
    if (!required && !existing.exists) return;
    const solicitudId = clean(app.solicitudId), pagoId = clean(app.pagoId);
    if (!solicitudId || !pagoId || solicitudId.includes("/") || pagoId.includes("/")) throw Error("COMPLEMENT_SOURCE_INVALID");
    const [solicitudSnap, pagoSnap] = await Promise.all([tx.get(db.doc(`solicitudes/${solicitudId}`)), tx.get(db.doc(`pagos/${pagoId}`))]);
    const solicitud = solicitudSnap.data(), pago = pagoSnap.data();
    if (!solicitud || !pago || solicitud.rootId !== app.rootId || pago.rootId !== app.rootId) throw Error("COMPLEMENT_SCOPE_MISMATCH");
    const invoiceUuid = clean(solicitud.facturaUuid || solicitud.uuidCfdi || solicitud.iqInvoiceUuid).toUpperCase();
    const provider = solicitud.facturamaEnvironment === "PRODUCTION" && solicitud.facturamaInvoiceId ? "FACTURAMA" : clean(solicitud.iqId || solicitud.iqFolio || solicitud.folioIq || solicitud.iqSolicitudId) ? "IQ" : "EMISOR";
    const appliedInIq = app.iqApplicationStatus === "IQ_APPLIED" && app.iqActionExecuted === true;
    const amountMinor = Math.round(Number(app.montoAplicado || 0) * 100);
    const fiscalComplete = uuid.test(invoiceUuid) && Number.isSafeInteger(amountMinor) && amountMinor > 0;
    const cancelled = [solicitud.status, pago.status].some(value => ["CANCELADA", "CANCELADO", "RECHAZADA", "RECHAZADO"].includes(clean(value).toUpperCase()));
    const status = !current.exists || !required || app.status !== "APLICADA" || cancelled ? "VOIDED"
      : !fiscalComplete ? "NEEDS_FISCAL_DATA"
      : provider === "IQ" && !appliedInIq ? "WAITING_IQ_APPLICATION" : "PENDING_PROVIDER_CONTRACT";
    const row = { rootId: app.rootId, applicationId, solicitudId, pagoId,
      solicitudFolio: clean(solicitud.folio), pagoFolio: clean(pago.folio), applicationFolio: clean(app.folio),
      provider, invoiceUuid: invoiceUuid || null, amountMinor: Number.isSafeInteger(amountMinor) ? amountMinor : null,
      installment: Number(app.numeroParcialidad || 0), balanceBefore: Number(app.saldoAnterior || 0), balanceAfter: Number(app.saldoInsoluto || 0),
      iqApplicationId: clean(app.iqApplicationId) || null, status, externalRequestSent: false };
    const fingerprint = createHash("sha256").update(JSON.stringify(row)).digest("hex");
    if (existing.data()?.fingerprint === fingerprint) return;
    // Future imported evidence must not be overwritten by a source projection.
    if (["RECEIVED", "REQUESTED"].includes(existing.data()?.status)) return;
    const revision = Number(existing.data()?.revision || 0) + 1;
    tx.set(requestRef, { ...row, externalRequestSent: existing.data()?.externalRequestSent === true, fingerprint, revision, createdAt: existing.data()?.createdAt || FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    logActivityTx(tx, db, { event: "COMPLEMENTO_PAGO_SEGUIMIENTO", rootId: app.rootId,
      actorUid: "SYSTEM", actorRole: "system", referenceId: applicationId, referenceType: "pagoAplicacion",
      referenceFolio: clean(app.folio), relatedEntityId: solicitudId, relatedEntityType: "solicitud",
      description: status === "VOIDED" ? `El seguimiento del complemento de ${clean(solicitud.folio)} dejó de ser aplicable.`
        : `Complemento pendiente para ${clean(solicitud.folio)}: ${{ NEEDS_FISCAL_DATA: "faltan UUID o importe válidos", WAITING_IQ_APPLICATION: "la aplicación todavía no está confirmada en IQ", PENDING_PROVIDER_CONTRACT: "pendiente de procesamiento o revisión" }[status]}.${existing.data()?.externalRequestSent ? " Consulta el estado del envío existente; no se enviará nuevamente desde el seguimiento." : " No se ha solicitado ni emitido en el proveedor."}`,
    });
  });
}

export const trackPaymentComplement = onDocumentWritten({ document: "pagoAplicaciones/{applicationId}", region: "us-central1", retry: true }, async event => {
  await reconcilePaymentComplement(event.params.applicationId, event.data?.before.data());
});

async function refreshParentApplications(field: "solicitudId" | "pagoId", id: string) {
  let cursor: string | undefined;
  while (true) {
    let query = db.collection("pagoAplicaciones").where(field, "==", id).orderBy(FieldPath.documentId()).limit(50);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const doc of page.docs) await reconcilePaymentComplement(doc.id);
    if (page.size < 50) return;
    cursor = page.docs.at(-1)?.id;
  }
}

export const refreshComplementOnSolicitud = onDocumentWritten({ document: "solicitudes/{solicitudId}", region: "us-central1", retry: true, timeoutSeconds: 540 }, async event => {
  if (!event.data?.after.exists) return;
  const before = event.data.before.data() || {}, after = event.data.after.data() || {};
  if (["facturaUuid", "uuidCfdi", "iqInvoiceUuid", "iqFolio", "folioIq", "iqSolicitudId", "status"].some(key => before[key] !== after[key])) await refreshParentApplications("solicitudId", event.params.solicitudId);
});

export const refreshComplementOnPago = onDocumentWritten({ document: "pagos/{pagoId}", region: "us-central1", retry: true, timeoutSeconds: 540 }, async event => {
  if (event.data?.after.exists && event.data.before.data()?.status !== event.data.after.data()?.status) await refreshParentApplications("pagoId", event.params.pagoId);
});

export const listPaymentComplementFollowup = onCall({ region: "us-central1", cors: true }, async request => {
  const { rootId } = await context(request);
  const rows = await db.collection("paymentComplementRequests").where("rootId", "==", rootId).orderBy("createdAt", "desc").limit(101).get();
  const config = (await db.doc(`paymentComplementConfigs/${rootId}`).get()).data();
  return { ok: true, rows: rows.docs.slice(0, 100).map(doc => ({ id: doc.id, ...doc.data() })), truncated: rows.size > 100,
    automation: { iqEnabled: config?.iqEnabled === true, facturamaEnabled: config?.facturamaEnabled === true }, externalContractReady: true };
});

// Explicit, read/reconcile-only refresh also covers earlier applications and
// fiscal data corrected after applying a payment. Never calls an external API.
export const refreshPaymentComplementFollowup = onCall({ region: "us-central1", cors: true, timeoutSeconds: 120 }, async request => {
  const { rootId } = await context(request);
  const cursor = clean(request.data?.cursor);
  if (cursor.includes("/") || cursor.length > 200) throw new HttpsError("invalid-argument", "Cursor inválido.");
  let query = db.collection("pagoAplicaciones").where("rootId", "==", rootId).orderBy(FieldPath.documentId()).limit(50);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get();
  for (const doc of page.docs) await reconcilePaymentComplement(doc.id);
  return { ok: true, processed: page.size, complete: page.size < 50, cursor: page.docs.at(-1)?.id || null };
});
