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
}) {
  const fn = httpsCallable(functions, "updateCompanyDepositIdentity");
  const res: any = await fn(input);
  invalidateCompanyCatalog();
  return res?.data;
}
