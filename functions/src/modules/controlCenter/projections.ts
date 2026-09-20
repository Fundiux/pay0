import { createHash } from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "../sharedCallables/helpers";
import { getCanonicalPeriodKeys, AnalyticsModule } from "./contract";
import { analyticsEventRecord } from "./eventStore";

export const ANALYTIC_SOURCES = ["solicitudes", "pagos", "pagoAplicaciones", "facturamaInvoices", "materialityOperations", "balanceAccounts", "balanceMovements", "clientAdvances", "clientDispersions", "agent007Recommendations", "agent007LearnedRules", "operationRecoveryJobs", "recognizedExpenses", "iqInvoiceJobs", "iqCreateJobs", "iqStatusJobs", "iqPagoReceiptJobs", "iqPagoDepositStatusJobs", "documentDeliveryJobs", "telegramClientNotificationEvents"] as const;
export type AnalyticSource = typeof ANALYTIC_SOURCES[number];
export type Metrics = Record<string, number>;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const minor = (value: any) => { const n = Math.round(Number(value || 0) * 100); if (!Number.isSafeInteger(n)) throw Error("INVALID_ANALYTIC_AMOUNT"); return n; };
const terminal = new Set(["CANCELADA", "CANCELADO", "CANCELLED", "CANCELED", "RECHAZADA", "RECHAZADO", "COMPLETADA", "COMPLETADO", "CERRADA", "CERRADO"]);

export function contribution(source: AnalyticSource, row: any): Metrics {
  if (!row || row.isDeleted) return {};
  const status = String(row.status || "").toUpperCase();
  const metrics: Metrics = {};
  const gross = () => minor(row.montoTotalCanonico ?? row.montoTotal ?? row.monto ?? row.amount ?? row.total);
  switch (source) {
    case "solicitudes":
      metrics.requests = 1; metrics.requestsOpen = terminal.has(status) ? 0 : 1;
      metrics.requestsWithInvoice = row.facturaUuid || row.uuidCfdi ? 1 : 0;
      metrics.requestsWithPayment = Number(row.totalAbonado || 0) > 0 ? 1 : 0;
      break;
    case "pagos":
      if (!terminal.has(status)) {
        metrics.paymentsRegisteredMinor = gross(); metrics.payments = 1;
        if (!["CONCILIADO", "APLICADO"].includes(status)) { metrics.paymentsPending = 1; metrics.paymentsPendingMinor = gross(); }
      }
      if (row.financialPostingStatus === "POSTED" && !terminal.has(status)) {
        metrics.commissionRootMinor = minor(row.superadminAmount);
        metrics.walletReleasedMinor = minor(row.walletClientAmount);
      }
      break;
    case "pagoAplicaciones": if (status === "APLICADA") metrics.appliedMinor = minor(row.montoAplicado); break;
    case "facturamaInvoices":
      metrics.invoices = 1;
      if (!["PRODUCTION_ISSUED", "SANDBOX_ISSUED", "ISSUED"].includes(status) && !terminal.has(status)) metrics.invoicesPending = 1;
      if (row.environment !== "PRODUCTION") break;
      if (status === "PRODUCTION_ISSUED" && !["CANCELED", "CANCELLED", "ACCEPTED", "ACEPTED", "CANCELADO", "CANCELADA"].includes(String(row.cancellationStatus || "").toUpperCase())) {
        metrics.invoicesIssued = 1;
        // Never derive a tax-inclusive total from subtotal using an assumed rate.
        if (row.total !== undefined && row.total !== null) metrics.invoicedMinor = minor(row.total);
        else metrics.invoicesMissingTotal = 1;
      }
      break;
    case "materialityOperations": metrics.files = 1; metrics.filesComplete = status === "COMPLETE" ? 1 : 0; break;
    case "balanceAccounts": if (row.holderType === "CLIENT") metrics.clientWalletMinor = minor(row.availableBalance); break;
    case "balanceMovements": if (status === "APPLIED") metrics[row.direction === "OUT" ? "walletOutMinor" : "walletInMinor"] = minor(row.amount); break;
    case "clientAdvances": metrics.advancePendingMinor = minor(row.pendingAmount); break;
    case "clientDispersions": metrics.dispersions = 1; metrics.dispersionsPending = terminal.has(status) || status === "COMPLETED" ? 0 : 1; break;
    case "agent007Recommendations": metrics.hugoProposals = 1; metrics.hugoPending = status === "PENDING_REVIEW" ? 1 : 0; break;
    case "agent007LearnedRules": metrics.hugoRules = Number(row.approvals || 0) > Number(row.rejections || 0) ? 1 : 0; break;
    case "operationRecoveryJobs": metrics.recoveryPending = ["PENDING", "RUNNING"].includes(status) ? 1 : 0; metrics.recoveryBlocked = status === "NEEDS_REVIEW" ? 1 : 0; break;
    case "recognizedExpenses": if (status === "RECOGNIZED") { if (!Number.isSafeInteger(row.amountMinor) || row.amountMinor <= 0) throw Error("INVALID_EXPENSE_AMOUNT"); metrics.expensesMinor = row.amountMinor; } break;
    case "iqInvoiceJobs": case "iqCreateJobs": case "iqStatusJobs": case "iqPagoReceiptJobs": case "iqPagoDepositStatusJobs":
    case "documentDeliveryJobs": case "telegramClientNotificationEvents": {
      const prefix = source === "documentDeliveryJobs" ? "whatsapp" : source === "telegramClientNotificationEvents" ? "telegram" : "iq";
      metrics[`${prefix}Jobs`] = 1;
      metrics[`${prefix}Failed`] = /ERROR|FAILED|FAILURE|REJECTED/.test(status) ? 1 : 0;
      metrics[`${prefix}Pending`] = ["PENDING", "QUEUED", "PROCESSING", "RUNNING", "RETRY", "READY_FOR_MANUAL_SEND"].includes(status) ? 1 : 0;
      metrics[`${prefix}Succeeded`] = ["SENT", "SUCCEEDED", "SUCCESS", "COMPLETED", "DONE"].includes(status) ? 1 : 0;
      break;
    }
  }
  return metrics;
}

