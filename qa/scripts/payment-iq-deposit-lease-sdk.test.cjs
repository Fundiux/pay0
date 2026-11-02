// Hash-pinned real lock adapter, synthetic exact-reference Firestore demo; no provider or Storage calls.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const PROJECT='demo-pay0-iq-lease',HOST='127.0.0.1:18264';
test('deposit lease release SDK',{skip:process.env.PAY0_IQ_LEASE_REAL_SDK!=='1',timeout:90000},async()=>{
 const watchdog=setTimeout(()=>{process.stderr.write(JSON.stringify({status:'IQ_LEASE_DEMO_WATCHDOG',cleanup:'UNKNOWN',exitCode:124})+'\n');process.exit(124);},120000);
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,HOST);
 for(const k of ['GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','FIREBASE_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN','NODE_OPTIONS'])assert.ok(!process.env[k]);
 for(const k of ['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT','GCP_PROJECT','GOOGLE_CLOUD_QUOTA_PROJECT','FIREBASE_PROJECT_ID'])if(process.env[k])assert.equal(process.env[k],PROJECT);
 if(process.env.FIREBASE_CONFIG)assert.equal(JSON.parse(process.env.FIREBASE_CONFIG).projectId,PROJECT);
 const net=require('node:net'),dns=require('node:dns'),tls=require('node:tls'),h2=require('node:http2');const connect=net.Socket.prototype.connect,lookup=dns.lookup,tlsConnect=tls.connect,h2Connect=h2.connect,fetch=global.fetch;
 net.Socket.prototype.connect=function(...args){const o=Array.isArray(args[0])?args[0][0]:args[0];assert.ok(o&&typeof o==='object'&&o.path==null);assert.equal(o.host,'127.0.0.1');assert.equal(Number(o.port),18264);return connect.apply(this,args);};
 dns.lookup=function(host,...args){assert.equal(host,'127.0.0.1');return lookup.call(this,host,...args);};tls.connect=()=>{throw Error('TLS_FORBIDDEN');};h2.connect=function(authority,...args){assert.equal(String(authority),'http://'+HOST);return h2Connect.call(this,authority,...args);};global.fetch=async()=>{throw Error('FETCH_FORBIDDEN');};

 const req=require('node:module').createRequire(path.resolve('functions/package.json')),admin=req('firebase-admin');
 assert.equal(req('@google-cloud/firestore/package.json').version,'7.11.6');
 const app=admin.initializeApp({projectId:PROJECT}),db=admin.firestore(app),prefix='pf'+crypto.randomUUID().replace(/-/g,'');
 const file='functions/src/modules/iq/depositHttpCreateFirebaseAdapters.ts',source=fs.readFileSync(file,'utf8');
 assert.equal(crypto.createHash('sha256').update(source).digest('hex'),'cf5aac9d5c191b71cf2d8e4552e9bdde58220c6eafc7b9f9eec345e34bd9a68c','SOURCE_PIN_MISMATCH');
 const ts=require('typescript');assert.equal(ts.version,'5.9.3');const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const root=prefix+'r',id=prefix+'p',ref=db.doc('pagos/'+id),known=new Map(),checks=[];
 let retry=false,mutation=null,stage='SEED',cleanupVerified=false,callbackCount=0;
 const exact=r=>{assert.equal(r.path,ref.path,'EXACT_REF_REQUIRED');return r;};
 async function patch(data){const w=await ref.update(data,{lastUpdateTime:known.get(ref.path)});known.set(ref.path,w.writeTime);}
 const facade={collection:n=>{assert.equal(n,'pagos');return{doc:i=>exact(db.doc(n+'/'+i))};},runTransaction:fn=>{let attempt=0;return db.runTransaction(async tx=>{attempt++;callbackCount++;if(retry&&attempt===2)await mutation();const result=await fn({get:r=>tx.get(exact(r)),set:(r,d,o)=>tx.set(exact(r),d,o)});if(retry&&attempt===1)throw Object.assign(Error('INJECTED_ABORTED'),{code:10});return result;},{maxAttempts:3});}};
 const out={};new Function('exports','require',code)(out,n=>{if(n==='node:crypto')return require(n);if(n==='firebase-admin')return{firestore:()=>facade};if(n==='firebase-admin/firestore')return req(n);throw Error('UNEXPECTED_DEPENDENCY');});
 const adapter=out.createPagoAttemptLockAdapter({pagoId:id,actorUid:prefix+'u',source:'SYNTHETIC',fingerprint:'fixture'});
 async function capture(expected){const s=await ref.get();assert.equal(s.get('syntheticOwner'),prefix);assert.equal(s.get('rootId'),root);for(const[k,v]of Object.entries(expected))assert.deepEqual(s.get(k),v);known.set(ref.path,s.updateTime);return s;}
 async function acquire(attempt){const lease=await adapter.acquire({pay0PagoId:id,iqAttemptId:attempt,leaseMs:120000});const snap=await capture({iqDepositCreationStatus:'PROCESSING_HTTP',iqDepositCreationRetryBlocked:true});assert.equal(snap.get('iqDepositCreationLeaseExpiresAt').toMillis(),Date.parse(lease.leaseExpiresAtIso));return lease;}
 async function unchanged(){assert.ok((await ref.get()).updateTime.isEqual(known.get(ref.path)));}
 async function reset(){await patch({iqDepositCreationStatus:'ERROR_RETRYABLE',iqDepositCreationRetryBlocked:false,iqDepositCreationLeaseExpiresAt:admin.firestore.FieldValue.delete()});}
 try{
  const seeded=await ref.create({syntheticOwner:prefix,rootId:root,status:'CONCILIACION_PENDIENTE'});known.set(ref.path,seeded.writeTime);
  stage='SAME_TERMINAL';const a=await acquire('a');await patch({iqDepositCreationStatus:'CREATED_RECOVERED',iqDepositCreationRetryBlocked:false});await adapter.release(a);await capture({iqDepositCreationLeaseExpiresAt:undefined,iqDepositCreationRetryBlocked:false,iqDepositCreationLockKey:a.lockKey});checks.push('SAME_OWNER_TERMINAL_RELEASE');
  stage='SAME_UNKNOWN';await reset();const unknown=await acquire('unknown');await patch({iqDepositCreationStatus:'OUTCOME_UNKNOWN'});await adapter.release(unknown);await capture({iqDepositCreationLeaseExpiresAt:undefined,iqDepositCreationRetryBlocked:true});checks.push('SAME_OWNER_UNKNOWN_RETRY_BLOCK_PRESERVED');
  stage='STALE_OWNER';await reset();const stale=await acquire('stale');await patch({iqDepositCreationExecutionToken:'synthetic-owner-b',iqDepositCreationLeaseExpiresAt:admin.firestore.Timestamp.fromMillis(Date.now()+240000),iqDepositCreationRetryBlocked:true});await adapter.release(stale);await unchanged();checks.push('STALE_OWNER_ZERO_RELEASE_WRITES');
  stage='RETRY_OWNER';await reset();const retryLease=await acquire('retry');retry=true;mutation=()=>patch({iqDepositCreationExecutionToken:'synthetic-owner-c',iqDepositCreationLeaseExpiresAt:admin.firestore.Timestamp.fromMillis(Date.now()+240000),iqDepositCreationRetryBlocked:true});const before=callbackCount;await adapter.release(retryLease);assert.equal(callbackCount,before+2);await unchanged();assert.equal((await ref.get()).get('iqDepositCreationRetryBlocked'),true);checks.push('INJECTED_ABORTED_FRESH_OWNER_ZERO_RELEASE_COMMITS');
 }finally{
  try{if(known.has(ref.path))await ref.delete({lastUpdateTime:known.get(ref.path)});assert.equal((await ref.get()).exists,false);cleanupVerified=true;}
  finally{await db.terminate();await app.delete();clearTimeout(watchdog);net.Socket.prototype.connect=connect;dns.lookup=lookup;tls.connect=tlsConnect;h2.connect=h2Connect;global.fetch=fetch;console.log(JSON.stringify({status:'IQ_LEASE_DEMO_CLEANUP',stage,cleanupVerified,trackedRefs:1,cloudCalls:0}));}
 }
 console.log(JSON.stringify({status:'IQ_LEASE_DEMO_SDK_PASS',checks,cleanup:'EXACT_REFS_ABSENT',cloudCalls:0,emulatorOnly:true,injectedAborted:true,sourceSha256:crypto.createHash('sha256').update(source).digest('hex')}));
});
