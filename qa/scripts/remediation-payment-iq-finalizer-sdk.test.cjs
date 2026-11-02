// Synthetic demo only: exact pinned AST finalizer, real Firestore transactions; no provider module.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const PROJECT='demo-pay0-iq-finalizer',HOST='127.0.0.1:18260';
test('canonical finalizer SDK',{skip:process.env.PAY0_IQ_FINALIZER_REAL_SDK!=='1',timeout:90000},async()=>{
 const watchdog=setTimeout(()=>{process.stderr.write(JSON.stringify({status:'IQ_FINALIZER_DEMO_WATCHDOG',cleanup:'UNKNOWN',exitCode:124})+'\n');process.exit(124);},120000);
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,HOST);
 for(const k of ['GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','FIREBASE_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN','NODE_OPTIONS'])assert.ok(!process.env[k]);
 for(const k of ['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT','GCP_PROJECT','GOOGLE_CLOUD_QUOTA_PROJECT','FIREBASE_PROJECT_ID'])if(process.env[k])assert.equal(process.env[k],PROJECT);
 if(process.env.FIREBASE_CONFIG)assert.equal(JSON.parse(process.env.FIREBASE_CONFIG).projectId,PROJECT);
 const file='functions/src/modules/paymentApplications/iqExecution.ts',source=fs.readFileSync(file,'utf8');
 assert.equal(crypto.createHash('sha256').update(source).digest('hex'),'c0bae64f8e313c82f4c34ebf6fc8ac51b21b8c47ef4c422a371b4df8524e0fd0','SOURCE_PIN_MISMATCH');
 const ts=require('typescript');assert.equal(ts.version,'5.9.3');
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true),names=['cleanText','cleanUpper','asRecord','executionResultFromPlan','compactBrowserResult','finalizeExecution'];
 const nodes=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text));assert.equal(nodes.length,names.length);
 const extracted=nodes.map(n=>n.getText(ast)).join('\n');const code=ts.transpileModule(extracted+'\nexports.finalize=finalizeExecution;',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const net=require('node:net'),dns=require('node:dns'),tls=require('node:tls'),h2=require('node:http2');const connect=net.Socket.prototype.connect,lookup=dns.lookup,tlsConnect=tls.connect,h2Connect=h2.connect,fetch=global.fetch;
 net.Socket.prototype.connect=function(...args){const o=Array.isArray(args[0])?args[0][0]:args[0];assert.ok(o&&typeof o==='object'&&o.path==null);assert.equal(o.host,'127.0.0.1');assert.equal(Number(o.port),18260);return connect.apply(this,args);};
 dns.lookup=function(host,...args){assert.equal(host,'127.0.0.1');return lookup.call(this,host,...args);};tls.connect=()=>{throw Error('TLS_FORBIDDEN');};h2.connect=function(authority,...args){assert.equal(String(authority),'http://'+HOST);return h2Connect.call(this,authority,...args);};global.fetch=async()=>{throw Error('FETCH_FORBIDDEN');};

 const req=require('node:module').createRequire(path.resolve('functions/package.json')),admin=req('firebase-admin');
 assert.equal(req('@google-cloud/firestore/package.json').version,'7.11.6');
 const app=admin.initializeApp({projectId:PROJECT}),db=admin.firestore(app),prefix='pf'+crypto.randomUUID().replace(/-/g,'');
 const root=prefix+'r',attempt=prefix+'t',id=prefix+'x';
 const paths={plan:'pagoApplicationIqPlans/'+id,attempt:'pagoApplicationIqAttempts/'+attempt,reservation:'pagoApplicationReservations/'+id,pago:'pagos/'+id,item:'pagoApplicationIqPlanItems/'+id,lock:'pagoApplicationIqLocks/'+id,application:'pagoAplicaciones/'+id,solicitud:'solicitudes/'+id};
 const owned=new Set(Object.values(paths)),known=new Map(),checks=[];assert.equal(owned.size,8);
 let retry=false,mutation=null,winning=[],stage='SEED',cleanupVerified=false,callbackCount=0;
 const exact=r=>{assert.ok(owned.has(r.path),'EXACT_REF_REQUIRED');return r;};
 async function capture(){for(const p of owned){const s=await db.doc(p).get();assert.ok(s.exists);assert.equal(s.get('syntheticOwner'),prefix);assert.equal(s.get('rootId'),root);known.set(p,s.updateTime);}}
 async function patch(p,value){exact(db.doc(p));const w=await db.doc(p).update(value,{lastUpdateTime:known.get(p)});known.set(p,w.writeTime);}
 const facade={collection:n=>({doc:i=>exact(db.doc(n+'/'+i))}),runTransaction:async fn=>{let attemptCount=0;const result=await db.runTransaction(async tx=>{attemptCount++;callbackCount++;if(retry&&attemptCount===2)await mutation();const writes=[];const result=await fn({get:r=>tx.get(exact(r)),set:(r,d,o)=>{exact(r);writes.push(r.path);return tx.set(r,d,o);}});if(retry&&attemptCount===1)throw Object.assign(new Error('INJECTED_ABORTED'),{code:10});winning=writes;return result;},{maxAttempts:3});return result;}};
 const out={};new Function('exports','db','HttpsError','FieldValue',code)(out,facade,req('firebase-functions/v2/https').HttpsError,admin.firestore.FieldValue);
 const claimed={planId:id,planHash:'synthetic-hash',reservationId:id,pagoId:id,attemptId:attempt,attemptNumber:1,items:[{planItemId:id,applicationId:id,solicitudId:id,lockId:id,amount:20,requiresComplement:true,requiresSameMonthSettlement:false,pueSettlementStatus:'NOT_APPLICABLE'}]};
 const response=(patch={})=>({authenticated:true,routeAccessible:true,formOpened:true,depositMatched:'456',verified:true,finalPath:'',responseStatus:200,responseMessage:'',outcome:'SUCCEEDED',status:'SYNTHETIC',message:'synthetic',iqApplicationId:'12345',submitClicked:true,confirmationClicked:true,iqActionExecuted:true,itemResults:[],errors:[],fieldChecks:[],...patch});
 const finalize=r=>out.finalize({actor:{uid:prefix+'u',rootId:root,role:'superadmin'},claimed,browserResult:r});
 const unchanged=async()=>{for(const[p,t]of known)assert.ok((await db.doc(p).get()).updateTime.isEqual(t));};
 try{
  const batch=db.batch();for(const p of owned)batch.create(db.doc(p),{syntheticOwner:prefix,rootId:root,iqExecutionAttemptId:attempt,...(p===paths.plan?{status:'PREVALIDATED',iqExecutionStatus:'IN_PROGRESS',planHash:'synthetic-hash',reservationId:id,actualIqAttemptCount:1,plan:{preserve:'canonical'}}:{}),...(p===paths.pago?{montoTotal:100}:{}),...(p===paths.solicitud?{totalAbonado:20}:{})});const writes=await batch.commit();[...owned].forEach((p,i)=>known.set(p,writes[i].writeTime));
  stage='COMMIT';const first=await finalize(response());await capture();assert.equal(first.reused,false);assert.equal(first.iqApplicationId,'12345');assert.equal(first.iqExecutionStatus,'SUCCEEDED');assert.equal(winning.length,8);assert.equal((await db.doc(paths.plan).get()).get('iqApplicationId'),first.iqApplicationId);checks.push('COMMIT_RETURNS_COMMITTED_RESULT');
  stage='REUSE';for(const incoming of [response({outcome:'UNKNOWN',iqApplicationId:''}),response({iqApplicationId:'99999'})]){const r=await finalize(incoming);assert.equal(r.reused,true);assert.equal(r.status,'IQ_APPLIED');assert.equal(r.iqExecutionStatus,'SUCCEEDED');assert.equal(r.iqApplicationId,'12345');assert.equal(winning.length,0);await unchanged();}checks.push('DIVERGENT_INPUT_RETURNS_CANONICAL_REUSE');
  stage='RETRY';await patch(paths.plan,{status:'PREVALIDATED',iqExecutionStatus:'IN_PROGRESS'});retry=true;mutation=()=>patch(paths.plan,{status:'IQ_APPLIED',iqExecutionStatus:'SUCCEEDED',iqApplicationId:'54321',iqExecutionMessage:'contender'});const before=callbackCount;const retried=await finalize(response({outcome:'UNKNOWN',iqApplicationId:''}));assert.equal(callbackCount,before+2);assert.equal(retried.reused,true);assert.equal(retried.iqApplicationId,'54321');assert.equal(retried.message,'contender');assert.equal(winning.length,0);await unchanged();checks.push('INJECTED_ABORTED_CONTENDER_SUCCESS_RETURNS_CURRENT');
  stage='INCONSISTENT';retry=false;await patch(paths.plan,{status:'PREVALIDATED'});await assert.rejects(finalize(response()),e=>e.code==='failed-precondition');await unchanged();assert.equal((await db.doc(paths.pago).get()).get('montoTotal'),100);assert.equal((await db.doc(paths.solicitud).get()).get('totalAbonado'),20);checks.push('INCONSISTENT_TERMINAL_REJECTS_ZERO_WRITES');
 }finally{
  try{const cleanup=db.batch();for(const[p,t]of known)cleanup.delete(db.doc(p),{lastUpdateTime:t});await cleanup.commit();assert.ok((await db.getAll(...[...owned].map(p=>db.doc(p)))).every(s=>!s.exists));cleanupVerified=true;}
  finally{await db.terminate();await app.delete();clearTimeout(watchdog);net.Socket.prototype.connect=connect;dns.lookup=lookup;tls.connect=tlsConnect;h2.connect=h2Connect;global.fetch=fetch;console.log(JSON.stringify({status:'IQ_FINALIZER_DEMO_CLEANUP',stage,cleanupVerified,trackedRefs:owned.size,cloudCalls:0}));}
 }
 console.log(JSON.stringify({status:'IQ_FINALIZER_DEMO_SDK_PASS',checks,cleanup:'EXACT_REFS_ABSENT',cloudCalls:0,emulatorOnly:true,injectedAborted:true,sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),callbackSha256:crypto.createHash('sha256').update(extracted).digest('hex')}));
});
