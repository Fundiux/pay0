import { db, functions } from "@/lib/firebaseClient";
import { httpsCallable } from "firebase/functions";
import {
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

/**
 * userDespachoAccess/{uid}/despachos/{despachoId} { active:true }
 * - SUPERADMIN asigna despachos a cualquier usuario
 * - ADMIN asigna despachos a sus operadores (si lo decides en rules)
 */

export async function setUserDespachos(
  userId: string,
  despachoIds: string[],
  _actorUid?: string
) {
  if (!userId) throw new Error("userId requerido");

  const fn = httpsCallable(functions, "setUserDespachos");
  await fn({
    userId,
    despachoIds,
  });
}

export function watchUserDespachos(targetUid: string, cb: (despachoIds: string[]) => void, onErr?: (e:any)=>void) {
  const ref = collection(db, "userDespachoAccess", targetUid, "despachos");
  const qy = query(ref, where("active", "==", true));
  return onSnapshot(qy, (snap) => cb(snap.docs.map(d => d.id)), (e) => onErr?.(e));
}



