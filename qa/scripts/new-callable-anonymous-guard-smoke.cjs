'use strict';
// Run the compiled Firebase onCall handlers locally. No emulator, credential or cloud access.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const { NEW_CALLABLES } = require('../../scripts/verify-astra-callable-access.cjs');
const project = 'demo-pay0-anonymous-guard';
process.env.GCLOUD_PROJECT = project;
process.env.GOOGLE_CLOUD_PROJECT = project;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: project, storageBucket: project + '.appspot.com' });
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:1';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:1';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:1';
const attempts = { firestore: 0, storage: 0, auth: 0, network: 0, subprocess: 0 };
const deny = kind => () => { attempts[kind]++; throw Error('LOCAL_GUARD_FORBIDS_' + kind.toUpperCase()); };
globalThis.fetch = deny('network');
for (const name of ['node:http', 'node:https']) {
  const api = require(name); api.request = deny('network'); api.get = deny('network');
}
const net = require('node:net'), tls = require('node:tls'), http2 = require('node:http2');
net.connect = net.createConnection = tls.connect = http2.connect = deny('network');
net.Socket.prototype.connect = deny('network');
const childProcess = require('node:child_process');
for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[key] = deny('subprocess');

const actualLoad = Module._load;
const functionsRequire = Module.createRequire(path.join(root, 'functions/package.json'));
const admin = functionsRequire('firebase-admin');
const modularFirestore = functionsRequire('firebase-admin/firestore');
const modularStorage = functionsRequire('firebase-admin/storage');
const modularAuth = functionsRequire('firebase-admin/auth');
admin.initializeApp({ projectId: project, storageBucket: project + '.appspot.com' });
let phase = 'loading', importReferenceConstructions = 0;
const dbSpy = new Proxy({}, { get: (_target, key) => {
  if (key === 'then') return undefined;
  // Building a local DocumentReference at module import does not perform an SDK operation.
  // Even this construction is forbidden once the actual handler starts.
  if (['doc', 'collection'].includes(key)) return () => {
    if (phase !== 'loading') return deny('firestore')();
    importReferenceConstructions++; return dbSpy;
  };
  return deny('firestore');
} });
const firestoreFactory = new Proxy(admin.firestore, { apply: () => dbSpy });
const facade = (original, overrides) => {
  const out = {};
  const keys = new Set([...Reflect.ownKeys(original), ...Object.keys(overrides), 'apps', 'initializeApp']);
  for (let prototype = Object.getPrototypeOf(original); prototype && prototype !== Object.prototype; prototype = Object.getPrototypeOf(prototype))
    for (const key of Reflect.ownKeys(prototype)) if (key !== 'constructor') keys.add(key);
  for (const key of keys) Object.defineProperty(out, key, {
    enumerable: true, configurable: true, get: () => Object.hasOwn(overrides, key) ? overrides[key] : original[key],
  });
  return out;
};
const adminSpy = facade(admin, { firestore: firestoreFactory, storage: deny('storage'), auth: deny('auth') });
const firestoreSpy = facade(modularFirestore, { getFirestore: () => dbSpy });
const storageSpy = facade(modularStorage, { getStorage: deny('storage') });
const authSpy = facade(modularAuth, { getAuth: deny('auth') });
Module._load = function (name, parent, isMain) {
  if (name === 'firebase-admin') return adminSpy;
  if (name === 'firebase-admin/firestore') return firestoreSpy;
  if (name === 'firebase-admin/storage') return storageSpy;
  if (name === 'firebase-admin/auth') return authSpy;
  return actualLoad.call(this, name, parent, isMain);
};

