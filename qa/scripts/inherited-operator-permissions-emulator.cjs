// Emulator check: operators inherit their parent's effective permissions; parents never grant above themselves.
// Run: node scripts/run-firebase-clean-env.mjs emulators:exec --config firebase.emulator-tests.json --project demo-pay0 --only auth,firestore,storage "node qa/scripts/inherited-operator-permissions-emulator.cjs"
const assert = require('node:assert/strict');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || process.env.GCLOUD_PROJECT !== 'demo-pay0') throw Error('Local demo emulator required');
global.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'demo-pay0' });
const db = admin.firestore();
const api = require('../../functions/lib/index');
const { withInheritedAuthority } = require('../../functions/lib/modules/users/inheritedAuthority');
const { assertAuthorized } = require('../../functions/lib/utils/authGuard');

const suffix = Date.now(), root = `inherit-root-${suffix}`, parent = `inherit-admin-${suffix}`, operator = `inherit-op-${suffix}`, other = `inherit-admin-b-${suffix}`, orphan = `inherit-orphan-${suffix}`;
const call = (fn, uid, data = {}) => fn.run({ auth: { uid, token: {} }, data });
let checks = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const canCreatePago = async uid => {
  const user = await withInheritedAuthority((await db.doc(`users/${uid}`).get()).data(), uid);
  try { assertAuthorized({ uid }, user, { allowedRoles: ['superadmin', 'admin', 'operador'], requiredModule: 'pagos', requiredAction: 'create' }); return true; }
  catch (error) { assert.equal(error.code, 'permission-denied'); return false; }
};

async function run() {
  await db.doc(`users/${root}`).set({ role: 'superadmin', rootId: root, displayName: 'Supervisión', active: true });
  await db.doc(`users/${parent}`).set({ role: 'admin', rootId: root, displayName: 'Administración Norte', parentUserId: root, active: true, modules: { usuarios: { view: true, permissions: true }, pagos: { view: true, create: false } } });
  await db.doc(`users/${other}`).set({ role: 'admin', rootId: root, displayName: 'Administración Sur', parentUserId: root, active: true });
  await db.doc(`users/${operator}`).set({ role: 'operador', rootId: root, displayName: 'Ana Operaciones', parentUserId: parent, parentRole: 'admin', active: true, modules: { pagos: { view: true, create: true } } });
  await db.doc(`users/${orphan}`).set({ role: 'operador', rootId: root, displayName: 'Sin responsable', parentUserId: `missing-${suffix}`, active: true });

  // Runtime inheritance: the operator's stored create=true is capped by the parent's create=false.
  check(await canCreatePago(operator), false, 'restricted parent caps operator');
  check(await canCreatePago(orphan), false, 'unresolved parent fails closed');
  await db.doc(`users/${parent}`).set({ modules: { pagos: { create: true } } }, { merge: true });
  check(await canCreatePago(operator), true, 'parent regains permission, operator follows without migration');
  await db.doc(`users/${parent}`).set({ modules: { pagos: { create: false } } }, { merge: true });
  check(await canCreatePago(operator), false, 'parent loses permission, operator loses it on next request');

  // Write-time clipping and the server-computed editor ceiling.
  const ceiling = await call(api.getUserPermissionCeiling, parent, { targetUid: operator });
  check([ceiling.inherited, ceiling.parentResolved, ceiling.parentName], [true, true, 'Administración Norte'], 'ceiling metadata');
  check([ceiling.assignable.pagos.view, ceiling.assignable.pagos.create], [true, false], 'editor ceiling hides what the parent lacks');
  const saved = await call(api.updateUserModules, parent, { targetUid: operator, modules: { pagos: { view: true, create: true }, solicitudes: { view: true, create: false } } });
  check(saved.dropped, ['pagos.create'], 'admin cannot grant above itself');
  const stored = (await db.doc(`users/${operator}`).get()).data().modules;
  check([stored.pagos.view, stored.solicitudes.create], [true, false], 'allowed values written');
  await assert.rejects(call(api.updateUserModules, other, { targetUid: operator, modules: { pagos: { view: true } } }), error => error.code === 'permission-denied'); checks++;
  await assert.rejects(call(api.getUserPermissionCeiling, other, { targetUid: operator }), error => error.code === 'permission-denied'); checks++;
  await assert.rejects(call(api.updateUserModules, root, { targetUid: orphan, modules: { pagos: { view: true } } }), error => error.code === 'failed-precondition'); checks++;
  const bySuperadmin = await call(api.updateUserModules, root, { targetUid: operator, modules: { pagos: { create: true } } });
  check(bySuperadmin.dropped, ['pagos.create'], 'superadmin is clipped to the operator\'s parent');
  console.log(`INHERITED_OPERATOR_PERMISSIONS_EMULATOR_PASS checks=${checks}`);
}

run().catch(error => { console.error(error); process.exit(1); }).then(() => process.exit(0));
