import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export async function createCompanyMutation(input: {
  despachoId: string;
  nombre: string;
  rfc: string;
}) {
  const fn = httpsCallable(functions, "createCompany");
  const res: any = await fn(input);
  return res?.data;
}

export async function toggleCompanyActiveMutation(input: {
  companyId: string;
  nextActive: boolean;
}) {
  const fn = httpsCallable(functions, "toggleCompanyActive");
  const res: any = await fn(input);
  return res?.data;
}

export async function updateCompanyDepositIdentityMutation(input: {
  companyId: string;
  depositAlias: string;
  depositClabes: string[];
}) {
  const fn = httpsCallable(functions, "updateCompanyDepositIdentity");
  const res: any = await fn(input);
  return res?.data;
}

