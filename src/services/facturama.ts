import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type FacturamaConcept = {
  productCode: string; description: string; unitCode: string; unit: string;
  quantity: number; unitPrice: number; taxObject: string;
};
export type FacturamaDraftInput = {
  idempotencyKey: string;
  companyId: string;
  receiver: { rfc: string; name: string; fiscalRegime: string; postalCode: string; cfdiUse: string };
  concepts: FacturamaConcept[]; paymentForm: string; paymentMethod: string; currency: string;
};
export type FacturamaInvoice = FacturamaDraftInput & {
  id: string; status: string; subtotal: number; environment: string; createdAt?: any;
  sourceSolicitudId?: string; sourceSolicitudFolio?: string; productionBlocked?: boolean;
  uuid?: string; facturamaCfdiId?: string; lastError?: string;
  issuer?: { name?: string; rfc?: string };
  fiscalValidation?: { status?: string; reason?: string; productCode?: string; unitCode?: string; concepts?: Array<{ productCode?: string; unitCode?: string }> };
};

export async function getFacturamaSandboxStatus() {
  return (await httpsCallable<Record<string, never>, { ok: boolean; environment: string; configured: boolean; productionEnabled: boolean; connection: "CONNECTED" | "AUTH_FAILED" | "UNREACHABLE" | "NOT_CONFIGURED"; httpStatus: number | null }>(functions, "getFacturamaSandboxStatus")({})).data;
}
export async function getFacturamaProductionStatus() {
  return (await httpsCallable<Record<string, never>, { ok: boolean; environment: "PRODUCTION"; configured: boolean; productionEnabled: true; connection: "CONNECTED" | "AUTH_FAILED" | "UNREACHABLE" | "NOT_CONFIGURED"; httpStatus: number | null }>(functions, "getFacturamaProductionStatus")({})).data;
}
export async function saveFacturamaIssuerConfig(input: { companyId: string; issuerName: string; fiscalRegime: string; expeditionPlace: string }) {
  return (await httpsCallable<typeof input, { ok: boolean }>(functions, "saveFacturamaIssuerConfig")(input)).data;
}
export async function issueFacturamaSandboxInvoice(invoiceId: string) {
  return (await httpsCallable<{ invoiceId: string }, { ok: boolean; reused: boolean; status: string; uuid?: string; xmlUploadId?: string; pdfUploadId?: string }>(functions, "issueFacturamaSandboxInvoice", { timeout: 120000 })({ invoiceId })).data;
}
export async function issueFacturamaProductionInvoice(invoiceId: string) {
  return (await httpsCallable<{ invoiceId: string; confirmation: string }, { ok: boolean; reused: boolean; status: string; uuid?: string; xmlUploadId?: string; pdfUploadId?: string }>(functions, "issueFacturamaProductionInvoice", { timeout: 120000 })({ invoiceId, confirmation: "EMITIR_CFDI_REAL" })).data;
}
export async function reconcileFacturamaIssuedMetadata() {
  return (await httpsCallable<Record<string, never>, { ok: boolean; repaired: number; skipped: number; failed: number }>(functions, "reconcileFacturamaIssuedMetadata", { timeout: 120000 })({})).data;
}
export async function cancelFacturamaProductionInvoice(input: { solicitudId: string; motive: "01" | "02" | "03" | "04"; uuidReplacement?: string }) {
  return (await httpsCallable<typeof input, { ok: boolean; status: string; terminal: boolean; uuid?: string; message?: string }>(functions, "cancelFacturamaProductionInvoice", { timeout: 60000 })(input)).data;
}

export async function refreshFacturamaProductionCancellationStatus(solicitudId: string) {
  return (await httpsCallable<{ solicitudId: string }, { ok: boolean; status: string; isCancelable?: string | null; terminal: boolean }>(functions, "refreshFacturamaProductionCancellationStatus", { timeout: 60000 })({ solicitudId })).data;
}
export type FacturamaCsdStatus = { ok: boolean; companyId: string; rfc: string; registered: boolean; expirationDate: string | null; uploadedAt: string | null };
export async function getFacturamaProductionCsdStatus(companyId: string) {
  return (await httpsCallable<{ companyId: string }, FacturamaCsdStatus>(functions, "getFacturamaProductionCsdStatus")({ companyId })).data;
}
export async function registerFacturamaProductionCsd(input: { companyId: string; certificateBase64: string; privateKeyBase64: string; privateKeyPassword: string }) {
  return (await httpsCallable<typeof input, { ok: boolean; companyId: string; rfc: string; registered: boolean }>(functions, "registerFacturamaProductionCsd", { timeout: 60000 })(input)).data;
}
export async function saveFacturamaDraft(input: FacturamaDraftInput) {
  return (await httpsCallable<FacturamaDraftInput, { ok: boolean; invoiceId: string; reused: boolean; status: string }>(functions, "saveFacturamaDraft")(input)).data;
}
export async function listFacturamaInvoices(companyId?: string) {
  return (await httpsCallable<{ limit: number; companyId?: string }, { ok: boolean; invoices: FacturamaInvoice[] }>(functions, "listFacturamaInvoices")({ limit: 20, companyId })).data;
}

export async function importCompanyInvoiceCatalog(input: { companyId: string; version: string; originalName: string; sha256: string; workbookBase64: string }) {
  return (await httpsCallable<typeof input, { ok: boolean; reused: boolean; companyId: string; version: string; entryCount: number; statusCounts?: Record<string, number>; sourceSha256: string; satGlobalValidationStatus: string }>(functions, "importCompanyInvoiceCatalog")(input)).data;
}

export async function initGlobalSatCatalogUpload(input: { originalName: string; fileSize: number; sha256: string; versionLabel: string }) {
  return (await httpsCallable<typeof input, { ok: boolean; importId: string; storagePath: string; maxSizeBytes: number }>(functions, "initGlobalSatCatalogUpload")(input)).data;
}

export async function finalizeGlobalSatCatalogImport(input: { importId: string; effectiveAsOf?: string }) {
  const callable = httpsCallable<typeof input, { ok: boolean; reused: boolean; importId: string; productCount: number; unitCount: number; sourceSha256?: string; effectiveAsOf?: string }>(functions, "finalizeGlobalSatCatalogImport", { timeout: 540000 });
  return (await callable(input)).data;
}
