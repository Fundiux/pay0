const assert=require('node:assert/strict');
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'')||!process.env.FIREBASE_STORAGE_EMULATOR_HOST||process.env.GCLOUD_PROJECT!=='demo-pay0')throw Error('Local emulators required');
global.fetch=async()=>{throw Error('EXTERNAL_NETWORK_FORBIDDEN')};
const admin=require('../../functions/node_modules/firebase-admin');admin.initializeApp({projectId:'demo-pay0',storageBucket:'demo-pay0.appspot.com'});
const db=admin.firestore(),stamp=admin.firestore.Timestamp;
const {reconcilePaymentComplement,complementRequestId}=require('../../functions/lib/modules/paymentApplications/complementFollowup');
const {scanDueIqFollowups}=require('../../functions/lib/modules/paymentApplications/complementDailyLookup');
const {checkComplementDaily}=require('../../functions/lib/modules/paymentApplications/complementAutomation');
const {iqRepRequestId}=require('../../functions/lib/modules/paymentApplications/complementRequestIdentity');
const {saveComplementDocuments}=require('../../functions/lib/modules/paymentApplications/complementDocuments');
const {inventoryPage}=require('../../functions/lib/modules/paymentApplications/complementInventory');
const root=`daily-b-${Date.now()}`,profileId=`${root}-profile`,uuid='11111111-1111-4111-8111-111111111111';
const xml=Buffer.from(`<Comprobante TipoDeComprobante="P"><TimbreFiscalDigital UUID="22222222-2222-4222-8222-222222222222"/><DoctoRelacionado IdDocumento="${uuid}" NumParcialidad="1" ImpPagado="58" ImpSaldoAnt="116" ImpSaldoInsoluto="58" MonedaDR="MXN"/></Comprobante>`);
const pdf=Buffer.from('%PDF-1.4\n% daily B emulator');
const now=new Date('2026-09-21T01:00:00Z'),past=stamp.fromDate(new Date(now.getTime()-60*60*1000));
async function seed(number,depositId){
  const appId=`${root}-app${number}`,solicitudId=`${root}-s${number}`,pagoId=`${root}-p${number}`,planId=`${root}-plan${number}`,attemptId=`${root}-attempt${number}`;
  await db.doc(`solicitudes/${solicitudId}`).set({rootId:root,folio:`S${number}`,tipoFactura:'PPD',clienteId:root,companyId:root,iqFolio:`I${number}`,facturaUuid:uuid,status:'PROCESANDO'});
  await db.doc(`pagos/${pagoId}`).set({rootId:root,folio:`P${number}`,clienteId:root,companyId:root,status:'CONCILIADO',moneda:'MXN'});
  await db.doc(`pagoApplicationIqPlans/${planId}`).set({rootId:root,pagoId,iqExecutionProfileId:profileId,plan:{pagoIqFolio:depositId}});
  await db.doc(`pagoApplicationIqAttempts/${attemptId}`).set({rootId:root,planId,profileId,createdBy:root});
  await db.doc(`pagoAplicaciones/${appId}`).set({rootId:root,folio:`AP${number}`,solicitudId,pagoId,status:'APLICADA',invoiceType:'PPD',montoAplicado:58,
    numeroParcialidad:1,saldoAnterior:116,saldoInsoluto:58,iqApplicationStatus:'IQ_APPLIED',iqActionExecuted:true,iqPlanId:planId,iqExecutionAttemptId:attemptId});
  await reconcilePaymentComplement(appId);
  const ref=db.doc(`paymentComplementRequests/${complementRequestId(root,appId)}`);
  await ref.update({status:'PENDING_B',automationStatus:'PENDING_B',repAttachmentStatus:'REP_ATTACHMENT_NOT_AVAILABLE',nextCheckAt:past});
  return {appId,depositId,ref};
}
async function run(){
  await db.doc(`users/${root}`).set({rootId:root,role:'superadmin',active:true});
  await db.doc(`clients/${root}`).set({rootId:root,adminId:root,active:true});
  await db.doc(`iqIntegrationConfigs/${root}`).set({rootId:root,enabled:true,automation:{aplicacionPagos:false}});
  await db.doc(`paymentComplementConfigs/${root}`).set({rootId:root,iqLookupEnabled:true,iqEnabled:false,iqLookupDailyLimit:25});
  await db.doc(`iqUserAccess/${root}`).set({rootId:root,active:true,iqEnabled:true,iqCredentialProfileId:profileId,allowedModules:{pagos:true}});
  await db.doc(`iqCredentialProfiles/${profileId}`).set({rootId:root,active:true,hasPassword:true,username:'smoke'});
  const [one,two,three,four]=await Promise.all([seed(1,'220481'),seed(2,'220482'),seed(3,'220483'),seed(4,'220484')]);
  const jobId=iqRepRequestId(root,one.depositId);
  await db.doc(`paymentComplementJobs/${jobId}`).set({rootId:root,provider:'IQ',applicationId:one.appId,depositId:one.depositId,profileId,actorUid:root,clientId:root,
    status:'UNKNOWN',attemptedAt:past,nextCheckAt:past});
  await one.ref.update({status:'REQUEST_STATE_UNKNOWN',automationStatus:'UNKNOWN',externalRequestSent:null,automationJobId:jobId});
  let attachmentGets=0,posts=0,downloads=0;
  const adapter={iqSession:async()=>({accessToken:'emulator-only'}),requestIqComplement:async()=>{posts++;throw Error('C_FORBIDDEN')},
    observeIqRepAttachment:async job=>{attachmentGets++;if(job.depositId===four.depositId)return {classification:'REP_ATTACHMENT_AMBIGUOUS',shape:{httpStatus:503},url:null};
      if(job.depositId===three.depositId)return {classification:'REP_ATTACHMENT_AVAILABLE',shape:{httpStatus:200,urlPresent:true},url:'https://iq.example/rails/active_storage/blobs/redirect/fixture'};
      return {classification:'REP_ATTACHMENT_NOT_AVAILABLE',shape:{httpStatus:400,exactNoAttachmentMessage:true},url:null};},
    importIqComplement:async(_url,sources)=>{downloads++;return [{source:sources[0],documents:await saveComplementDocuments(sources[0],xml,pdf)}]},
    availableIqComplement:async()=>{attachmentGets++;return null;}};
  await Promise.all([scanDueIqFollowups(now,adapter),scanDueIqFollowups(now,adapter)]);
  assert.equal(attachmentGets,3,'each no-job follow-up gets only one B read despite concurrent scheduler');
  assert.equal(downloads,1);assert.equal(posts,0);
  assert.equal((await two.ref.get()).data().bReadState,'WAITING_B');
  assert.equal((await three.ref.get()).data().status,'RECEIVED');
  assert.equal((await four.ref.get()).data().bReadState,'EXCEPTION');
  assert.equal((await four.ref.get()).data().nextCheckAt,null);
  await checkComplementDaily(jobId,now,adapter);
  assert.equal(attachmentGets,4);assert.equal((await one.ref.get()).data().status,'REQUEST_STATE_UNKNOWN');
  assert.equal((await db.doc(`paymentComplementJobs/${jobId}`).get()).data().status,'UNKNOWN');assert.equal(posts,0);
  const nextDay=new Date(now.getTime()+24*60*60*1000);
  await scanDueIqFollowups(nextDay,adapter);
  assert.equal(attachmentGets,5,'next ordinary day reads only still-pending AP2');
  await db.doc(`iqIntegrationConfigs/${root}`).update({enabled:false});
  await scanDueIqFollowups(new Date(now.getTime()+48*60*60*1000),adapter);
  assert.equal(attachmentGets,5,'closed master blocks external B');
  assert.equal((await two.ref.get()).data().bReadState,'BLOCKED');
  const counts=(await inventoryPage(root)).counts;
  assert.equal(counts.uncertainC,1);assert.equal(counts.exceptionBlocked,2);assert.equal(counts.processed,1);
  assert.equal(posts,0);
  console.log(JSON.stringify({ok:true,concurrentBReads:3,nextDayBReads:1,masterBlocksExternal:true,ap1UnknownPreserved:true,
    availableRepVerified:true,ambiguousCaseIsolated:true,cPosts:posts,externalNetworkCalls:0}));
}
run().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1)});
