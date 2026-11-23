import { getFirestore } from "firebase-admin/firestore";
import {
  attachInheritedModuleCeiling,
  computeInheritedModuleCeiling,
  decideUserAuthorization,
  getAttachedInheritedModuleCeiling,
  getOperatorParentUid,
  normalizeCanonicalRole,
} from "./authorization";

type ParentReader = (parentUid: string) => Promise<any | null>;

const defaultParentReader: ParentReader = async (parentUid) => {
  const snap = await getFirestore().doc(`users/${parentUid}`).get();
  return snap.exists ? snap.data() || null : null;
};

/**
 * Adjunta al perfil de un operador el techo heredado de su padre (una lectura del padre).
 * Admin y superadmin no cambian. Debe llamarse en el servidor antes de assertAuthorized con modulo;
 * si no se llama, el operador no obtiene permisos de modulo (falla cerrado).
 * La lectura del padre es deliberadamente no transaccional: decide autorizacion, no estado financiero.
 */
export async function withInheritedAuthority<T>(user: T, operatorUid?: unknown, readParent: ParentReader = defaultParentReader): Promise<T> {
  if (!user || typeof user !== "object") return user;
  if (normalizeCanonicalRole((user as any).role ?? (user as any).supervisorRole) !== "operador") return user;
  if (getAttachedInheritedModuleCeiling(user)) return user;
  // Un operador inactivo o restringido ya queda denegado por su propio estado: no se lee al padre.
  if (!decideUserAuthorization({ authenticatedUid: operatorUid || "operator", user }).allowed) return user;

  const parentUid = getOperatorParentUid(user);
  const parent = parentUid && parentUid !== String(operatorUid || "").trim() ? await readParent(parentUid) : null;
  return attachInheritedModuleCeiling(user, computeInheritedModuleCeiling({ operator: user, operatorUid, parentUid, parent }));
}
