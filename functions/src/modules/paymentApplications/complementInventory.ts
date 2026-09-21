import { FieldPath } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db } from "../sharedCallables/helpers";
import { context } from "../controlCenter/callables";
import { complementRequestId } from "./complementFollowup";

type Outcome = "PROCESSED" | "PENDING" | "ERROR" | "EXCLUDED";
type Provider = "IQ" | "FACTURAMA" | "EMISOR";
type Count = { scanned: number; detected: number; processed: number; pending: number; errors: number; excluded: number; iq: number; facturama: number; emisor: number };

const clean = (value: unknown) => String(value ?? "").trim();
const upper = (value: unknown) => clean(value).toUpperCase();
const terminal = new Set(["CANCELADA", "CANCELADO", "RECHAZADA", "RECHAZADO"]);
const count = (): Count => ({ scanned: 0, detected: 0, processed: 0, pending: 0, errors: 0, excluded: 0, iq: 0, facturama: 0, emisor: 0 });

function providerFor(solicitud: any): Provider {
  if (solicitud?.facturamaEnvironment === "PRODUCTION" && solicitud?.facturamaInvoiceId) return "FACTURAMA";
  if ([solicitud?.iqId, solicitud?.iqFolio, solicitud?.folioIq, solicitud?.iqSolicitudId].some(value => clean(value))) return "IQ";
  return "EMISOR";
}

async function classify(applicationId: string, app: any, rootId: string) {
  const base = { applicationId, applicationFolio: clean(app.folio), solicitudFolio: "", pagoFolio: "", provider: "EMISOR" as Provider,
    outcome: "EXCLUDED" as Outcome, reason: "NOT_APPLICABLE" };
  if (app.status !== "APLICADA" || app.invoiceType !== "PPD") return base;
  if (!clean(app.solicitudId) || !clean(app.pagoId) || clean(app.solicitudId).includes("/") || clean(app.pagoId).includes("/"))
    return { ...base, outcome: "ERROR" as Outcome, reason: "SOURCE_ID_INVALID" };
  const [solicitudSnap, pagoSnap, requestSnap, documentsSnap] = await Promise.all([
    db.doc(`solicitudes/${app.solicitudId}`).get(), db.doc(`pagos/${app.pagoId}`).get(),
    db.doc(`paymentComplementRequests/${complementRequestId(rootId, applicationId)}`).get(),
    db.collection("uploads").where("applicationId", "==", applicationId).get(),
  ]);
  const solicitud = solicitudSnap.data(), pago = pagoSnap.data(), request = requestSnap.data();
  if (!solicitud || !pago || solicitud.rootId !== rootId || pago.rootId !== rootId || (request && request.rootId !== rootId))
    return { ...base, outcome: "ERROR" as Outcome, reason: "SOURCE_SCOPE_OR_PARENT_MISSING" };
  const provider = providerFor(solicitud);
  const row = { ...base, solicitudFolio: clean(solicitud.folio), pagoFolio: clean(pago.folio), provider };
  if (terminal.has(upper(solicitud.status)) || terminal.has(upper(pago.status))) return { ...row, reason: "SOURCE_TERMINAL" };
  if (solicitud.tipoFactura !== "PPD") return { ...row, outcome: "ERROR" as Outcome, reason: "INVOICE_TYPE_MISMATCH" };
  const uploads = documentsSnap.docs.map(doc => doc.data()).filter(doc => doc.rootId === rootId && doc.pagoId === app.pagoId && doc.solicitudId === app.solicitudId);
  const evidence = (type: string, id: string) => documentsSnap.docs.some(doc => {
    const data = doc.data();
    return doc.id === id && data.rootId === rootId && data.pagoId === app.pagoId && data.solicitudId === app.solicitudId &&
      data.applicationId === applicationId && data.documentType === type && data.status === "READY" && data.active === true &&
      data.complementKey === request?.uuid && data.integritySealStatus === "SEALED" && /^[a-f0-9]{64}$/i.test(data.sha256 || "");
  });
  const received = request?.status === "RECEIVED" && request?.automationStatus === "RECEIVED" &&
    request.applicationId === applicationId && request.solicitudId === app.solicitudId && request.pagoId === app.pagoId && request.provider === provider &&
    request.invoiceUuid === upper(solicitud.facturaUuid || solicitud.uuidCfdi || solicitud.iqInvoiceUuid) &&
    request.installment === app.numeroParcialidad && request.amountMinor === Math.round(Number(app.montoAplicado) * 100) &&
    request.balanceBefore === app.saldoAnterior && request.balanceAfter === app.saldoInsoluto &&
    evidence("COMPLEMENTO_PAGO_XML", request.xmlUploadId) && evidence("COMPLEMENTO_PAGO_PDF", request.pdfUploadId);
  if (received) return { ...row, outcome: "PROCESSED" as Outcome, reason: "VERIFIED_LINKED" };
  if (request?.status === "RECEIVED") return { ...row, outcome: "ERROR" as Outcome, reason: "RECEIPT_EVIDENCE_MISMATCH" };
  if (["BLOCKED", "UNKNOWN", "REVIEW_REQUIRED"].includes(request?.automationStatus) || request?.automationError)
    return { ...row, outcome: "ERROR" as Outcome, reason: clean(request?.automationError || request?.automationStatus) };
  if (uploads.some(doc => doc.active === true && ["COMPLEMENTO_PAGO_XML", "COMPLEMENTO_PAGO_PDF"].includes(doc.documentType)))
    return { ...row, outcome: "PENDING" as Outcome, reason: "DOCUMENTS_NEED_VERIFICATION" };
  if (!request) return { ...row, outcome: "PENDING" as Outcome, reason: "FOLLOWUP_NOT_RECORDED" };
  return { ...row, outcome: "PENDING" as Outcome, reason: clean(request.automationStatus || request.status || "NOT_REQUESTED") };
}

export async function inventoryPage(rootId: string, cursor = "", pageSize = 25) {
  if (!rootId || cursor.includes("/") || cursor.length > 200 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50)
    throw new HttpsError("invalid-argument", "Cursor o tamaño de página inválido.");
  let query = db.collection("pagoAplicaciones").where("rootId", "==", rootId).orderBy(FieldPath.documentId()).limit(pageSize + 1);
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.get(), page = snapshot.docs.slice(0, pageSize);
  const rows = await Promise.all(page.map(doc => classify(doc.id, doc.data(), rootId)));
  const counts = count();
  for (const row of rows) {
    counts.scanned++;
    if (row.outcome === "EXCLUDED") { counts.excluded++; continue; }
    counts.detected++;
    counts[row.outcome === "PROCESSED" ? "processed" : row.outcome === "ERROR" ? "errors" : "pending"]++;
    counts[row.provider === "IQ" ? "iq" : row.provider === "FACTURAMA" ? "facturama" : "emisor"]++;
  }
  return { counts, exceptions: rows.filter(row => row.outcome === "ERROR" || row.outcome === "PENDING"),
    complete: snapshot.size <= pageSize, cursor: page.at(-1)?.id || null, checkedAt: new Date().toISOString() };
}

export const getHugoComplementInventoryPage = onCall({ region: "us-central1", cors: true, timeoutSeconds: 120, memory: "512MiB" }, async request => {
  const { rootId } = await context(request);
  return { ok: true, ...await inventoryPage(rootId, clean(request.data?.cursor), request.data?.pageSize ?? 25) };
});
