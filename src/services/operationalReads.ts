import { httpsCallable } from "firebase/functions";
import { onAuthStateChanged } from "firebase/auth";
import { auth, functions } from "@/lib/firebaseClient";

export type OperationalCollection = "pagos" | "solicitudes" | "clientDispersions";
export async function getAuthorizedOperationalRecord(collection: OperationalCollection, id: string): Promise<Record<string, any>> {
  const uid = auth.currentUser?.uid;
  const call = httpsCallable<{ collection: OperationalCollection; id: string }, { item: Record<string, any> }>(functions, "getAuthorizedOperationalRecord");
  const result = await call({ collection, id });
  if (!uid || uid !== auth.currentUser?.uid) throw new Error("La sesión cambió. Actualiza la consulta.");
  return result.data.item;
}

export type RelatedCollection = "clientBeneficiaries" | "clientBeneficiaryMethods" | "pagoAplicaciones";
export async function listAuthorizedRelatedRecords(collection: RelatedCollection, id: string, cancelled: () => boolean = () => false): Promise<any[]> {
  const uid = auth.currentUser?.uid;
  const call = httpsCallable<{ collection: RelatedCollection; id: string; cursor?: string }, { items: any[]; nextCursor: string | null }>(functions, "listAuthorizedRelatedRecords");
  const items: any[] = [];
  let cursor: string | undefined;
  const cursors = new Set<string>();
  do {
    if (cancelled() || !uid || auth.currentUser?.uid !== uid) throw new Error("La consulta cambió.");
    const result = await call({ collection, id, ...(cursor ? { cursor } : {}) });
    if (cancelled() || auth.currentUser?.uid !== uid) throw new Error("La consulta cambió.");
    items.push(...result.data.items);
    cursor = result.data.nextCursor || undefined;
    if (cursor && cursors.has(cursor)) throw new Error("No se pudo continuar la consulta.");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return items;
}

export function watchAuthorizedRelatedRecords(collection: RelatedCollection, id: string, onData: (items: any[]) => void, onError?: (error: Error) => void) {
  const uid = auth.currentUser?.uid;
  let cancelled = false, pending = false;
  const refresh = async () => {
    if (cancelled || pending) return;
    pending = true;
    try { const items = await listAuthorizedRelatedRecords(collection, id, () => cancelled); if (!cancelled) onData(items); }
    catch (error) { if (!cancelled) { onData([]); onError?.(error instanceof Error ? error : new Error("No se pudo verificar el acceso.")); } }
    finally { pending = false; }
  };
  const stopAuth = onAuthStateChanged(auth, user => { if (uid !== user?.uid) { cancelled = true; onData([]); } });
  void refresh();
  const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
  const focus = () => { void refresh(); };
  window.addEventListener("focus", focus);
  return () => { cancelled = true; stopAuth(); window.clearInterval(timer); window.removeEventListener("focus", focus); };
}

/** Bounded refresh for delegated rows; every item is reauthorized on the server. */
export async function getAuthorizedOperationalRecords(collection: OperationalCollection, ids: string[]) {
  const uid = auth.currentUser?.uid;
  const call = httpsCallable<{ collection: OperationalCollection; ids: string[] }, { items: Record<string, any>[]; deniedIds: string[] }>(functions, "getAuthorizedOperationalRecord");
  const result = await call({ collection, ids });
  if (!uid || uid !== auth.currentUser?.uid) throw new Error("La sesión cambió. Actualiza la consulta.");
  return result.data;
}
