// Exact createPago artifact against the separately deployed receipt reader; demo emulators only.
const path=require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const projectId = process.env.GCLOUD_PROJECT || '';
if (!projectId.startsWith('demo-') || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_STORAGE_EMULATOR_HOST || '')) throw Error('LOCAL_DEMO_EMULATORS_REQUIRED');
const realFetch = global.fetch;
global.fetch = (url, ...args) => {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(typeof url === 'string' ? url : url.url || url).hostname), 'No external fetch');
  return realFetch(url, ...args);
};
for (const protocol of ['http', 'https']) {
  const api = require(`node:${protocol}`), original = api.request;
  api.request = function (url, ...args) {
    const host = typeof url === 'string' || url instanceof URL ? new URL(url).hostname : String(url.hostname || url.host || '').split(':')[0];
    assert.ok(['127.0.0.1', 'localhost'].includes(host), 'No external transport');
    return original.call(this, url, ...args);
  };
}
const artifactRoot=path.resolve(process.env.PAY0_CREATE_ARTIFACT_ROOT||'');
const receiptRoot=path.resolve(process.env.PAY0_RECEIPT_ARTIFACT_ROOT||artifactRoot);
assert.ok(artifactRoot.startsWith(path.resolve('.firebase/modular-release')+path.sep),'EXACT_ARTIFACT_REQUIRED');
const artifactRequire=require('node:module').createRequire(path.join(artifactRoot,'package.json'));
const receiptRequire=require('node:module').createRequire(path.join(receiptRoot,'package.json'));
const admin=artifactRequire('firebase-admin');
admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
const db = admin.firestore(), bucket = admin.storage().bucket();
const { createPago } = artifactRequire('./lib/index.js');
const {identifyParsedReceipt: identifyWithReceiptDb}=receiptRequire('./lib/modules/pagos/receiptIdentification');
const receiptAdmin=receiptRequire('firebase-admin');if(!receiptAdmin.apps.length)receiptAdmin.initializeApp({projectId});
const receiptDb=receiptAdmin.firestore();const identifyParsedReceipt=input=>identifyWithReceiptDb({...input,db:receiptDb});
const { parseReceiptText } = receiptRequire('./lib/modules/pagos/receiptPdfCallables');
const docs = artifactRequire('./lib/modules/pagoDocuments/service');
const { activityCollectionForSystem } = artifactRequire('./lib/modules/activityLog/systemBoundary');
const root = `receipt-create-${Date.now()}`, second = `${root}-second`, clientId = `${root}-client`, companyId = `${root}-company`, dispatchId = `${root}-dispatch`, operation = `${root}-OP`.toUpperCase();
const body = ['Transferencia SPEI MXN', 'Estado: Aplicada', 'Ordenante: Cliente Prueba', 'RFC ordenante: ABC010101AB1',
  'Beneficiario: Empresa Prueba', 'RFC beneficiario: DEF020202CD2', 'Monto: $1,000.50', 'Fecha: 2026-09-27',
  'Referencia: 0123-abc-456', 'Concepto: factura 123e4567-e89b-12d3-a456-426614174000'].join('\n');
