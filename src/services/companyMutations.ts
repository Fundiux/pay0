import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";
import { invalidateCompanyCatalog } from "@/services/companies";

export async function createCompanyMutation(input: {
  despachoId: string;
  nombre: string;
  rfc: string;
}) {
  const fn = httpsCallable(functions, "createCompany");
  const res: any = await fn(input);
  invalidateCompanyCatalog();
  return res?.data;
}

export async function toggleCompanyActiveMutation(input: {
  companyId: string;
  nextActive: boolean;
}) {
  const fn = httpsCallable(functions, "toggleCompanyActive");
  const res: any = await fn(input);
  invalidateCompanyCatalog();
  return res?.data;
}

export async function updateCompanyDepositIdentityMutation(input: {
  companyId: string;
  depositAlias: string;
  depositClabes: string[];
  depositAccounts?: Array<{ id?: string; clabe: string; status: "ACTIVA" | "INACTIVA"; validFrom?: string | null; validTo?: string | null }>;
  quotationContact?: string;
}) {
  const fn = httpsCallable(functions, "updateCompanyDepositIdentity");
  const res: any = await fn(input);
  invalidateCompanyCatalog();
  return res?.data;
}

/** Uploads (or removes) the logo the company shows on base-layout quotations. */
export async function setCompanyQuotationLogoMutation(input: { companyId: string; file?: File; remove?: boolean }) {
  let contentBase64 = "";
  if (input.file) {
    const bytes = new Uint8Array(await input.file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    contentBase64 = btoa(binary);
  }
  const fn = httpsCallable(functions, "setCompanyQuotationLogo");
  const res: any = await fn({ companyId: input.companyId, remove: input.remove === true, contentBase64, fileName: input.file?.name || "" });
  invalidateCompanyCatalog();
  return res?.data;
}
