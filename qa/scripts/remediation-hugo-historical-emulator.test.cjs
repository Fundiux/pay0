const assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
if(process.env.GCLOUD_PROJECT!=='demo-pay0'||!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('DEMO_LOOPBACK_REQUIRED');
// Existing smoke scripts have the same demo guard and block external fetch.
for(const file of ['qa/scripts/hugo-phase4-emulator-smoke.cjs','qa/scripts/hugo-phase5-emulator-smoke.cjs']){const child=spawnSync(process.execPath,[file],{stdio:'inherit',env:process.env,timeout:180000,windowsHide:true});assert.equal(child.status,0,'Existing Hugo phase gate failed');}
global.fetch=async()=>{throw Error('EXTERNAL_NETWORK_FORBIDDEN');};
const admin=require('../../functions/node_modules/firebase-admin');admin.initializeApp({projectId:'demo-pay0'});const db=admin.firestore();
const {FirestoreHugoDataStore}=require('../../functions/lib/modules/agent007/firestoreHugoDataStore');
const {FirestoreHugoLearningStore}=require('../../functions/lib/modules/agent007/firestoreHugoLearningStore');
const {createHash}=require('node:crypto');
const prefix='history-'+Date.now();let checks=0;
async function fixture(label){const root=prefix+'-'+label,sourceO=root+'-o',sourceZ=root+'-z',o='activity_'+sourceO,z='activity_'+sourceZ,d=root+'-d',entity=root+'-case',now=Date.now(),stamp=n=>admin.firestore.Timestamp.fromMillis(now+n);
 const initial={rootId:root,source:'ACTIVITY_LOG',sourceActivityId:sourceO,sourceEvent:'SOLICITUD_CREADA',caseType:'SOLICITUD',caseId:entity,createdAt:stamp(-4000)};
 const outcome={...initial,sourceActivityId:sourceZ,sourceEvent:'SOLICITUD_COMPLETADA',createdAt:stamp(-1000)};
 const log=(event,time)=>({rootId:root,event,type:event,eventType:event,sourceSystem:'PAY0',referenceType:'solicitud',referenceId:entity,createdAt:stamp(time)});
 const batch=db.batch();for(const[path,data]of [[`agent007Observations/${o}`,initial],[`agent007Observations/${z}`,outcome],[`agent007Memory/${d}`,{rootId:root,kind:'DECISION',status:'CONFIRMED',entityReference:{sourceSystem:'PAY0',entityType:'SOLICITUD',entityId:entity},links:{observationId:o},decision:{decisionAt:stamp(-3000).toDate().toISOString(),decisionType:'APPROVED',actorUid:root}}],[`pay0ActivityLog/${sourceO}`,log(initial.sourceEvent,-4000)],[`pay0ActivityLog/${sourceZ}`,log(outcome.sourceEvent,-2000)]])batch.set(db.doc(path),data);await batch.commit();return{root,o,z,d,sourceO,sourceZ,initial,outcome};}
const promote=(store,f)=>store.linkVerifiedExperience(f.root,f.o,f.d,f.z);
const memoryId=f=>'experience_'+createHash('sha256').update(JSON.stringify([f.root,f.o,f.d,f.z])).digest('hex').slice(0,36);
async function main(){
 const f=await fixture('all'),store=new FirestoreHugoDataStore(db),learning=new FirestoreHugoLearningStore(db);
 const before=await Promise.all([db.doc('agent007Observations/'+f.o).get(),db.doc('agent007Observations/'+f.z).get()]);
 const memory=await promote(store,f);assert.equal(memory.created,true);checks++;
 const input={rootId:f.root,domain:'SOLICITUDES',taskType:'REASON',intent:'EXPLAIN_DELAY',questionClass:'REVIEW',features:{entityType:'SOLICITUD'},actorUid:f.root};
 assert.equal((await learning.createFromVerifiedMemory({...input,memoryId:memory.id})).record.state,'VERIFIED');checks++;
 const draft=await learning.createDraftFromDecision({...input,decisionId:f.d});assert.equal(draft.record.state,'WAITING_FOR_OUTCOME');checks++;
 assert.equal((await learning.linkOutcome(f.root,draft.id,f.z,f.root)).state,'VERIFIED');checks++;
 for(let i=0;i<2;i++){const after=await before[i].ref.get();assert.deepEqual(after.data(),before[i].data());checks++;}
 for(const mode of ['changed','deleted','duplicate']){
  const c=await fixture(mode);let attempts=0,pendingWrite=null;const perAttempt=[];
  const wrapped={collection:name=>db.collection(name),runTransaction:fn=>db.runTransaction(async tx=>{
   attempts++;if(pendingWrite)await pendingWrite;let sourceReads=0;
   const txView={get:ref=>{if(/^(pay0ActivityLog|assetsActivityLog|tttActivityLog|hugoActivityLog|activityLog)\//.test(ref.path))sourceReads++;return tx.get(ref);},create:(ref,data)=>tx.create(ref,data),set:(ref,data)=>tx.set(ref,data)};
   let result;try{result=await fn(txView);}finally{perAttempt.push(sourceReads);}
   if(attempts===1){const ref=db.doc('pay0ActivityLog/'+c.sourceZ);pendingWrite=mode==='changed'?ref.update({rootId:'foreign-root'}):mode==='deleted'?ref.delete():db.doc('assetsActivityLog/'+c.sourceZ).set({rootId:c.root,sourceSystem:'ASSETS'});pendingWrite.catch(()=>{});
    // Deliberately abort attempt1 to release emulator locks, then let the real SDK
    // retry after the external mutation. This is controlled retry, not a natural-race claim.
    const error=Error('CONTROLLED_RETRY');error.code=10;throw error;}
   return result;
  },{maxAttempts:3})};
  await assert.rejects(()=>promote(new FirestoreHugoDataStore(wrapped),c),error=>error.code==='failed-precondition');if(pendingWrite)await pendingWrite;
  assert.equal(attempts,2);assert.ok(perAttempt.every(n=>n<=10));assert.equal((await db.doc('agent007Memory/'+memoryId(c)).get()).exists,false);checks+=3;
 }
 console.log(JSON.stringify({mode:'HUGO_HISTORICAL_EMULATOR',checks,allFourConsumers:true,controlledRealSdkRetries:3,historicalDocumentsUnchanged:true,externalEffects:false}));
}
main().then(()=>process.exit(0)).catch(error=>{console.error({error:'HUGO_HISTORICAL_EMULATOR_FAILED',code:error.code||'ASSERTION',message:error.message});process.exit(1);});