const bytes = Buffer.from(body), sha = createHash('sha256').update(bytes).digest('hex');
let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; };
const denied = async (fn, code) => { await assert.rejects(fn, error => error.code === code); checks++; };
const call = (fn, uid, data) => fn.run({ auth: { uid, token: {} }, data });
async function identify(uid = root) {
  return identifyParsedReceipt({ db, actor: { uid, role: 'superadmin', rootId: root }, receipt: parseReceiptText(body), contentSha256: sha, operationTypeKey: operation });
}
async function verifyArtifact(){
  const fs=require('fs'),archive=process.env.PAY0_CREATE_ARTIFACT_ZIP,expected=process.env.PAY0_CREATE_ARCHIVE_SHA;
  assert.ok(archive&&expected,'EXACT_ZIP_HASH_REQUIRED');const bytes=fs.readFileSync(archive);assert.equal(createHash('sha256').update(bytes).digest('hex'),expected);
  const zip=await require('../../functions/node_modules/jszip').loadAsync(bytes);
  for(const entry of Object.values(zip.files))if(!entry.dir)assert.deepEqual(fs.readFileSync(path.join(artifactRoot,entry.name)),await entry.async('nodebuffer'),'ARTIFACT_RUNTIME_DRIFT:'+entry.name);
}
async function main() {
  await verifyArtifact();
  for (const uid of [root, second]) await db.doc(`users/${uid}`).set({ rootId: root, role: 'superadmin', active: true, userNumber: uid === root ? 3 : 4 });
  await db.doc(`clients/${clientId}`).set({ rootId: root, active: true, createdBy: root, adminId: root, clientNumber: 7, razonSocial: 'Cliente Prueba', rfc: 'ABC010101AB1' });
  await db.doc(`companies/${companyId}`).set({ rootId: root, active: true, companyNumber: 5, razonSocial: 'Empresa Prueba', rfc: 'DEF020202CD2', despachoId: dispatchId });
  await db.doc(`despachos/${dispatchId}`).set({ rootId: root, active: true, iqEnabled: false });
  await db.doc(`operationTypes/${operation}`).set({ active: true, name: 'Operación sintética' });
  await db.doc(`clients/${clientId}/costos/${dispatchId}__${operation}`).set({ active: true, assignedCost: 5, pricingMode: 'PERCENT', calculationBaseType: 'TOTAL' });
  await db.doc(`despachos/${dispatchId}/costos/${operation}`).set({ active: true, baseCost: 2, pricingMode: 'PERCENT', calculationBaseType: 'TOTAL' });
  const analysisId = createHash('sha256').update(`${root}-analysis`).digest('hex');
  const analysisRef = db.doc(`pagoReceiptAnalyses/${analysisId}`);
  await analysisRef.set({ rootId: root, correctionVersionsByActor: { [root]: 0 } });
  const identified = await identifyParsedReceipt({ db, actor: { uid: root, role: 'superadmin', rootId: root }, receipt: parseReceiptText(body), contentSha256: sha, operationTypeKey: operation, analysisId, correctionVersion: 0 });
  const payload = identified.createPayload;
  await analysisRef.set({ correctionVersionsByActor: { [root]: 1 } }, { merge: true });
  await denied(() => call(createPago, root, payload), 'failed-precondition');
  check((await db.collection('pagos').where('rootId', '==', root).get()).empty, 'Correction race creates no stale payment');
  await analysisRef.set({ correctionVersionsByActor: { [root]: 0 } }, { merge: true });
  check(identified.status === 'READY' && payload, 'Server identifies explicit receipt');
  await denied(() => call(createPago, root, { ...payload, montoTotal: 10000 }), 'failed-precondition');
  await denied(() => call(createPago, second, payload), 'permission-denied');
  await db.doc(`operationTypes/${operation}`).update({ active: false });
  await denied(() => call(createPago, root, payload), 'failed-precondition');
  await db.doc(`operationTypes/${operation}`).update({ active: true });
  await db.doc(`users/${root}`).update({ disabled: true });
  await denied(() => call(createPago, root, payload), 'permission-denied');
  await db.doc(`users/${root}`).update({ disabled: false });
  await db.doc(`clients/${clientId}/costos/${dispatchId}__${operation}`).update({ active: false });
  await denied(() => call(createPago, root, payload), 'failed-precondition');
  await db.doc(`clients/${clientId}/costos/${dispatchId}__${operation}`).update({ active: true });
  check((await db.collection('pagos').where('rootId', '==', root).get()).empty, 'All rejected attempts leave zero payments');
  const results = await Promise.allSettled(Array.from({length:8},()=>call(createPago, root, payload))); 
  check(results.filter(result => result.status === 'fulfilled').length === 1 && results.some(result => result.status === 'rejected' && result.reason.code === 'already-exists'), 'Concurrent create has one winner and one explicit duplicate');
  const result = results.find(result => result.status === 'fulfilled').value;
  const pago = await db.doc(`pagos/${result.pagoId}`).get(), idRef = db.doc(`pagoReceiptIdentifications/${identified.id}`);
  check(result.folio === 'P1C7U3E5', 'Canonical sequence and client owner preserved');
  check(pago.get('montoTotal') === 1000.5 && pago.get('concepto') === payload.concepto && pago.get('registrationSource') === 'RECEIPT_AUTOMATIC', 'Receipt source and money preserved');
  check(pago.get('financialAssignmentSnapshot.clientCost.rate') === 5 && pago.get('financialAssignmentSnapshot.despachoCost.rate') === 2, 'Current financial costs captured by canonical create');
  check((await idRef.get()).get('pagoId') === result.pagoId && (await idRef.get()).get('stage') === 'REGISTERED_AWAITING_RECEIPT', 'Payment and receipt claim commit atomically');
  const secondIdentity = await identify(second);
  await denied(() => call(createPago, second, secondIdentity.createPayload), 'already-exists');
  const alteredIdentity = await identifyParsedReceipt({ db, actor: { uid: second, role: 'superadmin', rootId: root },
    receipt: { ...parseReceiptText(body), date: '2026-09-28', reference: 'CORRECTED-REFERENCE' }, contentSha256: sha, operationTypeKey: operation });
  check(alteredIdentity.status === 'READY', 'Another actor may review their own corrected data');
  await denied(() => call(createPago, second, alteredIdentity.createPayload), 'already-exists');
  const contentClaim = db.doc(`pagoReceiptDedup/content_${createHash('sha256').update(JSON.stringify([root, sha])).digest('hex')}`);
  check((await contentClaim.get()).get('pagoId') === result.pagoId, 'File fingerprint is claimed with the canonical payment');
  await contentClaim.update({ clienteId: 'another-client' });
  await assert.rejects(() => call(createPago, second, alteredIdentity.createPayload), error => error.code === 'already-exists' && error.details.pagoId === null); checks++;
  // Simulate an older registration with no content claim; its identification still protects it.
  await contentClaim.delete();
  await denied(() => call(createPago, second, alteredIdentity.createPayload), 'already-exists');
  const upload = await docs.initPagoDocumentUploadCore({ auth: { uid: root }, data: { pagoId: result.pagoId, documentType: 'COMPROBANTE_PAGO', originalName: 'synthetic.txt', contentType: 'text/plain', sizeBytes: bytes.length, sha256: sha } });
  await bucket.file(upload.storagePath).save(bytes);
  await docs.finalizePagoDocumentUploadCore({ auth: { uid: root }, data: upload });
  check((await idRef.get()).get('stage') === 'RECEIPT_READY', 'Actual source bytes finalize same canonical payment');
  check((await db.collection('pagos').where('rootId', '==', root).get()).size === 1, 'Replay and cross-actor duplicate create no second payment');
  const activities = await db.collection(activityCollectionForSystem('PAY0')).where('rootId', '==', root).get();
  check(activities.docs.filter(doc => doc.get('event') === 'PAGO_CREADO').length === 1, 'One creation audit event');
  check((await db.collection('pagoAplicaciones').where('rootId', '==', root).get()).empty, 'Registration alone cannot apply unreconciled money');
  // Exercise the actual canonical create boundary with a previously READY delegated receipt.
  const delegateUid = `${root}-delegate`;
  const grantRef = db.doc(`userClientAccess/${delegateUid}/clients/${clientId}`);
  await db.doc(`users/${delegateUid}`).set({ rootId: root, role: 'operador', active: true, adminId: root, userNumber: 9 });
  await db.doc(`userCompanyAccess/${delegateUid}/companies/${companyId}`).set({ active: true });
  const validGrant = { rootId: root, clientId, active: true, grantedBy: root, createdBy: root,
    permissions: { view: true, operatePagos: true, operateSolicitudes: true },
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 3600000) };
  await grantRef.set(validGrant);
  const delegatedBody = body.replace('0123-abc-456', 'DELEGATED-9876');
  const delegatedHash = createHash('sha256').update(delegatedBody).digest('hex');
  const delegatedIdentity = await identifyParsedReceipt({ db, actor: { uid: delegateUid, role: 'operador', rootId: root },
    receipt: parseReceiptText(delegatedBody), contentSha256: delegatedHash, operationTypeKey: operation });
  check(delegatedIdentity.status === 'READY' && delegatedIdentity.createPayload, 'Valid delegate obtains a verified READY receipt');
  const delegatedPayload = delegatedIdentity.createPayload;
  await grantRef.update({ active: false });
  await denied(() => call(createPago, delegateUid, delegatedPayload), 'permission-denied');
  await grantRef.set({ ...validGrant, expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1000) });
  await denied(() => call(createPago, delegateUid, delegatedPayload), 'permission-denied');
  await grantRef.set(validGrant);
  await db.doc(`users/${delegateUid}`).update({ disabled: true });
  await denied(() => call(createPago, delegateUid, delegatedPayload), 'permission-denied');
  await db.doc(`users/${delegateUid}`).update({ disabled: false });
  await db.doc(`users/${root}`).update({ disabled: true });
  await denied(() => call(createPago, delegateUid, delegatedPayload), 'permission-denied');
  await db.doc(`users/${root}`).update({ disabled: false });
  check((await db.collection('pagos').where('rootId', '==', root).get()).size === 1, 'Revoked, expired and blocked actors cannot consume a stale READY identity');
  const transactionBeforeRevocation=db.runTransaction.bind(db);let revokedAtBoundary=false;
  db.runTransaction=(update,...args)=>transactionBeforeRevocation(async tx=>{if(!revokedAtBoundary&&String(update).includes('receiptIdentificationSnap')){revokedAtBoundary=true;await grantRef.update({active:false});}return update(tx);},...args);
  try{await denied(()=>call(createPago,delegateUid,delegatedPayload),'permission-denied');check(revokedAtBoundary,'Permission revocation happened after preflight at the payment transaction boundary');}finally{db.runTransaction=transactionBeforeRevocation;await grantRef.set(validGrant);}
  const delegatedResult = await call(createPago, delegateUid, delegatedPayload);
  const delegatedPago = await db.doc(`pagos/${delegatedResult.pagoId}`).get();
  check(delegatedPago.get('actorUid') === delegateUid && delegatedPago.get('accessSource') === 'DELEGATED', 'Valid delegated create preserves actor and delegation provenance');
  check(delegatedResult.folio.includes('C7U3E5'), 'Delegated create retains original client owner in canonical folio');
  check((await db.collection('pagos').where('rootId', '==', root).get()).size === 2, 'Exactly one additional valid delegated payment is created');
  const beforeAtomicCount=(await db.collection('pagos').where('rootId','==',root).get()).size;
  const counterRef=db.doc(pago.get('sequenceCounterPath')),beforeCounter=(await counterRef.get()).data();
  const abortBody=body.replace('0123-abc-456','ATOMIC-ABORT-CASE'),abortHash=createHash('sha256').update(abortBody).digest('hex');
  const abortIdentity=await identifyParsedReceipt({db,actor:{uid:root,role:'superadmin',rootId:root},receipt:parseReceiptText(abortBody),contentSha256:abortHash,operationTypeKey:operation});
  check(abortIdentity.status==='READY','Atomic failure fixture is authorized and valid');
  const realTransaction=db.runTransaction.bind(db);
  db.runTransaction=(update,...args)=>realTransaction(async tx=>{const realSet=tx.set.bind(tx);tx.set=(ref,...values)=>{const result=realSet(ref,...values);if(ref.path.startsWith('pagos/')&&ref.path.split('/').length===2)throw Error('SYNTHETIC_TRANSACTION_ABORT_AFTER_STAGED_PAYMENT');return result;};return update(tx);},...args);
  try{await assert.rejects(call(createPago,root,abortIdentity.createPayload),/SYNTHETIC_TRANSACTION_ABORT_AFTER_STAGED_PAYMENT/);checks++;}finally{db.runTransaction=realTransaction;}
  check((await db.collection('pagos').where('rootId','==',root).get()).size===beforeAtomicCount,'Aborted transaction persists no partial payment');
  assert.deepEqual((await counterRef.get()).data(),beforeCounter);checks++;
  check((await db.doc('pagoReceiptIdentifications/'+abortIdentity.id).get()).get('status')==='READY','Atomic failure does not consume identity');
  check(!(await db.doc('pagoReceiptDedup/content_'+createHash('sha256').update(JSON.stringify([root,abortHash])).digest('hex')).get()).exists,'Atomic failure persists no file claim');
  const manualPayload={...payload,receiptIdentificationId:undefined};
  for(const invalid of [0,-1,NaN,Infinity])await denied(()=>call(createPago,root,{...manualPayload,montoTotal:invalid,referencia:'INVALID-AMOUNT'}),'invalid-argument');
  const manualResults=await Promise.all(Array.from({length:6},(_,i)=>call(createPago,root,{...manualPayload,referencia:'MANUAL-CONTENTION-'+i})));
  check(new Set(manualResults.map(item=>item.pagoId)).size===6,'Distinct concurrent manual payments are not conflated');
  check(new Set(manualResults.map(item=>item.folio)).size===6,'Concurrent manual payments have unique canonical folios');
  const allPayments=await db.collection('pagos').where('rootId','==',root).get();
  const sequences=allPayments.docs.map(row=>row.get('sequenceNumber')).sort((a,b)=>a-b);
  assert.deepEqual(sequences,Array.from({length:8},(_,i)=>i+1));checks++;
  const foreignUid=root+'-foreign';await db.doc('users/'+foreignUid).set({rootId:root+'-other',role:'superadmin',active:true,userNumber:20});
  await denied(()=>call(createPago,foreignUid,{...manualPayload,referencia:'FOREIGN-SCOPE'}),'permission-denied');
  await denied(()=>createPago.run({data:manualPayload}),'unauthenticated');
  const rollbackRoot=process.env.PAY0_CREATE_BASELINE_ROOT;
  assert.ok(rollbackRoot,'ROLLBACK_BASELINE_REQUIRED');
  const baselineRequire=require('node:module').createRequire(path.join(rollbackRoot,'package.json'));
  const restored=baselineRequire('./lib/index.js').createPago;
  const beforeRollback=await db.collection('pagos').where('rootId','==',root).get();
  await denied(()=>call(restored,root,payload),'already-exists');
  check((await db.collection('pagos').where('rootId','==',root).get()).size===beforeRollback.size,'Restoring the previous code preserves committed payments and duplicate denial');
  const rollbackManual={...manualPayload,referencia:'ROLLBACK-MANUAL-COMPATIBILITY'};
  const legacyResult=await call(restored,root,rollbackManual);
  check(Boolean(legacyResult.pagoId),'Previous code can create manual payments on the preserved schema');
  await denied(()=>call(createPago,root,rollbackManual),'already-exists');
  const recoveryRoot=process.env.PAY0_CREATE_SAFE_RECOVERY_ROOT;assert.ok(recoveryRoot,'SAFE_RECOVERY_ARTIFACT_REQUIRED');
  const recoveryRequire=require('node:module').createRequire(path.join(recoveryRoot,'package.json')),recoverCreate=recoveryRequire('./lib/index.js').createPago;
  const beforeRecovery=(await db.collection('pagos').where('rootId','==',root).get()).size;
  await denied(()=>call(recoverCreate,root,payload),'failed-precondition');
  await denied(()=>call(recoverCreate,delegateUid,delegatedPayload),'failed-precondition');
  check((await db.collection('pagos').where('rootId','==',root).get()).size===beforeRecovery,'Safe recovery closes automatic receipt creation without modifying payments');
  const safeManual={...manualPayload,referencia:'SAFE-RECOVERY-MANUAL'};
  const safeManualResult=await call(recoverCreate,root,safeManual);check(Boolean(safeManualResult.pagoId),'Safe recovery preserves authorized manual capture');
  await denied(()=>call(createPago,root,safeManual),'already-exists');
  await denied(()=>call(recoverCreate,foreignUid,{...manualPayload,referencia:'SAFE-RECOVERY-FOREIGN'}),'permission-denied');
  await denied(()=>recoverCreate.run({data:safeManual}),'unauthenticated');
  const safeProof={status:'PASS',archiveSha256:process.env.PAY0_CREATE_RECOVERY_SHA,automaticReceiptClosed:true,permissions:true,manualPath:true,rollbackCompatibility:true,productionWrites:0};
  require('fs').writeFileSync(process.env.PAY0_CREATE_RECOVERY_PROOF,JSON.stringify(safeProof,null,2));
  const auditAfter=await db.collection(activityCollectionForSystem('PAY0')).where('rootId','==',root).get();
  check(auditAfter.docs.filter(row=>row.get('event')==='PAGO_CREADO').length===10,'Each committed payment has one creation audit event');
  check((await db.collection('pagoAplicaciones').where('rootId','==',root).get()).empty,'No created payment posts or applies unreconciled money');
  await verifyArtifact();
  const proof={test:'createPago-exact-artifact',archiveSha256:process.env.PAY0_CREATE_ARCHIVE_SHA,checks,status:'PASS',rollbackArchiveSha256:process.env.PAY0_CREATE_RECOVERY_SHA,automaticReceiptRecoveryClosed:true,concurrency:true,duplicates:true,permissions:true,atomicFailure:true,sequence:true,manualPath:true,rollbackCompatibility:true,contentionCalls:8,concurrentManualCalls:6,financialPosting:0,externalActions:0};
  if(process.env.PAY0_CREATE_PROOF_FILE)require('fs').writeFileSync(process.env.PAY0_CREATE_PROOF_FILE,JSON.stringify(proof,null,2));
  console.log(JSON.stringify(proof));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if(receiptDb!==db) {await receiptDb.terminate(); await receiptAdmin.app().delete();} await db.terminate(); await admin.app().delete(); });
