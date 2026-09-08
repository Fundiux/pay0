import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebaseClient";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";

export type Despacho = { id: string; nombre: string };

export type ScopeRole = "superadmin" | "admin" | "operador";

export async function listDespachos(scope: { role: ScopeRole; rootId: string; uid: string }): Promise<Despacho[]> {
  const base = collection(db, "despachos");

  let q;
  if (scope.role === "superadmin") {
    q = query(base, orderBy("nombre", "asc"));
  } else if (scope.role === "admin") {
    q = query(base, where("rootId", "==", scope.rootId), orderBy("nombre", "asc"));
  } else {
    // operador: solo lo que el creo
    q = query(
      base,
      where("rootId", "==", scope.rootId),
      where("createdBy", "==", scope.uid),
      orderBy("nombre", "asc")
    );
  }

  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}

export async function toggleDespachoActive(id: string, nextActive: boolean) {
  const fn = httpsCallable(functions, "toggleDespachoActive");
  const res: any = await fn({ despachoId: id, nextActive });
  return res?.data;
}