const groups = [
  { module: 'canonicalCenter/service', guard: 'context -> requireAuth -> getMyUser -> assertAuthorized', names: [
    'activateCorporateResourceVersion', 'finalizeCorporateResourceUpload', 'getCorporateResource', 'getCorporateResourceDownloadUrl',
    'importCorporateResource', 'initCorporateResourceUpload', 'listCorporateResources', 'prepareCorporateResourceMigration',
    'restoreCorporateResourceVersion', 'retireCorporateResourceVersion', 'reviewCorporateResourceVersion'] },
  { module: 'constancias/service', guard: 'generateConstanciaRecepcionForSolicitudCore -> requireAuth -> getMyUser -> assertAuthorized', names: ['generateSolicitudReceiptCertificate'] },
  { module: 'commissionDistributions/userDestinations', guard: 'commissionAccountActor: auth.uid -> user read -> assertAuthorized', names: [
    'configureUserCommissionEntitlement', 'getMyCommissionSettings', 'previewMyCommissionDestinations', 'saveMyCommissionDestinations'] },
  { module: 'commissionDistributions/requests', guard: 'commissionAccountActor: auth.uid -> user read -> assertAuthorized', names: ['previewUserCommissionWithdrawal', 'requestUserCommissionDispersion'] },
  { module: 'commissionDistributions/execution', guard: 'authorizedExecutionInput -> commissionAccountActor: auth.uid -> user read -> assertAuthorized', names: ['cancelUserCommissionDispersion', 'executeUserCommissionDispersion'] },
  { module: 'commissionDistributions/daily', guard: 'commissionAccountActor(superadminOnly): auth.uid -> user read -> assertAuthorized', names: ['getCommissionAutomationConfig', 'runDailyUserCommissionPreflight', 'saveCommissionAutomationConfig'] },
];
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function main() {
  assert.deepEqual(groups.flatMap(group => group.names).sort(), [...NEW_CALLABLES].sort(), 'Exact reviewed 23-callable set');
  const results = [], moduleHashes = [];
  for (const group of groups) {
    const filename = path.join(root, 'functions/lib/modules', group.module + '.js');
    const source = path.join(root, 'functions/src/modules', group.module + '.ts');
    phase = 'loading'; const handlers = require(filename); phase = 'handler';
    moduleHashes.push({ module: group.module, compiledSha256: digest(fs.readFileSync(filename)), sourceSha256: digest(fs.readFileSync(source)) });
    for (const name of group.names) {
      const handler = handlers[name];
      assert.equal(typeof handler?.run, 'function', name + ' is an actual SDK onCall handler');
      assert.ok(Object.hasOwn(handler.__endpoint || {}, 'callableTrigger'), name + ' declares callableTrigger');
      for (const auth of [undefined, null, { uid: '' }]) {
        await assert.rejects(() => handler.run({ data: {}, auth }), error => error?.code === 'unauthenticated', name + ' must reject before data access');
        assert.deepEqual(attempts, { firestore: 0, storage: 0, auth: 0, network: 0, subprocess: 0 }, name + ' had no side-effect attempts');
      }
      results.push({ name, guard: group.guard, anonymousVariants: 3, unauthenticated: true });
    }
  }
  // Positive controls prove the traps detect attempted effects rather than merely returning zero.
  assert.throws(() => dbSpy.doc('synthetic/not-used'), /LOCAL_GUARD_FORBIDS_FIRESTORE/);
  assert.throws(() => adminSpy.storage(), /LOCAL_GUARD_FORBIDS_STORAGE/);
  assert.throws(() => adminSpy.auth(), /LOCAL_GUARD_FORBIDS_AUTH/);
  assert.throws(() => globalThis.fetch('https://synthetic.invalid'), /LOCAL_GUARD_FORBIDS_NETWORK/);
  assert.throws(() => childProcess.spawn('synthetic-never-started'), /LOCAL_GUARD_FORBIDS_SUBPROCESS/);
  assert.deepEqual(attempts, { firestore: 1, storage: 1, auth: 1, network: 1, subprocess: 1 });
  const report = { capturedAt: new Date().toISOString(), ok: true, project, productionAccess: false, emulatorStarted: false,
    handlers: results.length, rejectedRequests: results.length * 3, firestoreAttempts: 0, storageAttempts: 0, authApiAttempts: 0,
    networkAttempts: 0, subprocessAttempts: 0, positiveTrapControls: 5, importReferenceConstructions, moduleHashes, results,
    limitation: 'Local unauthenticated handler test only. Does not exercise authenticated permissions or prove deployed bytes.' };
  const dir = path.join(root, '__untracked_archive/astra-callable-access'); fs.mkdirSync(dir, { recursive: true });
  const output = path.join(dir, 'local-guards-' + report.capturedAt.replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, ok: true, handlers: report.handlers, rejectedRequests: report.rejectedRequests,
    firestoreAttempts: 0, storageAttempts: 0, authApiAttempts: 0, networkAttempts: 0, subprocessAttempts: 0, positiveTrapControls: 5 }));
}
main().catch(error => { console.error(error?.stack || error?.code || error.message || 'LOCAL_GUARD_FAILED'); process.exitCode = 1; });
