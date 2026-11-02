// Synthetic demo only: exact pinned AST dispatch helper, real Firestore transactions; no provider module.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const PROJECT='demo-pay0-iq-dispatch',HOST='127.0.0.1:18261';
test('dispatch fence SDK',{skip:process.env.PAY0_IQ_DISPATCH_REAL_SDK!=='1',timeout:90000},async()=>{
 const watchdog=setTimeout(()=>{process.stderr.write(JSON.stringify({status:'IQ_DISPATCH_DEMO_WATCHDOG',cleanup:'UNKNOWN',exitCode:124})+'\n');process.exit(124);},120000);
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,HOST);
 for(const k of ['GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','FIREBASE_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN','NODE_OPTIONS'])assert.ok(!process.env[k]);
 for(const k of ['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT','GCP_PROJECT','GOOGLE_CLOUD_QUOTA_PROJECT','FIREBASE_PROJECT_ID'])if(process.env[k])assert.equal(process.env[k],PROJECT);
 if(process.env.FIREBASE_CONFIG)assert.equal(JSON.parse(process.env.FIREBASE_CONFIG).projectId,PROJECT);
 const file='functions/src/modules/paymentApplications/callables.ts',source=fs.readFileSync(file,'utf8');
 assert.equal(crypto.createHash('sha256').update(source).digest('hex'),'3cd2b600865c2924bfe0307a584923f370f499a5efdde0d5ac57e2ce949d5564','SOURCE_PIN_MISMATCH');
 const ts=require('typescript');assert.equal(ts.version,'5.9.3');
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true),names=['cleanDispatchText','cleanDispatchUpper','writePaymentApplicationIqDispatch'];
 const nodes=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text));assert.equal(nodes.length,names.length);
 const extracted=nodes.map(n=>n.getText(ast)).join('\n');const code=ts.transpileModule(extracted+'\nexports.write=writePaymentApplicationIqDispatch;',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const net=require('node:net'),dns=require('node:dns'),tls=require('node:tls'),h2=require('node:http2');const connect=net.Socket.prototype.connect,lookup=dns.lookup,tlsConnect=tls.connect,h2Connect=h2.connect,fetch=global.fetch;
 net.Socket.prototype.connect=function(...args){const o=Array.isArray(args[0])?args[0][0]:args[0];assert.ok(o&&typeof o==='object'&&o.path==null);assert.equal(o.host,'127.0.0.1');assert.equal(Number(o.port),18261);return connect.apply(this,args);};
 dns.lookup=function(host,...args){assert.equal(host,'127.0.0.1');return lookup.call(this,host,...args);};tls.connect=()=>{throw Error('TLS_FORBIDDEN');};h2.connect=function(authority,...args){assert.equal(String(authority),'http://'+HOST);return h2Connect.call(this,authority,...args);};global.fetch=async()=>{throw Error('FETCH_FORBIDDEN');};

 const req=require('node:module').createRequire(path.resolve('functions/package.json')),admin=req('firebase-admin');
 assert.equal(req('@google-cloud/firestore/package.json').version,'7.11.6');
 const app=admin.initializeApp({projectId:PROJECT}),db=admin.firestore(app),prefix='pf'+crypto.randomUUID().replace(/-/g,'');
 const root=prefix+'r',uid=prefix+'u',id=prefix+'p',ref=db.doc('pagoApplicationIqPlans/'+id),owned=new Set([ref.path]),known=new Map(),checks=[];
 let retry=false,mutation=null,stage='SEED',cleanupVerified=false,callbackCount=0;
 const exact=r=>{assert.ok(owned.has(r.path),'EXACT_REF_REQUIRED');return r;};
 async function patch(value){const w=await ref.update(value,{lastUpdateTime:known.get(ref.path)});known.set(ref.path,w.writeTime);}
 const facade={collection:n=>({doc:i=>exact(db.doc(n+'/'+i))}),runTransaction:async fn=>{let attempt=0;return db.runTransaction(async tx=>{attempt++;callbackCount++;if(retry&&attempt===2)await mutation();const result=await fn({get:r=>tx.get(exact(r)),set:(r,d,o)=>tx.set(exact(r),d,o)});if(retry&&attempt===1)throw Object.assign(new Error('INJECTED_ABORTED'),{code:10});return result;},{maxAttempts:3});}};
 const out={};new Function('exports','db',code)(out,facade);
 const identity={planId:id,generation:'g1',planHash:'a'.repeat(64),requester:uid,rootId:root};
 const write=(phase,delta,result)=>out.write({...identity,phase,patch:delta,result});
 async function unchanged(){const s=await ref.get();assert.ok(s.updateTime.isEqual(known.get(ref.path)));}
 try{
  const seeded=await ref.create({syntheticOwner:prefix,rootId:root,planHash:identity.planHash,iqExecutionDispatchGeneration:'g1',iqExecutionDispatchRequestedBy:uid,iqExecutionDispatchStatus:'QUEUED',iqExecutionStatus:'NOT_EXECUTED'});known.set(ref.path,seeded.writeTime);
  stage='START_RETRY';retry=true;mutation=()=>patch({iqExecutionDispatchGeneration:'g2'});const before=callbackCount;assert.equal(await write('START',{iqExecutionDispatchStatus:'RUNNING'}),false);assert.equal(callbackCount,before+2);await unchanged();assert.equal((await ref.get()).get('iqExecutionDispatchStatus'),'QUEUED');checks.push('INJECTED_ABORTED_START_FRESH_GENERATION_ZERO_WRITES');
  stage='RESULT';retry=false;await patch({iqExecutionDispatchGeneration:'g1',iqExecutionDispatchStatus:'RUNNING',status:'IQ_APPLIED',iqExecutionStatus:'SUCCEEDED',iqExecutionAttemptId:'a1',iqExecutionMessage:'canonical'});
  assert.equal(await write('RESULT',{iqExecutionDispatchStatus:'COMPLETED',iqExecutionDispatchMessage:'stale'},{status:'IQ_APPLIED',iqExecutionStatus:'SUCCEEDED',attemptId:'a1'}),true);
  const committed=await ref.get();assert.equal(committed.get('syntheticOwner'),prefix);assert.equal(committed.get('rootId'),root);assert.equal(committed.get('iqExecutionDispatchGeneration'),'g1');assert.equal(committed.get('iqExecutionDispatchStatus'),'COMPLETED');assert.equal(committed.get('iqExecutionDispatchMessage'),'canonical');known.set(ref.path,committed.updateTime);checks.push('CURRENT_RESULT_COMMITS_CANONICAL_MESSAGE');
  stage='LATE_ACK';assert.equal(await write('ENQUEUE',{iqExecutionDispatchStatus:'QUEUED'}),false);await unchanged();assert.equal(await write('ENQUEUE',{iqExecutionDispatchStatus:'ENQUEUE_ERROR'}),false);await unchanged();checks.push('LATE_ACK_ERROR_PRESERVE_COMPLETED');
 }finally{
  try{if(known.has(ref.path))await ref.delete({lastUpdateTime:known.get(ref.path)});assert.equal((await ref.get()).exists,false);cleanupVerified=true;}
  finally{await db.terminate();await app.delete();clearTimeout(watchdog);net.Socket.prototype.connect=connect;dns.lookup=lookup;tls.connect=tlsConnect;h2.connect=h2Connect;global.fetch=fetch;console.log(JSON.stringify({status:'IQ_DISPATCH_DEMO_CLEANUP',stage,cleanupVerified,trackedRefs:owned.size,cloudCalls:0}));}
 }
 console.log(JSON.stringify({status:'IQ_DISPATCH_DEMO_SDK_PASS',checks,cleanup:'EXACT_REFS_ABSENT',cloudCalls:0,emulatorOnly:true,injectedAborted:true,sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),callbackSha256:crypto.createHash('sha256').update(extracted).digest('hex')}));
});
