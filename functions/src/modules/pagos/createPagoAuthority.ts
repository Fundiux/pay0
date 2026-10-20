import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { assertAuthorized, getUserRole } from '../../utils/authGuard';
import { requireClientOperationalAccess } from '../clientDelegations/access';

/** Read permission dependencies in the same transaction as the payment write. */
export async function assertCreatePagoAuthorityTx(input: {
  db: Firestore; tx: Transaction; uid: string; rootId: string;
  clientId: string; companyId: string; despachoId: string; auth: any;
}) {
  const { db, tx, uid, rootId, clientId, companyId, despachoId, auth } = input;
  const denied = () => new HttpsError('permission-denied', 'La autorización del pago cambió; vuelve a validar el acceso.');
  const actor = await tx.get(db.doc(`users/${uid}`));
  if (!actor.exists) throw denied();
  const user = actor.data()!;
  assertAuthorized(auth, user, { allowedRoles: ['superadmin', 'admin', 'operador'], requiredModule: 'pagos', requiredAction: 'create' });
  if (String(user.rootId || uid) !== rootId) throw denied();
  const role = getUserRole(user);
  const access = await requireClientOperationalAccess({ uid, role, rootId, clientId, permission: 'operatePagos', transaction: tx });
  if (!access.client || access.client.active === false) throw denied();
  const company = await tx.get(db.doc(`companies/${companyId}`));
  if (!company.exists || company.get('active') === false || String(company.get('rootId') || rootId) !== rootId || String(company.get('despachoId') || '') !== despachoId) throw denied();
  if (role !== 'superadmin') {
    const [direct, dispatch, linked] = await Promise.all([
      tx.get(db.doc(`userCompanyAccess/${uid}/companies/${companyId}`)),
      tx.get(db.doc(`userDespachoAccess/${uid}/despachos/${despachoId}`)),
      tx.get(db.doc(`dispatchCompanyAccess/${despachoId}/companies/${companyId}`)),
    ]);
    if (direct.get('active') !== true && !(dispatch.get('active') === true && linked.get('active') === true)) throw denied();
  }
}