export function analyticDimensions(row: any): Record<string, string> {
  const values = {
    companyId: row.companyId || row.empresaId, clientId: row.clientId || row.clienteId || row.sourceClienteId || (row.holderType === "CLIENT" ? row.holderId : null),
    userId: row.operationalOwnerId || row.createdBy, despachoId: row.despachoId,
    operationTypeKey: row.operationTypeKey, bankId: row.bankId || row.bankName,
    destinationAccountId: row.destinationAccountId, status: row.status,
  };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === "string" && value).map(([key, value]) => [key, String(value)]));
}

// Read the current source inside the transaction: delayed/out-of-order events
// cannot revert newer contributions. Retries and backfills use this same path.
export async function projectSource(source: AnalyticSource, id: string) {
  const ref = db.collection(source).doc(id);
  const stateRef = db.collection("analyticsContributions").doc(hash(`${source}:${id}`));
  await db.runTransaction(async tx => {
    const [snap, state] = await Promise.all([tx.get(ref), tx.get(stateRef)]);
    let row = snap.data(); const previous = state.data();
    const rootId = String(row?.rootId || previous?.rootId || "");
    if (!rootId) return;
    if (previous?.rootId && previous.rootId !== rootId) throw Error("ANALYTIC_ROOT_CHANGED");
    const solicitudId = row?.solicitudId || row?.sourceSolicitudId;
    if (row && source !== "solicitudes" && typeof solicitudId === "string" && solicitudId && !solicitudId.includes("/")) {
      const parent = (await tx.get(db.collection("solicitudes").doc(solicitudId))).data();
      if (parent?.rootId === rootId) row = { ...row,
        companyId: row.companyId || row.empresaId || parent.companyId || parent.empresaId || "",
        clientId: row.clientId || row.clienteId || parent.clienteId || parent.clientId || "",
        companyName: row.companyName || parent.companyName || parent.empresaNombre || "",
        clientName: row.clientName || parent.clientName || parent.clienteNombre || "",
      };
    }
    const at = row?.reportDateAt || row?.facturamaIssuedAt || row?.createdAt || snap.createTime || Timestamp.now();
    const date = at instanceof Timestamp ? at.toDate() : new Date(at);
    if (!Number.isFinite(date.getTime())) throw Error("ANALYTIC_DATE_INVALID");
    const periods = getCanonicalPeriodKeys(date);
    const metrics = contribution(source, row);
    const dimensions = analyticDimensions(row || {});
    const buckets: string[] = [];
    for (const [periodType, period] of Object.entries({ ...periods, all: "all" })) {
      buckets.push(`${periodType}:${period}:all`);
      for (const [key, value] of Object.entries(dimensions)) buckets.push(`${periodType}:${period}:${key}:${value}`);
    }
    const signature = hash(JSON.stringify({ metrics, buckets }));
    if (previous?.signature === signature) return;
    for (const [dimension, value] of Object.entries(dimensions)) {
      const label = dimension === "companyId" ? row?.companyName || row?.empresaNombre : dimension === "clientId" ? row?.clientName || row?.clienteNombre : value;
      tx.set(db.collection("analyticsRoots").doc(rootId).collection("facets").doc(hash(`${dimension}:${value}`)), { dimension, value, label: String(label || value), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    const deltas = new Map<string, Metrics>();
    const add = (keys: string[], values: Metrics, sign: number) => keys.forEach(key => {
      const delta = deltas.get(key) || {};
      for (const [metric, value] of Object.entries(values)) delta[metric] = (delta[metric] || 0) + sign * value;
      deltas.set(key, delta);
    });
    add(previous?.buckets || [], previous?.metrics || {}, -1); add(buckets, metrics, 1);
    for (const [bucket, delta] of deltas) {
      const increments = Object.fromEntries(Object.entries(delta).filter(([, value]) => value !== 0).map(([key, value]) => [key, FieldValue.increment(value)]));
      if (!Object.keys(increments).length) continue;
      tx.set(db.collection("analyticsRoots").doc(rootId).collection("buckets").doc(hash(bucket)), { bucket, metrics: increments, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    const revision = Number(previous?.revision || 0) + 1;
    const module: AnalyticsModule = source === "solicitudes" ? "solicitudes" : source === "pagos" || source === "pagoAplicaciones" ? "pagos" : source === "facturamaInvoices" ? "facturama" : source === "materialityOperations" ? "materialidad" : source.startsWith("agent007") ? "hugo" : source === "recognizedExpenses" ? "gastos" : source.startsWith("balance") || source.startsWith("client") ? "wallet" : "integraciones";
    const eventId = hash(`${rootId}:${source}:${id}:${revision}`);
    tx.create(db.collection("analyticsEvents").doc(eventId), {
      ...analyticsEventRecord({ eventId, rootId, eventType: "SOURCE_RECONCILED", module, entityType: source,
        entityId: id, occurredAt: Timestamp.fromDate(date), sourceVersion: revision, dimensions }),
      metricsBefore: previous?.metrics || {}, metricsAfter: metrics,
    });
    tx.create(db.collection("analyticsRoots").doc(rootId).collection("revisions").doc(hash(`${source}:${id}:${revision}`)), {
      rootId, source, entityId: id, revision, before: previous?.metrics || {}, after: metrics,
      dimensions, businessDate: periods.day, createdAt: FieldValue.serverTimestamp(),
    });
    if (source === "operationRecoveryJobs") {
      const incident = db.collection("analyticsRoots").doc(rootId).collection("incidents").doc(hash(`${source}:${id}`));
      if (["PENDING", "RUNNING", "NEEDS_REVIEW"].includes(row?.status)) tx.set(incident, {
        source, entityId: id, solicitudId: row?.solicitudId || "", kind: row?.kind || "",
        status: row?.status, lastErrorCode: row?.lastErrorCode || "", updatedAt: FieldValue.serverTimestamp(),
      });
      else tx.delete(incident);
    }
    tx.set(stateRef, { rootId, source, entityId: id, signature, revision, buckets, metrics, dimensions, periods, updatedAt: FieldValue.serverTimestamp() });
  });
}

export async function readMetricBucket(rootId: string, periodType: string, period: string, dimension = "all") {
  const key = `${periodType}:${period}:${dimension}`;
  const snap = await db.collection("analyticsRoots").doc(rootId).collection("buckets").doc(hash(key)).get();
  return snap.data()?.metrics as Metrics || {};
}
