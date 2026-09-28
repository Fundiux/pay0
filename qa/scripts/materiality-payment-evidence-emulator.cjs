const assert = require('node:assert/strict');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') ||
    !String(process.env.GCLOUD_PROJECT || '').startsWith('demo-')) throw Error('LOCAL_EMULATOR_REQUIRED');
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({projectId:process.env.GCLOUD_PROJECT});
const db = admin.firestore();
let externalActions = 0;
global.fetch = () => { externalActions++; throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
const service = require('../../functions/lib/modules/materiality/service');
const callables = require('../../functions/lib/modules/materiality/callables');
const triggers = require('../../functions/lib/modules/materiality/triggers');
const id = 'mat-evidence-' + Date.now(), rootId = id, solicitudId = id;
async function put(collection, key, data) { await db.doc(`${collection}/${key}`).set(data); }
(async () => {
  await put('clients',id,{rootId,name:'Cliente prueba',active:true});
  await put('companies',id,{rootId,nombre:'Empresa prueba',active:true});
  await put('solicitudes',id,{rootId,clienteId:id,companyId:id,folio:'S-TEST',monto:200,moneda:'MXN',status:'PROCESANDO'});
  await put('pagos',id,{rootId,clienteId:id,companyId:id,status:'CONCILIADO'});
  for (let index=1;index<=2;index++) {
    await put('pagoAplicaciones',`${id}-a${index}`,{rootId,solicitudId,pagoId:id,status:'APLICADA',folio:`AP-TEST-${index}`,numeroParcialidad:index});
    for(const format of ['XML','PDF']) await put('uploads',`${id}-${index}-${format}`,{
      rootId,solicitudId,pagoId:id,applicationId:`${id}-a${index}`,entityType:'pagos',entityId:id,
      documentType:`COMPLEMENTO_PAGO_${format}`,active:true,status:'READY',finalizedBy:'SYSTEM',version:1,
      storagePath:`roots/${id}/fixture-${index}.${format.toLowerCase()}`,sha256:'a'.repeat(64),
    });
  }
  await put('uploads',`${id}-receipt`,{rootId,pagoId:id,entityType:'pagos',documentType:'COMPROBANTE_PAGO',active:true,status:'READY',storagePath:`roots/${id}/receipt.pdf`});
  await put('uploads',`${id}-foreign`,{rootId:'other-root',solicitudId,pagoId:id,applicationId:`${id}-a1`,entityType:'pagos',documentType:'COMPLEMENTO_PAGO_XML',active:true,status:'READY',storagePath:'foreign'});
  await put('uploads',`${id}-wrong-app`,{rootId,solicitudId,pagoId:id,applicationId:'unrelated',entityType:'pagos',documentType:'COMPLEMENTO_PAGO_XML',active:true,status:'READY',storagePath:'unrelated'});
  const uploadRef=db.doc(`uploads/${id}-1-XML`), after=await uploadRef.get();
  await triggers.refreshMaterialityFromUpload.run({params:{uploadId:after.id},data:{before:{data:()=>({}),exists:false},after}});
  const operationRef=db.doc(`materialityOperations/${id}`), first=await operationRef.get();
  assert.equal(first.data().updatedBy,'SYSTEM');
  assert.equal(first.data().documentRefs.length,5,'receipt plus two XML/PDF partialities');
  assert.equal(first.data().completedTypes.filter(type=>type==='COMPLEMENTO_PAGO_XML').length,1);
  assert.equal(first.data().documentRefs.filter(row=>row.documentType==='COMPLEMENTO_PAGO_PDF').length,2);
  await service.refreshMaterialityProjectionFromSource({rootId,solicitudId});
  assert(first.updateTime.isEqual((await operationRef.get()).updateTime),'unchanged refresh does not write timestamps');
  const viewer=`${id}-viewer`, owner=`${id}-owner`;
  await put('users',rootId,{rootId,role:'superadmin',isActive:true});
  await put('users',viewer,{rootId,role:'admin',isActive:true,modules:{materialidad:{view:true}}});
  await put('users',owner,{rootId,role:'admin',isActive:true,modules:{materialidad:{view:true}}});
  const view = uid => callables.getMaterialityOperation.run({auth:{uid,token:{}},data:{materialityOperationId:id}});
  const viewCore = uid => service.getMaterialityOperationCore({auth:{uid},data:{materialityOperationId:id}});
  await assert.rejects(view(viewer),error=>error.code==='permission-denied');
  await assert.rejects(viewCore(viewer),error=>error.code==='permission-denied');
  await db.doc(`clients/${id}`).update({adminId:owner});
  await assert.rejects(view(owner),error=>error.code==='permission-denied');
  assert.equal((await viewCore(owner)).operation.documentRefs.length,5,'core respects client owner; public callable retains role ceiling');
  assert.equal((await view(rootId)).operation.documentRefs.length,5,'root superadmin sees evidence');
  await db.doc(`userClientAccess/${viewer}/clients/${id}`).set({rootId,active:true,permissions:{view:true}});
  assert.equal((await viewCore(viewer)).operation.documentRefs.length,5,'core respects active delegated view');
  await db.doc(`userClientAccess/${viewer}/clients/${id}`).update({active:false});
  await assert.rejects(viewCore(viewer),error=>error.code==='permission-denied');

  // Deterministically mutate evidence after the service's initial source reads,
  // immediately before its transaction starts. The projection must use tx queries,
  // never the previously gathered upload list.
  const originalRunTransaction=db.runTransaction.bind(db), changedUpload=db.doc(`uploads/${id}-1-XML`);
  let intercepted=false, queryReads=0;
  db.runTransaction=async (callback,options)=>{
    if(!intercepted){intercepted=true;await changedUpload.update({active:false,status:'INACTIVE'});}
    return originalRunTransaction(async tx=>{
      const originalGet=tx.get.bind(tx);
      tx.get=(target,...args)=>{if(!target.path)queryReads++;return originalGet(target,...args);};
      return callback(tx);
    },options);
  };
  try { await service.refreshMaterialityProjectionFromSource({rootId,solicitudId}); }
  finally { db.runTransaction=originalRunTransaction; }
  assert(intercepted && queryReads>=4,'projection reads uploads, applications and contracts within transaction');
  assert.equal((await operationRef.get()).data().documentRefs.length,4,'concurrent deactivation cannot restore stale evidence');
  await changedUpload.update({active:true,status:'READY'});
  await service.refreshMaterialityProjectionFromSource({rootId,solicitudId});
  const appRef=db.doc(`pagoAplicaciones/${id}-a2`), beforeApp=await appRef.get();
  await appRef.update({status:'REVERSADA'});
  await triggers.refreshMaterialityFromPaymentApplication.run({params:{applicationId:appRef.id},data:{before:beforeApp,after:await appRef.get()}});
  const reversed=await operationRef.get();
  assert.equal(reversed.data().documentRefs.length,3,'reversed application evidence leaves the active projection');
  assert(reversed.data().documentRefs.every(row=>row.applicationId!==appRef.id));
  await assert.rejects(service.refreshMaterialityProjectionFromSource({rootId:'foreign-root',solicitudId}),error=>error.code==='permission-denied');
  await db.doc(`companies/${id}`).update({rootId:'foreign-root'});
  await assert.rejects(service.refreshMaterialityProjectionFromSource({rootId,solicitudId}),error=>error.code==='permission-denied');
  assert(reversed.updateTime.isEqual((await operationRef.get()).updateTime),'failed scope checks preserve projection');
  await triggers.refreshMaterialityFromPaymentApplication.run({time:new Date().toISOString(),params:{applicationId:'invalid'},data:{before:{data:()=>({})},after:{data:()=>({rootId,solicitudId,status:'APLICADA'})}}});
  assert(reversed.updateTime.isEqual((await operationRef.get()).updateTime),'permanent scope failures do not retry or mutate projection');
  await db.doc(`companies/${id}`).update({rootId});
  const receiptRef=db.doc(`uploads/${id}-receipt`), beforeDelete=await receiptRef.get();
  await receiptRef.delete();
  await triggers.refreshMaterialityFromUpload.run({time:new Date().toISOString(),params:{uploadId:receiptRef.id},data:{before:beforeDelete,after:{exists:false,data:()=>undefined}}});
  assert.equal((await operationRef.get()).data().documentRefs.length,2,'deletion refreshes remaining evidence');
  assert.equal(externalActions,0);
  console.log(JSON.stringify({ok:true,checks:21,systemAuthoredProjection:'PASS',allPartialities:'PASS',reversedApplication:'PASS',deletedReceipt:'PASS',scope:'PASS',clientDelegation:'PASS',publicRoleCeiling:'PASS',transactionalProjection:'PASS',permanentErrorStops:'PASS',repeatIsNoOp:'PASS',externalActions}));
})().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
