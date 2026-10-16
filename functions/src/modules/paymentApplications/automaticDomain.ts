import { createHash } from "node:crypto";
import { getPagoCoverageState } from "../deposits/foundation";
import { normalizePagoStatus } from "../pagos/domain";
import { getSolicitudCoverageState, normalizeSolicitudBackendStatus } from "../solicitudes/domain";
import { normalizePaymentApplicationBatchInput, type NormalizedPaymentApplicationBatch } from "./domain";

type Row = Record<string, any>;
export const AUTOMATIC_APPLICATION_REVISION = "ASTRA_V1";
export const AUTOMATIC_CANDIDATE_LIMIT = 100;
const clean = (value: unknown) => String(value ?? "").trim();
const upper = (value: unknown) => clean(value).toUpperCase();
const cents = (value: number) => Math.round(value * 100);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function automaticPaymentSourceDigest(pago: Row): string {
  return hash([pago.rootId, pago.clienteId, pago.companyId, pago.createdBy,
    pago.automaticApplicationEligible, pago.automaticApplicationRevision, pago.status,
    pago.financialPostingStatus, pago.moneda, pago.referencia, pago.concepto,
    getPagoCoverageState(pago)]);
}

export function isAutomaticPaymentReady(pago: Row): boolean {
  return pago.automaticApplicationEligible === true && pago.automaticApplicationRevision === AUTOMATIC_APPLICATION_REVISION &&
    ["CONCILIADO", "APLICADO_PARCIAL"].includes(normalizePagoStatus(pago.status)) &&
    pago.financialPostingStatus === "POSTED" && getPagoCoverageState(pago).available > 0 &&
    !!clean(pago.rootId) && !!clean(pago.clienteId) && !!clean(pago.companyId) && !!clean(pago.createdBy);
}

