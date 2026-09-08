import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  db,
  getMyUser,
  requireAuth,
  requireRole,
  toSafeMoneyNumber,
} from "../sharedCallables/helpers";
import { normalizePagoStatus } from "../pagos/domain";
import { assertAuthorized } from "../../utils/authGuard";
import type {
  EarningsByClientReportInput,
  EarningsByClientReportResult,
  EarningsByClientReportRow,
  EarningsByClientReportSummary,
  PaymentsFinancialPostingIssuesReportInput,
  PaymentsFinancialPostingIssuesReportResult,
  PaymentsFinancialPostingIssuesReportRow,
  PaymentsFinancialPostingIssuesReportSummary,
} from "./types";
import type {
  OperationalIntelligenceReportInput,
  OperationalIntelligenceReportResult,
  OperationalIntelligenceReportSummary,
  OperationalClientRankingRow,
  OperationalUserActivityRow,
  OperationalAlertRow,
} from "./types";

type Pay0ReportRole = "superadmin" | "admin" | "operador";

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function money2(value: unknown): number {
  return toSafeMoneyNumber(value);
}

function normalizeDateInput(value: unknown, endOfDay: boolean): { raw: string | null; millis: number | null } {
  const raw = asText(value);

  if (!raw) {
    return { raw: null, millis: null };
  }

  const dateOnlyMatch = raw.match(/^\d{4}-\d{2}-\d{2}$/);
  const normalized = dateOnlyMatch
    ? `${raw}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
    : raw;

  const date = new Date(normalized);
  const millis = date.getTime();

  if (!Number.isFinite(millis)) {
    throw new HttpsError("invalid-argument", "Rango de fechas invalido.");
  }

  return { raw, millis };
}

function toMillis(value: any): number | null {
  if (!value) return null;

  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    const millis = date?.getTime?.();
    return Number.isFinite(millis) ? millis : null;
  }

  const seconds = Number(value?.seconds ?? value?._seconds);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.round(seconds * 1000);
  }

  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function isoFromMillis(millis: number | null): string | null {
  if (!millis || !Number.isFinite(millis)) return null;
  return new Date(millis).toISOString();
}

function assertDateRange(from: { millis: number | null }, to: { millis: number | null }) {
  if (from.millis && to.millis && from.millis > to.millis) {
    throw new HttpsError("invalid-argument", "dateFrom no puede ser mayor a dateTo.");
  }
}

function isInEarningsScope(role: Pay0ReportRole, uid: string, doc: any): boolean {
  if (role === "superadmin") return true;

  if (role === "admin") {
    return asText(doc.adminId) === uid;
  }

  return asText(doc.operadorId) === uid;
}

function isInPagoScope(role: Pay0ReportRole, uid: string, doc: any): boolean {
  if (role === "superadmin") return true;

  if (role === "admin") {
    return asText(doc.adminId) === uid;
  }

  return asText(doc.operadorId) === uid || asText(doc.createdBy) === uid;
}

function makeEmptyEarningsSummary(): EarningsByClientReportSummary {
  return {
    clientsCount: 0,
    operationsCount: 0,
    grossAmount: 0,
    baseAmount: 0,
    despachoCostAmount: 0,
    superadminEarningAmount: 0,
    adminEarningAmount: 0,
    operadorEarningAmount: 0,
    totalEarningsAmount: 0,
    clientChargeAmount: 0,
    clientNetAmount: 0,
  };
}

function addMoney(row: EarningsByClientReportRow, doc: any) {
  row.operationsCount += 1;
  row.grossAmount = money2(row.grossAmount + money2(doc.grossAmount));
  row.baseAmount = money2(row.baseAmount + money2(doc.baseAmount));
  row.despachoCostAmount = money2(row.despachoCostAmount + money2(doc.despachoCostAmount));
  row.superadminEarningAmount = money2(row.superadminEarningAmount + money2(doc.superadminEarningAmount));
  row.adminEarningAmount = money2(row.adminEarningAmount + money2(doc.adminEarningAmount));
  row.operadorEarningAmount = money2(row.operadorEarningAmount + money2(doc.operadorEarningAmount));
  row.totalEarningsAmount = money2(row.totalEarningsAmount + money2(doc.totalEarningsAmount));
  row.clientChargeAmount = money2(row.clientChargeAmount + money2(doc.clientChargeAmount));
  row.clientNetAmount = money2(row.clientNetAmount + money2(doc.clientNetAmount));
}

function addRowToSummary(summary: EarningsByClientReportSummary, row: EarningsByClientReportRow) {
  summary.operationsCount += row.operationsCount;
  summary.grossAmount = money2(summary.grossAmount + row.grossAmount);
  summary.baseAmount = money2(summary.baseAmount + row.baseAmount);
  summary.despachoCostAmount = money2(summary.despachoCostAmount + row.despachoCostAmount);
  summary.superadminEarningAmount = money2(summary.superadminEarningAmount + row.superadminEarningAmount);
  summary.adminEarningAmount = money2(summary.adminEarningAmount + row.adminEarningAmount);
  summary.operadorEarningAmount = money2(summary.operadorEarningAmount + row.operadorEarningAmount);
  summary.totalEarningsAmount = money2(summary.totalEarningsAmount + row.totalEarningsAmount);
  summary.clientChargeAmount = money2(summary.clientChargeAmount + row.clientChargeAmount);
  summary.clientNetAmount = money2(summary.clientNetAmount + row.clientNetAmount);
}

function makeEmptyIssuesSummary(): PaymentsFinancialPostingIssuesReportSummary {
  return {
    paymentsCount: 0,
    totalAmount: 0,
    pendingCount: 0,
    configurationCount: 0,
    skippedCount: 0,
    notConciliatedCount: 0,
    missingClientRateCount: 0,
    missingDespachoCostCount: 0,
    postedCount: 0,
  };
}



function normalizeFinancialPostingStatus(value: unknown): string {
  return asText(value).toUpperCase() || "SIN_POSTEO";
}

function getPagoAmount(doc: any): number {
  return money2(doc.montoTotal ?? doc.amount ?? doc.total ?? doc.monto ?? 0);
}

function getPagoFolio(doc: any, id: string): string {
  return asText(doc.folio || doc.referenceFolio || doc.pagoFolio || doc.referencia || doc.reference || doc.uuid || doc.uuidCfdi) || id;
}

function getIssueActionLabel(financialStatus: string, error: string | null, pagoStatus: string): string {
  const status = financialStatus.toUpperCase();
  const errorText = asText(error).toUpperCase();

  if (pagoStatus !== "CONCILIADO") {
    return "Conciliar pago primero";
  }

  if (status === "PENDING") {
    return "Ejecutar posteo financiero";
  }

  if (status === "PENDING_CONFIGURATION") {
    return "Completar configuracion financiera";
  }

  if (status.includes("MISSING_CLIENT_RATE") || errorText.includes("MISSING_CLIENT_RATE") || errorText.includes("CLIENT_RATE")) {
    return "Configurar costo cliente";
  }

  if (status.includes("MISSING_DESPACHO_COST") || errorText.includes("MISSING_DESPACHO_COST") || errorText.includes("DESPACHO_COST")) {
    return "Configurar costo despacho";
  }

  if (status.includes("MISSING_OPERATION_TYPE") || errorText.includes("MISSING_OPERATION_TYPE")) {
    return "Configurar tipo de operacion";
  }

  if (status.includes("MISSING_DESPACHO") || errorText.includes("MISSING_DESPACHO")) {
    return "Revisar despacho";
  }

  if (status.includes("UNSUPPORTED")) {
    return "Revisar pricing";
  }

  if (status.includes("INVALID_NET")) {
    return "Revisar monto/costo";
  }

  if (status === "SIN_POSTEO") {
    return "Preparar posteo financiero";
  }

  return "Revisar pago";
}

function getIssueSeverity(financialStatus: string, pagoStatus: string): "INFO" | "WARNING" | "CRITICAL" {
  const status = financialStatus.toUpperCase();

  if (status === "POSTED") {
    return "INFO";
  }

  if (pagoStatus !== "CONCILIADO") {
    return "INFO";
  }

  if (status.startsWith("SKIPPED_") || status === "PENDING_CONFIGURATION" || status === "SIN_POSTEO") {
    return "CRITICAL";
  }

  return "WARNING";
}

function shouldIncludePaymentIssue(params: {
  pagoStatus: string;
  financialStatus: string;
  includePosted: boolean;
  includeNotConciliated: boolean;
}) {
  const { pagoStatus, financialStatus, includePosted, includeNotConciliated } = params;

  if (financialStatus === "POSTED") {
    return includePosted;
  }

  if (pagoStatus !== "CONCILIADO") {
    return includeNotConciliated;
  }

  return true;
}

function addIssueToSummary(summary: PaymentsFinancialPostingIssuesReportSummary, row: PaymentsFinancialPostingIssuesReportRow) {
  summary.paymentsCount += 1;
  summary.totalAmount = money2(summary.totalAmount + row.amount);

  const status = row.financialPostingStatus.toUpperCase();

  if (status === "POSTED") {
    summary.postedCount += 1;
  }

  if (status === "PENDING" || status === "SIN_POSTEO") {
    summary.pendingCount += 1;
  }

  if (status === "PENDING_CONFIGURATION") {
    summary.configurationCount += 1;
  }

  if (status.startsWith("SKIPPED_")) {
    summary.skippedCount += 1;
  }

  if (row.status !== "CONCILIADO") {
    summary.notConciliatedCount += 1;
  }

  if (status.includes("MISSING_CLIENT_RATE") || asText(row.financialPostingError).toUpperCase().includes("MISSING_CLIENT_RATE")) {
    summary.missingClientRateCount += 1;
  }

  if (status.includes("MISSING_DESPACHO_COST") || asText(row.financialPostingError).toUpperCase().includes("MISSING_DESPACHO_COST")) {
    summary.missingDespachoCostCount += 1;
  }
}

export const getEarningsByClientReport = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request): Promise<EarningsByClientReportResult> => {
    const uid = requireAuth(request);
    const user = await getMyUser(uid);

    if (!user) {
      throw new HttpsError("permission-denied", "Perfil de usuario no encontrado.");
    }

    const role = requireRole(user, ["superadmin", "admin", "operador"]) as Pay0ReportRole;
    assertAuthorized(request.auth, user, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "reportes", requiredAction: "view" });
    const rootId = asText(user.rootId || uid) || uid;

    const data = (request.data || {}) as EarningsByClientReportInput;
    const includeCompensated = data.includeCompensated === true;
    const from = normalizeDateInput(data.dateFrom, false);
    const to = normalizeDateInput(data.dateTo, true);
    const limit = Math.min(Math.max(Number(data.limit || 5000), 1), 5000);

    assertDateRange(from, to);

    const snap = await db
      .collection("earningsDistributions")
      .where("rootId", "==", rootId)
      .limit(limit)
      .get();

    const byClient = new Map<string, EarningsByClientReportRow>();
    let docsScanned = 0;

    snap.docs.forEach((docSnap) => {
      docsScanned += 1;

      const doc = docSnap.data() || {};
      const status = asText(doc.status || "GENERATED").toUpperCase();

      if (!includeCompensated && status === "COMPENSATED") {
        return;
      }

      if (!isInEarningsScope(role, uid, doc)) {
        return;
      }

      const createdMillis = toMillis(doc.createdAt);

      if ((from.millis || to.millis) && !createdMillis) {
        return;
      }

      if (from.millis && createdMillis && createdMillis < from.millis) {
        return;
      }

      if (to.millis && createdMillis && createdMillis > to.millis) {
        return;
      }

      const clienteId = asText(doc.clienteId || doc.clientId);
      if (!clienteId) {
        return;
      }

      const current = byClient.get(clienteId) || {
        clienteId,
        clienteNombre: asText(doc.clienteNombre) || null,
        operationsCount: 0,
        grossAmount: 0,
        baseAmount: 0,
        despachoCostAmount: 0,
        superadminEarningAmount: 0,
        adminEarningAmount: 0,
        operadorEarningAmount: 0,
        totalEarningsAmount: 0,
        clientChargeAmount: 0,
        clientNetAmount: 0,
        lastCreatedAt: null,
      };

      addMoney(current, doc);

      const currentLast = toMillis(current.lastCreatedAt);
      if (createdMillis && (!currentLast || createdMillis > currentLast)) {
        current.lastCreatedAt = isoFromMillis(createdMillis);
      }

      if (!current.clienteNombre && asText(doc.clienteNombre)) {
        current.clienteNombre = asText(doc.clienteNombre);
      }

      byClient.set(clienteId, current);
    });

    const rows = Array.from(byClient.values()).sort((a, b) => {
      return b.totalEarningsAmount - a.totalEarningsAmount || a.clienteId.localeCompare(b.clienteId);
    });

    const summary = makeEmptyEarningsSummary();
    summary.clientsCount = rows.length;

    rows.forEach((row) => addRowToSummary(summary, row));

    return {
      ok: true,
      scopeRole: role,
      rootId,
      dateFrom: from.raw,
      dateTo: to.raw,
      includeCompensated,
      docsScanned,
      rows,
      summary,
    };
  }
);

export const getPaymentsFinancialPostingIssuesReport = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request): Promise<PaymentsFinancialPostingIssuesReportResult> => {
    const uid = requireAuth(request);
    const user = await getMyUser(uid);

    if (!user) {
      throw new HttpsError("permission-denied", "Perfil de usuario no encontrado.");
    }

    const role = requireRole(user, ["superadmin", "admin", "operador"]) as Pay0ReportRole;
    assertAuthorized(request.auth, user, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "reportes", requiredAction: "view" });
    const rootId = asText(user.rootId || uid) || uid;

    const data = (request.data || {}) as PaymentsFinancialPostingIssuesReportInput;
    const includePosted = data.includePosted === true;
    const includeNotConciliated = data.includeNotConciliated === true;
    const from = normalizeDateInput(data.dateFrom, false);
    const to = normalizeDateInput(data.dateTo, true);
    const limit = Math.min(Math.max(Number(data.limit || 5000), 1), 5000);

    assertDateRange(from, to);

    const snap = await db
      .collection("pagos")
      .where("rootId", "==", rootId)
      .limit(limit)
      .get();

    const rows: PaymentsFinancialPostingIssuesReportRow[] = [];
    let docsScanned = 0;

    snap.docs.forEach((docSnap) => {
      docsScanned += 1;

      const doc = docSnap.data() || {};

      if (!isInPagoScope(role, uid, doc)) {
        return;
      }

      const createdMillis = toMillis(doc.createdAt || doc.fechaPago || doc.fecha || doc.updatedAt);

      if ((from.millis || to.millis) && !createdMillis) {
        return;
      }

      if (from.millis && createdMillis && createdMillis < from.millis) {
        return;
      }

      if (to.millis && createdMillis && createdMillis > to.millis) {
        return;
      }

      const pagoStatus = normalizePagoStatus(doc.status);
      const financialStatus = normalizeFinancialPostingStatus(doc.financialPostingStatus);

      if (!shouldIncludePaymentIssue({ pagoStatus, financialStatus, includePosted, includeNotConciliated })) {
        return;
      }

      const error = asText(doc.financialPostingError) || null;

      rows.push({
        pagoId: docSnap.id,
        folio: getPagoFolio(doc, docSnap.id),
        clienteId: asText(doc.clienteId || doc.clientId) || null,
        clienteNombre: asText(doc.clienteNombre || doc.clientName) || null,
        companyId: asText(doc.companyId) || null,
        empresaNombre: asText(doc.empresaNombre || doc.companyName) || null,
        operationTypeKey: asText(doc.operationTypeKey) || null,
        status: pagoStatus,
        financialPostingStatus: financialStatus,
        financialPostingError: error,
        amount: getPagoAmount(doc),
        actionLabel: getIssueActionLabel(financialStatus, error, pagoStatus),
        severity: getIssueSeverity(financialStatus, pagoStatus),
        createdAt: isoFromMillis(createdMillis),
        updatedAt: isoFromMillis(toMillis(doc.updatedAt)),
      });
    });

    rows.sort((a, b) => {
      const severityRank = { CRITICAL: 0, WARNING: 1, INFO: 2 };
      const severityDelta = severityRank[a.severity] - severityRank[b.severity];
      if (severityDelta !== 0) return severityDelta;

      return (b.amount || 0) - (a.amount || 0);
    });

    const summary = makeEmptyIssuesSummary();
    rows.forEach((row) => addIssueToSummary(summary, row));

    return {
      ok: true,
      scopeRole: role,
      rootId,
      dateFrom: from.raw,
      dateTo: to.raw,
      includePosted,
      includeNotConciliated,
      docsScanned,
      rows,
      summary,
    };
  }
);
function makeEmptyOperationalSummary(): OperationalIntelligenceReportSummary {
  return {
    pagosCount: 0,
    pagosAmount: 0,
    dispersionesCount: 0,
    dispersionesAmount: 0,
    adelantosCount: 0,
    adelantosAmount: 0,
    adelantosPendingAmount: 0,
    adelantosLiquidatedAmount: 0,
    earningsAmount: 0,
    activityEventsCount: 0,
    alertsCount: 0,
    pendingFinancialPostingsCount: 0,
    openDispersionIncidentsCount: 0,
  };
}

function isInOperationalScope(role: Pay0ReportRole, uid: string, doc: any): boolean {
  if (role === "superadmin") return true;

  if (role === "admin") {
    return asText(doc.adminId) === uid;
  }

  return (
    asText(doc.operadorId) === uid ||
    asText(doc.createdBy) === uid ||
    asText(doc.actorUid) === uid ||
    asText(doc.actorId) === uid
  );
}

function getTolerantAmount(doc: any, fields: string[]): number {
  for (const field of fields) {
    const value = doc?.[field];
    const amount = money2(value);

    if (amount !== 0) {
      return amount;
    }
  }

  return 0;
}

function getTolerantDateMillis(doc: any): number | null {
  return toMillis(doc.createdAt || doc.fechaPago || doc.fecha || doc.updatedAt);
}

function isInsideReportRange(
  millis: number | null,
  from: { millis: number | null },
  to: { millis: number | null }
): boolean {
  if ((from.millis || to.millis) && !millis) {
    return false;
  }

  if (from.millis && millis && millis < from.millis) {
    return false;
  }

  if (to.millis && millis && millis > to.millis) {
    return false;
  }

  return true;
}

function getOperationalClienteId(doc: any): string {
  return asText(doc.clienteId || doc.clientId);
}

function getOperationalClienteNombre(doc: any): string | null {
  return asText(doc.clienteNombre || doc.clientName) || null;
}

function getOperationalReferenceFolio(doc: any, id: string): string | null {
  return (
    asText(
      doc.referenceFolio ||
      doc.folio ||
      doc.pagoFolio ||
      doc.solicitudFolio ||
      doc.dispersionFolio ||
      doc.referencia ||
      doc.reference
    ) || id || null
  );
}

function getClientRankingRow(
  rows: Map<string, OperationalClientRankingRow>,
  clienteId: string,
  clienteNombre: string | null
): OperationalClientRankingRow {
  const current = rows.get(clienteId);

  if (current) {
    if (!current.clienteNombre && clienteNombre) {
      current.clienteNombre = clienteNombre;
    }

    return current;
  }

  const next: OperationalClientRankingRow = {
    clienteId,
    clienteNombre,
    pagosAmount: 0,
    pagosCount: 0,
    dispersionesAmount: 0,
    dispersionesCount: 0,
    earningsAmount: 0,
    activityCount: 0,
    lastActivityAt: null,
  };

  rows.set(clienteId, next);
  return next;
}

function updateLastOperationalActivity(row: { lastActivityAt: string | null }, millis: number | null) {
  if (!millis) return;

  const currentMillis = toMillis(row.lastActivityAt);
  if (!currentMillis || millis > currentMillis) {
    row.lastActivityAt = isoFromMillis(millis);
  }
}

function getUserActivityRow(rows: Map<string, OperationalUserActivityRow>, doc: any): OperationalUserActivityRow | null {
  const actorUid = asText(doc.actorUid || doc.actorId || doc.createdBy);
  if (!actorUid) return null;

  const current = rows.get(actorUid);

  if (current) {
    const actorUsername = asText(doc.actorUsername || doc.actorName);
    if (!current.actorUsername && actorUsername) {
      current.actorUsername = actorUsername;
    }

    return current;
  }

  const next: OperationalUserActivityRow = {
    actorUid,
    actorUsername: asText(doc.actorUsername || doc.actorName) || null,
    eventsCount: 0,
    lastActivityAt: null,
  };

  rows.set(actorUid, next);
  return next;
}

function pushOperationalAlert(alerts: OperationalAlertRow[], row: OperationalAlertRow) {
  if (alerts.length >= 100) return;
  alerts.push(row);
}

export const getOperationalIntelligenceReport = onCall(
  { cors: true, timeoutSeconds: 60, memory: "512MiB" },
  async (request): Promise<OperationalIntelligenceReportResult> => {
    const uid = requireAuth(request);
    const user = await getMyUser(uid);

    if (!user) {
      throw new HttpsError("permission-denied", "Perfil de usuario no encontrado.");
    }

    const role = requireRole(user, ["superadmin", "admin", "operador"]) as Pay0ReportRole;
    assertAuthorized(request.auth, user, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "reportes", requiredAction: "view" });
    const rootId = asText(user.rootId || uid) || uid;

    const data = (request.data || {}) as OperationalIntelligenceReportInput;
    const from = normalizeDateInput(data.dateFrom, false);
    const to = normalizeDateInput(data.dateTo, true);
    const limit = Math.min(Math.max(Number(data.limit || 5000), 1), 5000);

    assertDateRange(from, to);

    const summary = makeEmptyOperationalSummary();
    const clientRows = new Map<string, OperationalClientRankingRow>();
    const userRows = new Map<string, OperationalUserActivityRow>();
    const alerts: OperationalAlertRow[] = [];
    let docsScanned = 0;

    const pagosSnap = await db.collection("pagos").where("rootId", "==", rootId).limit(limit).get();
    docsScanned += pagosSnap.size;

    pagosSnap.docs.forEach((docSnap) => {
      const doc = docSnap.data() || {};
      if (!isInPagoScope(role, uid, doc)) return;

      const createdMillis = getTolerantDateMillis(doc);
      if (!isInsideReportRange(createdMillis, from, to)) return;

      const amount = getPagoAmount(doc);
      const clienteId = getOperationalClienteId(doc);

      summary.pagosCount += 1;
      summary.pagosAmount = money2(summary.pagosAmount + amount);

      if (clienteId) {
        const row = getClientRankingRow(clientRows, clienteId, getOperationalClienteNombre(doc));
        row.pagosCount += 1;
        row.pagosAmount = money2(row.pagosAmount + amount);
        updateLastOperationalActivity(row, createdMillis);
      }

      const pagoStatus = normalizePagoStatus(doc.status);
      const financialStatus = normalizeFinancialPostingStatus(doc.financialPostingStatus);

      if (pagoStatus === "CONCILIADO" && financialStatus !== "POSTED") {
        summary.pendingFinancialPostingsCount += 1;
        pushOperationalAlert(alerts, {
          id: docSnap.id,
          type: "PAGO_POSTEO_FINANCIERO_PENDIENTE",
          severity: "CRITICAL",
          title: "Pago pendiente de posteo financiero",
          description: "El pago esta conciliado pero no tiene posteo financiero completo.",
          referenceId: docSnap.id,
          referenceFolio: getPagoFolio(doc, docSnap.id),
          amount,
          status: financialStatus,
          createdAt: isoFromMillis(createdMillis),
        });
      }
    });

    const earningsSnap = await db.collection("earningsDistributions").where("rootId", "==", rootId).limit(limit).get();
    docsScanned += earningsSnap.size;

    earningsSnap.docs.forEach((docSnap) => {
      const doc = docSnap.data() || {};
      if (!isInEarningsScope(role, uid, doc)) return;

      const createdMillis = getTolerantDateMillis(doc);
      if (!isInsideReportRange(createdMillis, from, to)) return;

      const amount = getTolerantAmount(doc, ["totalEarningsAmount", "amount", "monto", "total"]);
      const clienteId = getOperationalClienteId(doc);

      summary.earningsAmount = money2(summary.earningsAmount + amount);

      if (clienteId) {
        const row = getClientRankingRow(clientRows, clienteId, getOperationalClienteNombre(doc));
        row.earningsAmount = money2(row.earningsAmount + amount);
        updateLastOperationalActivity(row, createdMillis);
      }
    });

    const dispersionsSnap = await db.collection("clientDispersions").where("rootId", "==", rootId).limit(limit).get();
    docsScanned += dispersionsSnap.size;

    dispersionsSnap.docs.forEach((docSnap) => {
      const doc = docSnap.data() || {};
      if (!isInOperationalScope(role, uid, doc)) return;

      const createdMillis = getTolerantDateMillis(doc);
      if (!isInsideReportRange(createdMillis, from, to)) return;

      const amount = getTolerantAmount(doc, ["amount", "monto", "total"]);
      const clienteId = getOperationalClienteId(doc);

      summary.dispersionesCount += 1;
      summary.dispersionesAmount = money2(summary.dispersionesAmount + amount);

      if (clienteId) {
        const row = getClientRankingRow(clientRows, clienteId, getOperationalClienteNombre(doc));
        row.dispersionesCount += 1;
        row.dispersionesAmount = money2(row.dispersionesAmount + amount);
        updateLastOperationalActivity(row, createdMillis);
      }

      const incidentStatus = asText(doc.incidentStatus).toUpperCase();

      if (incidentStatus === "SOLICITADA") {
        summary.openDispersionIncidentsCount += 1;
        pushOperationalAlert(alerts, {
          id: docSnap.id,
          type: "DISPERSION_INCIDENCIA_ABIERTA",
          severity: "WARNING",
          title: "Dispersion con incidencia abierta",
          description: "La dispersion tiene una incidencia solicitada pendiente de resolver.",
          referenceId: docSnap.id,
          referenceFolio: getOperationalReferenceFolio(doc, docSnap.id),
          amount,
          status: incidentStatus,
          createdAt: isoFromMillis(createdMillis),
        });
      }
    });

    const advancesSnap = await db.collection("clientAdvances").where("rootId", "==", rootId).limit(limit).get();
    docsScanned += advancesSnap.size;

    advancesSnap.docs.forEach((docSnap) => {
      const doc = docSnap.data() || {};
      if (!isInOperationalScope(role, uid, doc)) return;

      const createdMillis = getTolerantDateMillis(doc);
      if (!isInsideReportRange(createdMillis, from, to)) return;

      const amount = getTolerantAmount(doc, ["amount", "monto", "total"]);
      const status = asText(doc.status).toUpperCase();

      summary.adelantosCount += 1;
      summary.adelantosAmount = money2(summary.adelantosAmount + amount);

      if (status.includes("LIQUID")) {
        summary.adelantosLiquidatedAmount = money2(summary.adelantosLiquidatedAmount + amount);
      } else {
        summary.adelantosPendingAmount = money2(summary.adelantosPendingAmount + amount);
      }

      const clienteId = getOperationalClienteId(doc);
      if (clienteId) {
        const row = getClientRankingRow(clientRows, clienteId, getOperationalClienteNombre(doc));
        updateLastOperationalActivity(row, createdMillis);
      }
    });

    const activitySnap = await db.collection("activityLog").where("rootId", "==", rootId).limit(limit).get();
    docsScanned += activitySnap.size;

    activitySnap.docs.forEach((docSnap) => {
      const doc = docSnap.data() || {};
      if (!isInOperationalScope(role, uid, doc)) return;

      const createdMillis = getTolerantDateMillis(doc);
      if (!isInsideReportRange(createdMillis, from, to)) return;

      summary.activityEventsCount += 1;

      const userRow = getUserActivityRow(userRows, doc);
      if (userRow) {
        userRow.eventsCount += 1;
        updateLastOperationalActivity(userRow, createdMillis);
      }

      const clienteId = getOperationalClienteId(doc);
      if (clienteId) {
        const row = getClientRankingRow(clientRows, clienteId, getOperationalClienteNombre(doc));
        row.activityCount += 1;
        updateLastOperationalActivity(row, createdMillis);
      }
    });

    const clientRanking = Array.from(clientRows.values())
      .sort((a, b) => {
        const aTotal = a.pagosAmount + a.dispersionesAmount + a.earningsAmount;
        const bTotal = b.pagosAmount + b.dispersionesAmount + b.earningsAmount;
        return bTotal - aTotal || b.activityCount - a.activityCount || a.clienteId.localeCompare(b.clienteId);
      })
      .slice(0, 50);

    const userActivity = Array.from(userRows.values())
      .sort((a, b) => b.eventsCount - a.eventsCount || a.actorUid.localeCompare(b.actorUid))
      .slice(0, 50);

    const severityRank: Record<OperationalAlertRow["severity"], number> = {
      CRITICAL: 0,
      WARNING: 1,
      INFO: 2,
    };

    alerts.sort((a, b) => {
      const severityDelta = severityRank[a.severity] - severityRank[b.severity];
      if (severityDelta !== 0) return severityDelta;
      return (toMillis(b.createdAt) || 0) - (toMillis(a.createdAt) || 0);
    });

    summary.alertsCount = alerts.length;

    return {
      ok: true,
      scopeRole: role,
      rootId,
      dateFrom: from.raw,
      dateTo: to.raw,
      docsScanned,
      summary,
      clientRanking,
      userActivity,
      alerts,
    };
  }
);
