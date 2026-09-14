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
export type FacturamaInvoice = FacturamaDraftInput & { id: string; status: string; subtotal: number; environment: string; createdAt?: any };

export async function getFacturamaSandboxStatus() {
  return (await httpsCallable<Record<string, never>, { ok: boolean; environment: string; configured: boolean; productionEnabled: boolean }>(functions, "getFacturamaSandboxStatus")({})).data;
}
export async function saveFacturamaDraft(input: FacturamaDraftInput) {
  return (await httpsCallable<FacturamaDraftInput, { ok: boolean; invoiceId: string; reused: boolean; status: string }>(functions, "saveFacturamaDraft")(input)).data;
}
export async function listFacturamaInvoices(companyId?: string) {
  return (await httpsCallable<{ limit: number; companyId?: string }, { ok: boolean; invoices: FacturamaInvoice[] }>(functions, "listFacturamaInvoices")({ limit: 20, companyId })).data;
}