// Require the complete fiscal UUID, PAY0 folio, or series+invoice folio as a
// separate reference. Amounts, fuzzy names and account suffixes never match.
function containsReference(reference: string, token: string): boolean {
  if (token.length < 4) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Z0-9])${escaped}(?=$|[^A-Z0-9])`).test(reference);
}

function invoiceFiscalBlockReason(invoice: Row): string | null {
  // Fields written by issueFacturamaInvoice, its metadata reconciliation, the
  // IQ XML importer and the manual FACTURA_XML finalizer. A retained UUID never
  // overrides an explicitly non-production source or contradictory identity.
  const environment = upper(invoice.facturamaEnvironment);
  const status = upper(invoice.facturamaAutoDraftStatus);
  const source = upper(invoice.facturaMetadataSource);
  const uuid = upper(invoice.facturaUuid || invoice.uuidCfdi);
  if (["SANDBOX", "TEST"].includes(environment) || /^(SANDBOX|TEST)(_|$)/.test(status) ||
      (uuid && uuid === upper(invoice.facturaUuidSandbox))) return "NON_PRODUCTION_INVOICE";
  if ((environment && environment !== "PRODUCTION") ||
      (source && !["FACTURA_XML", "IQ_INVOICE_ZIP", "FACTURAMA_XML", "FACTURAMA_XML_RECONCILED"].includes(source)) ||
      (source.startsWith("FACTURAMA_") && (environment !== "PRODUCTION" || (status && status !== "PRODUCTION_ISSUED"))) ||
      (invoice.facturaUuid && invoice.uuidCfdi && upper(invoice.facturaUuid) !== upper(invoice.uuidCfdi))) return "AMBIGUOUS_INVOICE_FISCAL_SOURCE";
  return null;
}

export type AutomaticPaymentDecision = {
  status: "READY" | "REQUIRES_REVIEW" | "WAITING";
  reason: string;
  sourceDigest: string;
  matchedCount: number;
  batch: NormalizedPaymentApplicationBatch | null;
};

export function decideAutomaticPayment(pagoId: string, pago: Row, candidates: Row[]): AutomaticPaymentDecision {
  const sourceDigest = automaticPaymentSourceDigest(pago);
  const result = (status: AutomaticPaymentDecision["status"], reason: string, matchedCount = 0, batch: NormalizedPaymentApplicationBatch | null = null): AutomaticPaymentDecision =>
    ({ status, reason, sourceDigest, matchedCount, batch });
  if (!isAutomaticPaymentReady(pago)) return result("WAITING", "PAYMENT_NOT_READY");
  if (candidates.length > AUTOMATIC_CANDIDATE_LIMIT) return result("REQUIRES_REVIEW", "CANDIDATE_LIMIT");
  const reference = [pago.referencia, pago.concepto].map(upper).filter(Boolean).join(" ");
  if (!reference) return result("REQUIRES_REVIEW", "MISSING_INVOICE_REFERENCE");
  const currency = upper(pago.moneda);
  if (!currency) return result("REQUIRES_REVIEW", "MISSING_CURRENCY");
  const matches = candidates.filter(solicitud => {
    if (solicitud.rootId !== pago.rootId || solicitud.clienteId !== pago.clienteId ||
        clean(solicitud.companyId || solicitud.empresaId) !== clean(pago.companyId)) return false;
    const uuid = upper(solicitud.facturaUuid || solicitud.uuidCfdi);
    if (!/^[A-F0-9]{8}-(?:[A-F0-9]{4}-){3}[A-F0-9]{12}$/.test(uuid)) return false;
    const serie = upper(solicitud.facturaSerie), folio = upper(solicitud.facturaFolio);
    const tokens = [uuid, upper(solicitud.folio), serie && folio ? `${serie}${folio}` : "", serie && folio ? `${serie}-${folio}` : ""];
    return tokens.some(token => containsReference(reference, token));
  });
  if (!matches.length) return result("REQUIRES_REVIEW", "NO_EXACT_INVOICE_REFERENCE");
  const fiscalBlock = matches.map(invoiceFiscalBlockReason).find(Boolean);
  if (fiscalBlock) return result("REQUIRES_REVIEW", fiscalBlock, matches.length);
  // An exact reference to a closed/foreign-currency invoice is a conflict,
  // not permission to redistribute its amount among the other invoices.
  if (matches.some(row => ["RECHAZADA", "CANCELADA", "ELIMINADA", "COMPLETADA"].includes(normalizeSolicitudBackendStatus(row.status)) || getSolicitudCoverageState(row).pending <= 0))
    return result("REQUIRES_REVIEW", "INVOICE_NOT_PAYABLE", matches.length);
  if (matches.some(row => upper(row.moneda) !== currency)) return result("REQUIRES_REVIEW", "CURRENCY_MISMATCH", matches.length);
  const distinct = new Set(matches.map(row => upper(row.facturaUuid || row.uuidCfdi)));
  if (distinct.size !== matches.length) return result("REQUIRES_REVIEW", "DUPLICATE_INVOICE_IDENTITY", matches.length);
  const available = cents(getPagoCoverageState(pago).available);
  const pending = matches.map(row => cents(getSolicitudCoverageState(row).pending));
  if (matches.length > 1 && pending.reduce((sum, value) => sum + value, 0) !== available)
    return result("REQUIRES_REVIEW", "MULTIPLE_INVOICES_REQUIRE_ALLOCATION", matches.length);
  if (matches.length === 1 && available > pending[0]) return result("REQUIRES_REVIEW", "AMOUNT_EXCEEDS_INVOICE", 1);
  const batch = normalizePaymentApplicationBatchInput({ pagoId,
    idempotencyKey: `automatic-${AUTOMATIC_APPLICATION_REVISION}-${sourceDigest}`,
    applications: matches.map((row, index) => ({ solicitudId: row.id, montoAplicado: (matches.length === 1 ? available : pending[index]) / 100 })),
  });
  return result("READY", matches.length === 1 ? "EXACT_INVOICE_REFERENCE" : "EXACT_MULTI_INVOICE_TOTAL", matches.length, batch);
}
