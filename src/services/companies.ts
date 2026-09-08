import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type Company = {
  id: string; rootId: string; despachoId: string; nombre: string; rfc: string; depositAlias?: string; depositClabes?: string[]; active?: boolean; companyNumber?: number | null;
};

type ListCompaniesParams = { uid: string; role: "superadmin" | "admin" | "operador" | string; despachoId?: string };
const REFRESH_MS = 30000;

function isPermissionDeniedError(error: any) {
  const value=String(error?.code || error?.message || "").toLowerCase(); return value.includes("permission-denied");
}

export function listCompanies(params: ListCompaniesParams, cb: (items: Company[]) => void, onErr?: (error: any) => void) {
  let cancelled=false; let timer: ReturnType<typeof setTimeout> | null=null;
  const refresh=async()=>{
    try {
      if (!params?.uid) { cb([]); return; }
      const callable=httpsCallable(functions,"listCompaniesCanonical");
      const response:any=await callable({ despachoId: params.despachoId || null });
      if (!cancelled) cb(Array.isArray(response?.data?.companies) ? response.data.companies : []);
    } catch (error) {
      if (!cancelled) { cb([]); if (!isPermissionDeniedError(error)) onErr?.(error); }
    } finally {
      if (!cancelled) timer=setTimeout(refresh,REFRESH_MS);
    }
  };
  void refresh();
  return ()=>{cancelled=true;if(timer)clearTimeout(timer)};
}
