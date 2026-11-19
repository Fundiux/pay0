// Daily complement review: transient failures retry the next day, UNKNOWN is
// never resent, batches never trip the REP volume breaker, due jobs go oldest
// first and the run summary carries no identifiers. Emulator only; no network.
const assert=require('node:assert/strict');
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'')||process.env.GCLOUD_PROJECT!=='demo-pay0')throw Error('Local emulator required');
global.fetch=async()=>{throw Error('EXTERNAL_NETWORK_FORBIDDEN')};
const admin=require('../../functions/node_modules/firebase-admin');admin.initializeApp({projectId:'demo-pay0',storageBucket:'demo-pay0.appspot.com'});
const db=admin.firestore(),stamp=admin.firestore.Timestamp;
const {reconcilePaymentComplement,complementRequestId}=require('../../functions/lib/modules/paymentApplications/complementFollowup');
const api=require('../../functions/lib/modules/paymentApplications/complementAutomation');
const retry=require('../../functions/lib/modules/paymentApplications/complementRetryPolicy');
const {iqRepRequestId}=require('../../functions/lib/modules/paymentApplications/complementRequestIdentity');
const {scopeId,safetyHash}=require('../../functions/lib/modules/automationSafety/runtime');
const watchdog=setTimeout(()=>{console.error('REP_RESILIENCE_TIMEOUT');process.exit(124);},600000);watchdog.unref();
const uuid='11111111-1111-4111-8111-111111111111';
const HOUR=3600000,DAY=24*HOUR;
// 2026-11-23 19:00 in Mexico City (UTC-6).
const base=new Date('2026-11-24T01:00:00Z');
const at=(days,minutes=0)=>new Date(base.getTime()+days*DAY+minutes*60000);
const timeoutError=()=>Object.assign(new Error('The operation was aborted due to timeout'),{name:'TimeoutError'});
const summaries=[];const originalLog=console.log;
console.log=(...args)=>{const line=args.join(' ');if(line.includes('REP_DAILY_SUMMARY'))summaries.push(line);originalLog(...args);};

async function seedRoot(root){
  const profileId=`${root}-profile`;
  await db.doc(`users/${root}`).set({rootId:root,role:'superadmin',active:true});
  await db.doc(`clients/${root}`).set({rootId:root,adminId:root,active:true});
  await db.doc(`iqIntegrationConfigs/${root}`).set({rootId:root,enabled:true,automation:{aplicacionPagos:true}});
  await db.doc(`paymentComplementConfigs/${root}`).set({rootId:root,iqEnabled:true,iqRequestEnabled:true,iqLookupDailyLimit:100,activatedAt:stamp.fromDate(at(-30))});
  await db.doc(`iqUserAccess/${root}`).set({rootId:root,active:true,iqEnabled:true,iqCredentialProfileId:profileId,allowedModules:{pagos:true}});
  await db.doc(`iqCredentialProfiles/${profileId}`).set({rootId:root,active:true,hasPassword:true,username:'resilience'});
  return profileId;
}
// One application linked to one IQ job with the given state.
async function seedJob(root,profileId,number,job){
  const depositId=String(330000+number);
  const appId=`${root}-app${number}`,solicitudId=`${root}-s${number}`,pagoId=`${root}-p${number}`,planId=`${root}-plan${number}`,attemptId=`${root}-attempt${number}`;
  await db.doc(`solicitudes/${solicitudId}`).set({rootId:root,folio:`FOLIO-${number}`,tipoFactura:'PPD',clienteId:root,companyId:root,iqFolio:`I${number}`,facturaUuid:uuid,status:'PROCESANDO'});
  await db.doc(`pagos/${pagoId}`).set({rootId:root,folio:`PAGO-${number}`,clienteId:root,companyId:root,status:'CONCILIADO',moneda:'MXN'});
  await db.doc(`pagoApplicationIqPlans/${planId}`).set({rootId:root,pagoId,iqExecutionProfileId:profileId,plan:{pagoIqFolio:depositId}});
  await db.doc(`pagoApplicationIqAttempts/${attemptId}`).set({rootId:root,planId,profileId,createdBy:root});
  await db.doc(`pagoAplicaciones/${appId}`).set({rootId:root,folio:`AP${number}`,solicitudId,pagoId,status:'APLICADA',invoiceType:'PPD',montoAplicado:58,
    numeroParcialidad:1,saldoAnterior:116,saldoInsoluto:58,iqApplicationStatus:'IQ_APPLIED',iqActionExecuted:true,iqPlanId:planId,iqExecutionAttemptId:attemptId});
  await reconcilePaymentComplement(appId);
  const id=iqRepRequestId(root,depositId);
  await db.doc(`paymentComplementJobs/${id}`).set({rootId:root,provider:'IQ',applicationId:appId,depositId,profileId,actorUid:root,clientId:root,
    requestIdentity:id,createdAt:stamp.fromDate(at(-10)),...job});
  const requestRef=db.doc(`paymentComplementRequests/${complementRequestId(root,appId)}`);
  await requestRef.update({automationJobId:id,automationStatus:job.status,
    ...(job.status==='UNKNOWN'?{status:'REQUEST_STATE_UNKNOWN',externalRequestSent:null}:{}),
    ...(job.status==='REQUESTED'?{status:'REQUESTED',externalRequestSent:true,requestedAt:job.requestedAt}:{})});
  return {id,depositId,appId,requestRef};
}
const jobData=async id=>(await db.doc(`paymentComplementJobs/${id}`).get()).data();
const opRef=(root,type,key)=>db.doc(`automationSafetyScopes/${scopeId(root,'REP:IQ')}/operations/${safetyHash(JSON.stringify([type,key]))}`);
const scopeRef=root=>db.doc(`automationSafetyScopes/${scopeId(root,'REP:IQ')}`);
// The safety window and backoff use the real clock; tests simulate the time that
// separates two scheduled batches or two days without waiting for it.
const elapseWindow=async root=>{await scopeRef(root).set({windowAt:Date.now()-11*60000,nextAdmissionAt:0},{merge:true});};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// The run scope admits one batch per second; real batches are 15 minutes apart.
const daily=async(now,adapter)=>{await sleep(1200);return api.runProtectedRepDaily(now,adapter);};

