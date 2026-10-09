import { getFirestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { assertAuthorized } from "./authGuard";
import { requireClientOperationalAccess } from "../modules/clientDelegations/access";

/** Revalidate PAY0 authority; never change the persisted economic/IQ identity. */
export async function authorizeDeferredIntent(input: {
  uid: string; rootId: string; module: string; action: string | string[];
  clientId?: string; permission?: "operatePagos" | "operateSolicitudes" | "operateDispersiones";
}) {
  if (!input.uid || input.uid.includes("/") || !input.rootId) throw new HttpsError("permission-denied", "AUTH_STOPPED");
  const snap = await getFirestore().doc(`users/${input.uid}`).get();
  const user = snap.exists ? snap.data() : null;
  const role = assertAuthorized({ uid: input.uid }, user, {
    allowedRoles: ["superadmin", "admin", "operador"], requiredModule: input.module, requiredAction: input.action,
  });
  if (String(user?.rootId || input.uid) !== input.rootId) throw new HttpsError("permission-denied", "AUTH_SCOPE_CHANGED");
  if (input.permission) {
    if (!input.clientId) throw new HttpsError("permission-denied", "AUTH_CLIENT_REQUIRED");
    await requireClientOperationalAccess({ uid: input.uid, role, rootId: input.rootId, clientId: input.clientId, permission: input.permission });
  }
  return { uid: input.uid, rootId: input.rootId, role, user: user! };
}
