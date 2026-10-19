// Exercises the real compiled overlay and baseline against a disposable Firestore emulator.
// Run only with an explicit artifact directory and demo project; no production credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { createRequire } = Module;
assert.match(process.env.GCLOUD_PROJECT || '', /^demo-pay0-complement-/);
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/);
const directory = fs.realpathSync(process.argv[2]);
assert.ok(directory.startsWith(path.resolve('.firebase/modular-release') + path.sep));
const requireArtifact = createRequire(path.join(directory, 'package.json'));
const admin = requireArtifact('firebase-admin');
const entry = requireArtifact('./lib/index.js');
const db = admin.firestore();
const configure = entry.configurePaymentComplementAutomation;
const original = new Module(path.join(directory, 'lib/modules/paymentApplications/baseline-complementAutomation.js'), module);
original.filename = path.join(directory, 'lib/modules/paymentApplications/complementAutomation.js');
original.paths = Module._nodeModulePaths(path.dirname(original.filename));
original._compile(fs.readFileSync(process.argv[3], 'utf8'), original.filename);
const baseline = original.exports.configurePaymentComplementAutomation;
(async () => {
  await assert.rejects(configure.run({ data: {} }), e => e.code === 'unauthenticated');
  const rootId = 'synthetic-root', ref = db.doc(`paymentComplementConfigs/${rootId}`);
  for (const [uid, role, active, root] of [
    ['first','superadmin',true,rootId], ['second','superadmin',true,rootId],
    ['disabled','superadmin',false,rootId], ['operator','operador',true,rootId],
    ['foreign','superadmin',true,'synthetic-foreign'],
  ]) await db.doc(`users/${uid}`).set({rootId:root,role,active});
  const call = (target,uid,data) => target.run({auth:{uid,token:{}},data});
  const reset = () => ref.set({rootId,iqEnabled:false,facturamaEnabled:false,iqLookupEnabled:true,
    activatedAt:admin.firestore.Timestamp.fromMillis(123456)});
  // The legacy full-state contract is unchanged in both compiled artifacts.
  for (const target of [baseline,configure]) {
    await reset();
    await call(target,'first',{iqEnabled:true,facturamaEnabled:true,confirmation:'AUTORIZO_REP_AUTOMATICO'});
    const row=(await ref.get()).data();
    assert.equal(row.iqEnabled,true);assert.equal(row.facturamaEnabled,true);
    assert.equal(row.iqLookupEnabled,true);assert.equal(row.activatedAt.toMillis(),123456);
  }
  await assert.rejects(call(baseline,'first',{provider:'IQ',enabled:true}),e=>e.code==='invalid-argument');
  await reset();
  await Promise.all([
    call(configure,'first',{provider:'FACTURAMA',enabled:true,confirmation:'AUTORIZO_REP_AUTOMATICO'}),
    call(configure,'second',{provider:'IQ',enabled:true}),
  ]);
  const concurrent=(await ref.get()).data();
  assert.equal(concurrent.iqEnabled,true);assert.equal(concurrent.facturamaEnabled,true);
  assert.equal(concurrent.iqLookupEnabled,true);assert.equal(concurrent.activatedAt.toMillis(),123456);
  await call(configure,'second',{provider:'IQ',enabled:false});
  assert.equal((await ref.get()).get('facturamaEnabled'),true);
  for(const uid of ['disabled','operator'])
    await assert.rejects(call(configure,uid,{provider:'IQ',enabled:true}),e=>e.code==='permission-denied');
  await assert.rejects(call(configure,'first',{provider:'FACTURAMA',enabled:true}),e=>e.code==='failed-precondition');
  for(const data of [{provider:'IQ',enabled:true,iqEnabled:false,facturamaEnabled:false},
    {provider:'OTHER',enabled:true},{provider:'IQ',enabled:'true'},{enabled:true}])
    await assert.rejects(call(configure,'first',data),e=>e.code==='invalid-argument');
  await call(configure,'foreign',{rootId,provider:'IQ',enabled:true});
  assert.equal((await ref.get()).get('iqEnabled'),false);
  assert.equal((await db.doc('paymentComplementConfigs/synthetic-foreign').get()).get('iqEnabled'),true);
  const result={status:'PASS',artifact:'compiled-production-overlay',baselineLegacyCompatible:true,
    baselineRejectsNewContract:true,concurrentProvidersPreserved:true,untouchedLookupAndActivationPreserved:true,
    negativeAuthorizationCases:3,invalidContractCases:4,confirmationRequired:true,rootCannotBeOverridden:true,
    endpointsLoaded:Object.values(entry).filter(x=>x?.__endpoint).length,productionWrites:0};
  console.log(JSON.stringify(result));
  await admin.app().delete();
})().catch(error=>{console.error(error);process.exitCode=1;});