function adapterFor(counters,behaviour={}){
  return {
    iqSession:async()=>({accessToken:'emulator-only'}),
    preflightIqComplement:async job=>{counters.preflights.push(job.depositId);if(behaviour.preflight)return behaviour.preflight(job);return 'REQUEST';},
    requestIqComplement:async job=>{counters.posts.push(job.depositId);if(behaviour.request)return behaviour.request(job);return {httpStatus:200};},
    availableIqComplement:async job=>{counters.lookups.push(job.depositId);if(behaviour.lookup)return behaviour.lookup(job);return null;},
    importIqComplement:async()=>{throw Error('UNEXPECTED_IMPORT')},
    observeIqRepAttachment:async()=>{throw Error('UNEXPECTED_B_READ')},
    prepareFacturamaComplement:async()=>{throw Error('UNEXPECTED_FACTURAMA')},emitFacturamaComplement:async()=>{throw Error('UNEXPECTED_FACTURAMA')},
    importFacturamaComplement:async()=>{throw Error('UNEXPECTED_FACTURAMA')},
  };
}
const newCounters=()=>({preflights:[],posts:[],lookups:[]});
const lastSummary=()=>JSON.parse(summaries.at(-1));

function pureContracts(){
  assert.equal(retry.transientComplementFailure(timeoutError()),'REP_PROVIDER_TIMEOUT');
  assert.equal(retry.transientComplementFailure(Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNRESET'}})),'REP_PROVIDER_NETWORK');
  for(const code of ['IQ_REP_PREFLIGHT_HTTP_503','IQ_REP_HTTP_502','IQ_AUTH_HTTP_500','IQ_REP_DEPOSIT_HTTP_429','SAFETY_EXTERNAL_BUDGET','SAFETY_DURATION_BUDGET','IQ_AUTH_TIMEOUT','IQ_REP_DEPOSIT_NOT_RECONCILED'])
    assert.equal(retry.transientComplementFailure(new Error(code)),code,code);
  for(const code of ['IQ_REP_REQUEST_HTTP_401','IQ_REP_HTTP_403','REP_IQ_PERMISSION_REQUIRED','REP_IQ_PROFILE_CHANGED','REP_SOURCE_CHANGED','REP_RECEIPT_DOCUMENT_MISMATCH',
    'SAFETY_EFFECT_ALREADY_ATTEMPTED','IQ_REP_REQUEST_STATE_REQUIRES_REVIEW','REP_OPERATION_FAILED','IQ_REP_DEPOSIT_NOT_FOUND'])
    assert.equal(retry.transientComplementFailure(new Error(code)),null,code);
  // Due-job selection and order.
  const now=at(0),day='2026-11-23';
  const ts=ms=>stamp.fromMillis(ms);
  const rows=[
    {id:'c',job:{status:'REQUESTED',nextCheckAt:ts(now.getTime()-HOUR)}},
    {id:'a',job:{status:'UNKNOWN',nextCheckAt:ts(now.getTime()-3*DAY)}},
    {id:'b',job:{status:'REQUESTED'}},
    {id:'future',job:{status:'REQUESTED',nextCheckAt:ts(now.getTime()+HOUR)}},
    {id:'today',job:{status:'REQUESTED',lastCheckDay:day}},
    {id:'stopped',job:{status:'REQUESTED',bReadState:'EXCEPTION',error:'REP_SOURCE_CHANGED'}},
    {id:'revived',job:{status:'UNKNOWN',bReadState:'EXCEPTION',error:'SAFETY_EXTERNAL_BUDGET',nextCheckAt:ts(now.getTime()-2*DAY)}},
    {id:'paused-future',job:{status:'PAUSED',nextCheckAt:ts(now.getTime()+HOUR)}},
    {id:'paused-ran',job:{status:'PAUSED',lastDailyExecutionDay:day}},
    {id:'paused',job:{status:'PAUSED',nextCheckAt:ts(now.getTime()-DAY)}},
    {id:'blocked-transient',job:{status:'BLOCKED',error:'IQ_REP_DEPOSIT_NOT_RECONCILED'}},
    {id:'blocked-sent',job:{status:'BLOCKED',error:'IQ_REP_DEPOSIT_NOT_RECONCILED',attemptedAt:ts(1)}},
    {id:'blocked-config',job:{status:'BLOCKED',error:'REP_PAYMENT_FORM_REQUIRED'}},
    {id:'review',job:{status:'REVIEW_REQUIRED'}},
  ];
  const due=api.orderDueJobs(rows.map(row=>({...row,action:api.repDailyAction(row.job,now,day)})).filter(row=>row.action));
  assert.deepEqual(due.map(row=>row.id),['b','blocked-transient','a','revived','paused','c'],'oldest next check first; not-due, stopped and terminal jobs skipped');
  assert.deepEqual(due.map(row=>row.action),['LOOKUP','RESUME','LOOKUP','LOOKUP','EXECUTE','LOOKUP']);
  // Summary has codes and counts only.
  const summary=api.buildRepDailySummary([
    {status:'PAUSED',gateReason:'REP_PROVIDER_TIMEOUT',depositId:'330001',folio:'FOLIO-1'},
    {status:'PAUSED',gateReason:'motivo con datos de cliente ACME 1234.56'},
    {status:'BLOCKED',error:'REP_PAYMENT_FORM_REQUIRED',rootId:'secret-root'},
    {status:'UNKNOWN',applicationId:'secret-app'},{status:'REQUESTED',bReadState:'RETRY_PENDING'},
    {status:'REQUESTED',bReadState:'EXCEPTION',error:'REP_SOURCE_CHANGED'},{status:'REVIEW_REQUIRED'},
  ],{processed:3,deferredForBudget:2,deferredForTime:0,notAdmitted:{CAPACITY:1,'secret-app':1},errors:0,followups:{WAITING_B:1}},'2026-11-23','19:15');
  assert.deepEqual(summary.paused,{REP_PROVIDER_TIMEOUT:1,OTHER:1});assert.deepEqual(summary.blocked,{REP_PAYMENT_FORM_REQUIRED:1});
  assert.equal(summary.unknown,1);assert.equal(summary.requestedWaiting,1);assert.equal(summary.lookupRetry,1);assert.equal(summary.exception,1);assert.equal(summary.review,1);
  assert.deepEqual(summary.notAdmitted,{CAPACITY:1,OTHER:1});
  const text=JSON.stringify(summary);
  for(const secret of ['330001','FOLIO-1','ACME','1234.56','secret-root','secret-app'])assert(!text.includes(secret),`summary leaks ${secret}`);
}

async function budgetNeverTripsBreaker(){
  const root=`rep-budget-${Date.now()}`,profileId=await seedRoot(root);
  const seeded=[];
  // 20 due jobs with distinct next checks: oldest first must be processed first.
  for(let n=1;n<=20;n++)seeded.push(await seedJob(root,profileId,n,{status:'REQUESTED',requestedAt:stamp.fromDate(at(-5)),attemptedAt:stamp.fromDate(at(-5)),
    nextCheckAt:stamp.fromDate(new Date(at(0).getTime()-(21-n)*HOUR))}));
  const counters=newCounters(),adapter=adapterFor(counters);
  await daily(at(0),adapter);
  const mine=counters.lookups.filter(id=>seeded.some(row=>row.depositId===id));
  assert.equal(mine.length,retry.REP_DAILY_BATCH_ADMISSIONS,'one batch spends at most the batch budget');
  assert.deepEqual(mine,seeded.slice(0,retry.REP_DAILY_BATCH_ADMISSIONS).map(row=>row.depositId),'oldest next check is looked up first');
  let scope=(await scopeRef(root).get()).data();
  assert(scope.windowAdmissions<=retry.REP_DAILY_BATCH_ADMISSIONS&&scope.windowAdmissions<20,'window stays under the breaker');
  assert.notEqual(scope.circuitState,'OPEN','the volume breaker never opens');assert.notEqual(scope.manualRecovery,true);
  let summary=lastSummary();
  assert.equal(summary.batch,'19:00');assert(summary.deferredForBudget>=4,'jobs beyond the budget are counted');
  // The next batch (19:15) starts in a fresh window and finishes the remainder.
  await elapseWindow(root);
  await daily(at(0,15),adapter);
  const after=counters.lookups.filter(id=>seeded.some(row=>row.depositId===id));
  assert.equal(after.length,20,'the second batch looks up the remaining due jobs');
  assert.equal(new Set(after).size,20,'no job is looked up twice the same day');
  scope=(await scopeRef(root).get()).data();assert.notEqual(scope.circuitState,'OPEN');
  summary=lastSummary();assert.equal(summary.batch,'19:15');
  // A third batch on the same day finds nothing due for this root.
  await elapseWindow(root);
  await daily(at(0,30),adapter);
  assert.equal(counters.lookups.filter(id=>seeded.some(row=>row.depositId===id)).length,20,'nothing is looked up twice in a day');
  assert.equal(counters.posts.length,0);
  for(const row of seeded)await db.doc(`paymentComplementJobs/${row.id}`).update({status:'RECEIVED'});
  return root;
}

async function transientLookupRetriesNextDay(){
  const root=`rep-lookup-${Date.now()}`,profileId=await seedRoot(root);
  const unknown=await seedJob(root,profileId,101,{status:'UNKNOWN',attemptedAt:stamp.fromDate(at(-5))});
  const budget=await seedJob(root,profileId,102,{status:'REQUESTED',requestedAt:stamp.fromDate(at(-5))});
  const legacy=await seedJob(root,profileId,103,{status:'REQUESTED',requestedAt:stamp.fromDate(at(-5)),bReadState:'EXCEPTION',error:'SAFETY_EXTERNAL_BUDGET',nextCheckAt:null});
  const genuine=await seedJob(root,profileId,104,{status:'REQUESTED',requestedAt:stamp.fromDate(at(-5)),bReadState:'EXCEPTION',error:'REP_SOURCE_CHANGED',nextCheckAt:null});
  const counters=newCounters();
  const failing=adapterFor(counters,{lookup:job=>{if(job.depositId===unknown.depositId)throw timeoutError();if(job.depositId===budget.depositId)throw new Error('SAFETY_EXTERNAL_BUDGET');return null;}});
  assert.equal(await api.checkComplementDaily(unknown.id,at(1),failing),'DEFERRED');
  assert.equal(await api.checkComplementDaily(budget.id,at(1),failing),'DEFERRED');
  for(const job of [await jobData(unknown.id),await jobData(budget.id)]){
    assert.notEqual(job.bReadState,'EXCEPTION','a transient failure is not an exception');assert.equal(job.bReadState,'RETRY_PENDING');
    assert(job.nextCheckAt&&job.nextCheckAt.toMillis()>at(1).getTime()&&job.nextCheckAt.toMillis()<=at(2).getTime(),'next check is the next daily review');
  }
  assert.equal((await jobData(unknown.id)).lookupRetryReason,'REP_PROVIDER_TIMEOUT');assert.equal((await jobData(budget.id)).lookupRetryReason,'SAFETY_EXTERNAL_BUDGET');
  assert.equal((await jobData(unknown.id)).status,'UNKNOWN','the uncertain request stays UNKNOWN');
  assert.equal((await unknown.requestRef.get()).data().status,'REQUEST_STATE_UNKNOWN');
  assert.equal(await api.checkComplementDaily(unknown.id,at(1,30),failing),'DEFERRED','not looked up again the same day');
  // The next day both are looked up again; a legacy transient stop is revived, a genuine one stays stopped.
  const ok=adapterFor(counters);
  const before=counters.lookups.length;
  await api.checkComplementDaily(unknown.id,at(2),ok);await api.checkComplementDaily(budget.id,at(2),ok);
  await api.checkComplementDaily(legacy.id,at(2),ok);
  assert.equal(await api.checkComplementDaily(genuine.id,at(2),ok),'QUARANTINED');
  assert.equal(counters.lookups.length-before,3);
  assert.equal((await jobData(unknown.id)).bReadState,'WAITING_B');assert.equal((await jobData(budget.id)).bReadState,'WAITING_B');
  const revived=await jobData(legacy.id);assert.equal(revived.bReadState,'WAITING_B');assert.equal(revived.error,null,'the legacy transient stop is cleared');
  assert.equal((await jobData(genuine.id)).bReadState,'EXCEPTION','a genuine exception keeps its stop');
  assert.equal(counters.posts.length,0,'a lookup never sends a request');
  for(const row of [unknown,budget,legacy,genuine])await db.doc(`paymentComplementJobs/${row.id}`).update({status:'RECEIVED'});
}

async function transientExecutionRetriesAndUnknownNeverResends(){
  const root=`rep-exec-${Date.now()}`,profileId=await seedRoot(root);
  const notReconciled=await seedJob(root,profileId,201,{status:'QUEUED'});
  const lostResponse=await seedJob(root,profileId,202,{status:'QUEUED'});
  const legacyBlocked=await seedJob(root,profileId,203,{status:'BLOCKED',error:'IQ_REP_DEPOSIT_NOT_RECONCILED'});
  const sentBlocked=await seedJob(root,profileId,204,{status:'BLOCKED',error:'IQ_REP_DEPOSIT_NOT_RECONCILED',attemptedAt:stamp.fromDate(at(-3))});
  // The legacy BLOCKED job's safety operation was quarantined by the old code.
  await opRef(root,'REP_EXECUTE',legacyBlocked.id).set({status:'QUARANTINED',attempt:1,externalAttempted:0,operationType:'REP_EXECUTE'});
  const counters=newCounters();
  let reconciled=false;
  const adapter=adapterFor(counters,{
    preflight:job=>{if(job.depositId===notReconciled.depositId&&!reconciled)throw new Error('IQ_REP_DEPOSIT_NOT_RECONCILED');
      if(job.depositId===legacyBlocked.depositId&&!reconciled)throw timeoutError();return 'REQUEST';},
    request:job=>{if(job.depositId===lostResponse.depositId)throw timeoutError();return {httpStatus:200};},
  });
  // Day 1: deposit not reconciled -> PAUSED with a next check, safety op deferred (not quarantined).
  const first=await api.protectedExecuteComplement(notReconciled.id,'SCHEDULER',adapter,{now:at(1),dailyDay:'2026-11-24'});
  assert.equal(first.admitted,true);
  let job=await jobData(notReconciled.id);
  assert.equal(job.status,'PAUSED','a not-reconciled deposit waits instead of a permanent BLOCKED');
  assert.equal(job.gateReason,'IQ_REP_DEPOSIT_NOT_RECONCILED');assert.equal(job.error,null);
  assert(job.nextCheckAt.toMillis()>at(1).getTime()&&job.nextCheckAt.toMillis()<=at(2).getTime());
  assert.equal((await opRef(root,'REP_EXECUTE',notReconciled.id).get()).data().status,'DEFERRED','the safety operation can be admitted again');
  await sleep(1100);
  // Day 1: the request times out after the send started -> UNKNOWN, one POST.
  await api.protectedExecuteComplement(lostResponse.id,'SCHEDULER',adapter,{now:at(1),dailyDay:'2026-11-24'});
  assert.equal((await jobData(lostResponse.id)).status,'UNKNOWN');
  assert.deepEqual(counters.posts,[lostResponse.depositId]);
  // Simulate a day passing for the safety backoff, then run the daily review on day 2.
  await opRef(root,'REP_EXECUTE',notReconciled.id).update({nextRetryAt:0});
  await elapseWindow(root);
  await daily(at(2),adapter);
  // Legacy BLOCKED-by-transient is resumed and executed; its retry still times out before sending.
  job=await jobData(legacyBlocked.id);
  assert.equal(job.status,'PAUSED','legacy transient BLOCKED job is resumed for a retry');assert.equal(job.gateReason,'REP_PROVIDER_TIMEOUT');
  assert(counters.preflights.filter(id=>id===legacyBlocked.depositId).length>=1);
  assert.equal((await jobData(sentBlocked.id)).status,'BLOCKED','a BLOCKED job with an attempted send is never resumed');
  assert.equal((await jobData(notReconciled.id)).status,'PAUSED','still not reconciled on day 2');
  assert.equal(counters.preflights.filter(id=>id===notReconciled.depositId).length,2,'retried on the next daily review');
  assert.equal(counters.lookups.filter(id=>id===lostResponse.depositId).length,1,'UNKNOWN keeps being looked up');
  assert.deepEqual(counters.posts,[lostResponse.depositId],'UNKNOWN is never resent');
  const day2=lastSummary();
  assert.equal(day2.event,'REP_DAILY_SUMMARY');
  // Day 3: IQ reconciled the deposit -> the paused job is requested once.
  reconciled=true;
  for(const row of [notReconciled,legacyBlocked])await opRef(root,'REP_EXECUTE',row.id).update({nextRetryAt:0});
  await elapseWindow(root);
  await daily(at(3),adapter);
  assert.equal((await jobData(notReconciled.id)).status,'REQUESTED');
  assert.equal((await jobData(legacyBlocked.id)).status,'REQUESTED');
  assert.equal(counters.posts.filter(id=>id===notReconciled.depositId).length,1);
  assert.equal(counters.posts.filter(id=>id===lostResponse.depositId).length,1,'UNKNOWN is still never resent');
  assert.equal(counters.lookups.filter(id=>id===lostResponse.depositId).length,2);
  assert.equal(counters.posts.filter(id=>id===sentBlocked.depositId).length,0);
  // Day 4: a requeue of the UNKNOWN job cannot bypass the attempted send either.
  await db.doc(`paymentComplementJobs/${lostResponse.id}`).update({status:'QUEUED'});
  await api.executeComplement(lostResponse.id,adapter,{now:at(4)});
  assert.equal(counters.posts.filter(id=>id===lostResponse.depositId).length,1);
  return root;
}

async function summariesCarryNoIdentifiers(roots){
  assert(summaries.length>=5,'every daily run logs one summary');
  const forbidden=[...roots,'FOLIO-','PAGO-','-app','-s1','330','resilience'];
  for(const line of summaries){
    const parsed=JSON.parse(line);
    assert.equal(parsed.event,'REP_DAILY_SUMMARY');
    for(const key of ['paused','blocked','requestedWaiting','unknown','review','exception','processed','deferredForBudget'])assert(key in parsed,`summary has ${key}`);
    const values=JSON.stringify(parsed).replace(/"day":"\d{4}-\d{2}-\d{2}"/,'').replace(/"batch":"\d{2}:\d{2}"/,'');
    for(const secret of forbidden)assert(!values.includes(secret),`summary leaks ${secret}`);
    assert(!/[a-f0-9]{32,}/.test(values),'summary contains no document hashes');
  }
}

async function run(){
  pureContracts();
  const budgetRoot=await budgetNeverTripsBreaker();
  await transientLookupRetriesNextDay();
  const execRoot=await transientExecutionRetriesAndUnknownNeverResends();
  await summariesCarryNoIdentifiers([budgetRoot,execRoot]);
  originalLog(JSON.stringify({ok:true,checks:['transient lookup retried next day, not EXCEPTION','legacy transient EXCEPTION revived, genuine kept',
    'not-reconciled and timeout before send pause with next check','legacy transient BLOCKED resumed only without a send','UNKNOWN never resent but looked up',
    'batch budget never trips the breaker','remaining due jobs finish in the next batch','oldest next check first','summary has no identifiers'],externalNetworkCalls:0}));
}
run().then(()=>{clearTimeout(watchdog);process.exit(0)}).catch(error=>{clearTimeout(watchdog);console.error(error);process.exit(1)});
