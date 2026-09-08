import { db, functions } from "@/lib/firebaseClient";
import { httpsCallable } from "firebase/functions";
import {
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

/**
 * A) Superadmin: define qué empresas están permitidas para un despacho:
 * dispatchCompanyAccess/{despachoId}/companies/{companyId} { active:true }
 */
export async function setDispatchCompanies(
  despachoId: string,
  companyIds: string[],
  _actorUid?: string
) {
  if (!despachoId) throw new Error("despachoId requerido");

  const fn = httpsCallable(functions, "setDispatchCompanies");
  await fn({
    despachoId,
    companyIds,
  });
}

/**
 * B) Superadmin/Admin: asigna empresas a un usuario vía Cloud Function
 */
export async function saveUserCompanyAccess(targetUid: string, companyIds: string[], _actorUid?: string) {
  if (!targetUid) throw new Error("targetUid requerido");

  const fn = httpsCallable(functions, "setUserCompanyAccess");
  await fn({
    targetUid,
    companyIds,
  });
}

/** Compatibilidad con llamadas existentes */
export const setUserCompanies = saveUserCompanyAccess;

/** Lee B: userCompanyAccess/{uid}/companies where active=true */
export function watchUserCompanyAccess(
  uid: string,
  cb: (companyIds: string[]) => void,
  onErr?: (e: any) => void
) {
  const ref = collection(db, "userCompanyAccess", uid, "companies");
  const qy = query(ref, where("active", "==", true));
  return onSnapshot(
    qy,
    (snap) => cb(snap.docs.map((d) => d.id)),
    (e) => onErr?.(e)
  );
}

/** Lee A: dispatchCompanyAccess/{despachoId}/companies where active=true */
export function watchDispatchCompanyAccess(
  despachoId: string,
  cb: (companyIds: string[]) => void,
  onErr?: (e: any) => void
) {
  const ref = collection(db, "dispatchCompanyAccess", despachoId, "companies");
  const qy = query(ref, where("active", "==", true));
  return onSnapshot(
    qy,
    (snap) => cb(snap.docs.map((d) => d.id)),
    (e) => onErr?.(e)
  );
}





