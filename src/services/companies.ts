import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type CompanyDepositAccount = { id: string; clabe: string; status: "ACTIVA" | "INACTIVA"; validFrom?: string | null; validTo?: string | null };
export type Company = {
  id: string; rootId: string; despachoId: string; nombre: string; rfc: string; depositAlias?: string; depositClabes?: string[]; depositAccounts?: CompanyDepositAccount[]; active?: boolean; companyNumber?: number | null;
  isOwnCompany?: boolean; ownedByRoot?: boolean; pay0OwnCompany?: boolean; ownership?: string; companyOwnership?: string; companyType?: string;
};

type ListCompaniesParams = { uid: string; role: "superadmin" | "admin" | "operador" | string; despachoId?: string };
const CACHE_MS = 30_000;
const companyCache = new Map<string, { expiresAt: number; value: Company[]; pending?: Promise<Company[]> }>();

export function invalidateCompanyCatalog() {
  companyCache.clear();
}

function isPermissionDeniedError(error: any) {
  const value=String(error?.code || error?.message || "").toLowerCase(); return value.includes("permission-denied");
}

export function listCompanies(params: ListCompaniesParams, cb: (items: Company[]) => void, onErr?: (error: any) => void) {
  let cancelled=false;
  if (!params?.uid) { cb([]); return () => { cancelled = true; }; }
  const key = `${params.uid}:${params.role}:${params.despachoId || ""}`;
  const cached = companyCache.get(key);
  const pending = cached && cached.expiresAt > Date.now()
    ? (cached.pending || Promise.resolve(cached.value))
    : httpsCallable(functions,"listCompaniesCanonical")({ despachoId: params.despachoId || null }).then((response:any) => {
        const value = Array.isArray(response?.data?.companies) ? response.data.companies : [];
        companyCache.set(key, { value, expiresAt: Date.now() + CACHE_MS });
        return value;
      }).catch((error) => { companyCache.delete(key); throw error; });
  if (!cached || cached.expiresAt <= Date.now()) companyCache.set(key, { value: cached?.value || [], expiresAt: Date.now() + CACHE_MS, pending });
  void pending.then((items) => { if (!cancelled) cb(items); }).catch((error) => { if (!cancelled) { cb([]); if (!isPermissionDeniedError(error)) onErr?.(error); } });
  return () => { cancelled = true; };
}
