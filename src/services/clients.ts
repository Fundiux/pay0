import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type ClientItem = { id: string; name: string; rfc?: string; email?: string; phone?: string; whatsapp?: string; active?: boolean; adminId?: string; rootId?: string; ownerId?: string; managedByUserId?: string; createdBy?: string; createdAt?: any; numeroCliente?: number | null; clientNumber?: number | null; iqLink?: any; iqClientId?: string; iqClientName?: string };
type ClientScopePermission = "view" | "operate" | "viewBasic" | "operateSolicitudes" | "operatePagos" | "operateBeneficiarios" | "operateDispersiones" | "viewBalanceInDispersion" | "requestDispersionIncidents" | "commentDispersionNotes";
type ListScopedClientsParams = { uid: string; role: "superadmin" | "admin" | "operador" | string; rootId?: string; requiredPermission?: ClientScopePermission };
const CACHE_MS = 30_000;
const scopedCache = new Map<string, { expiresAt: number; value: ClientItem[]; pending?: Promise<ClientItem[]> }>();

function denied(error: any) { return String(error?.code || error?.message || "").toLowerCase().includes("permission-denied"); }
function keyFor(permission: string, scope = "") { return `${permission}:${scope}`; }
async function readClients(key: string, payload: Record<string, unknown>): Promise<ClientItem[]> {
  const cached = scopedCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.pending || cached.value;
  const pending = httpsCallable(functions, "listClientsCanonical")(payload).then((res: any) => {
    const value = Array.isArray(res?.data?.clients) ? res.data.clients : [];
    scopedCache.set(key, { value, expiresAt: Date.now() + CACHE_MS });
    return value;
  }).catch((error) => { scopedCache.delete(key); throw error; });
  scopedCache.set(key, { value: cached?.value || [], expiresAt: Date.now() + CACHE_MS, pending });
  return pending;
}
export function invalidateClientCatalog() { scopedCache.clear(); }
export function listScopedClients(params: ListScopedClientsParams, cb: (items: ClientItem[]) => void, onErr?: (e: any) => void) {
  let cancelled = false;
  if (!params?.uid || !params?.rootId) { cb([]); return () => { cancelled = true; }; }
  const permission = params.requiredPermission || "view";
  void readClients(keyFor(permission, `${params.uid}:${params.rootId}`), { requiredPermission: permission }).then((items) => { if (!cancelled) cb(items); }).catch((error) => { if (!cancelled) { cb([]); if (!denied(error)) onErr?.(error); } });
  return () => { cancelled = true; };
}
export async function getClientById(clientId: string, _rootId?: string): Promise<ClientItem | null> { if (!clientId) return null; const res: any = await httpsCallable(functions, "getClientCanonical")({ clientId, requiredPermission: "view" }); return res?.data?.client || null; }
export function watchClientById(clientId: string, cb: (item: ClientItem | null) => void, onErr?: (e: any) => void) { let cancelled = false; void getClientById(clientId).then((item) => { if (!cancelled) cb(item); }).catch((error) => { if (!cancelled) { cb(null); if (!denied(error)) onErr?.(error); } }); return () => { cancelled = true; }; }
export function listClients(params: any, cb: (items: ClientItem[]) => void, onErr?: (e: any) => void) { const adminId = typeof params === "string" ? params : params?.adminId; let cancelled = false; if (!adminId) { cb([]); return () => { cancelled = true; }; } void readClients(keyFor("view", adminId), { adminId, requiredPermission: "view" }).then((items) => { if (!cancelled) cb(items); }).catch((error) => { if (!cancelled) { cb([]); if (!denied(error)) onErr?.(error); } }); return () => { cancelled = true; }; }
