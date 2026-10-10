'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const ts=require('../../functions/node_modules/typescript'),cache=new Map();
function load(name){if(cache.has(name))return cache.get(name);const mod={exports:{}};const source=fs.readFileSync('functions/src/modules/securityObservation/'+name+'.ts','utf8');const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInThisContext('(function(require,module,exports){'+compiled+'\n})')(id=>id==='node:crypto'?crypto:id.startsWith('./')?load(id.slice(2)):(()=>{throw Error('UNEXPECTED_IMPORT');})(),mod,mod.exports);cache.set(name,mod.exports);return mod.exports;}
const {createPreparedSignedLoggingWriter,signedLoggingObservationPort}=load('signedLoggingWriter');
const {observationCrc32c}=load('kmsSigner');
const key='projects/demo-observer/locations/us-central1/keyRings/observe/cryptoKeys/listusers/cryptoKeyVersions/1',NOW=1791500000000;
const email='pay0-listusers-observer@pay-0-system.iam.gserviceaccount.com',token='SYNTHETIC_NOT_A_CREDENTIAL_123456789',sig=Buffer.alloc(384,8);
const context={rootId:'root-a',actorUid:'actor-a'},resource={projectId:'pay-0-system',serviceName:'listusers',revisionName:'listusers-00001-test',configurationName:'listusers'};
const kms=()=>new Response(JSON.stringify({name:key,verifiedDigestCrc32c:true,signature:sig.toString('base64'),signatureCrc32c:String(observationCrc32c(sig))}),{headers:{'content-type':'application/json'}});
const logging=()=>new Response('{}',{headers:{'content-type':'application/json'}});
function harness(change={}){
 const calls=[],entries=[];let metadataCount=0;
 const credential=async signal=>{metadataCount++;calls.push({kind:'credential',signal});return{accessToken:token,serviceAccount:email,projectId:'pay-0-system'};};
 const fetchImpl=async(url,opts)=>{assert.equal(opts.redirect,'error');assert.equal(opts.method,'POST');assert.equal(opts.headers.Authorization,'Bearer '+token);if(url==='https://cloudkms.googleapis.com/v1/'+key+':asymmetricSign'){calls.push({kind:'kms',signal:opts.signal,body:JSON.parse(opts.body)});return kms();}
 assert.equal(url,'https://logging.googleapis.com/v2/entries:write');calls.push({kind:'logging',signal:opts.signal});entries.push(JSON.parse(opts.body));return logging();};
 const options={resource:{...resource},audience:'pay0-observation-v1',keyVersion:key,allowedKeyVersions:[key],expectedServiceAccount:email,roots:['root-a'],actors:['actor-a'],now:()=>NOW,credential,fetchImpl,...change};
 return{writer:createPreparedSignedLoggingWriter(options),calls,entries,options,get metadataCount(){return metadataCount;}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));let checks=0;
(async()=>{
 process.env.PAY0_SENTINEL_ENABLED='true';assert.equal(await signedLoggingObservationPort.authorizationDenied(context),'DISABLED');delete process.env.PAY0_SENTINEL_ENABLED;checks++;
 const h=harness();assert.equal(h.calls.length,0);checks++;
 assert.equal(await h.writer.authorizationDenied(context),'ACCEPTED');assert.equal(h.metadataCount,1);assert.deepEqual(h.calls.map(c=>c.kind),['credential','kms','logging']);checks+=3;
 const entry=h.entries[0].entries[0],payload=entry.jsonPayload,t=JSON.parse(Buffer.from(payload.signedBytesB64,'base64').toString('utf8'));
 assert.equal(payload.schemaVersion,'PAY0-SECURITY-SIGNED@1');assert.equal(Object.hasOwn(payload,'event'),false);assert.deepEqual(payload.context,context);assert.equal(t[4],'listUsers');assert.equal(t[9],entry.insertId);assert.match(entry.insertId,/^[a-f0-9-]{36}$/);assert.equal(t[12],NOW);assert.equal(t[13],NOW);assert.equal(t[14],NOW+86400000);assert.equal(entry.logName,'projects/pay-0-system/logs/pay0_security_observation');assert.equal(entry.resource.labels.service_name,resource.serviceName);assert.equal(h.entries[0].partialSuccess,false);checks+=12;
 const digest=crypto.createHash('sha256').update(Buffer.from(payload.signedBytesB64,'base64')).digest();assert.equal(h.calls[1].body.digest.sha256,digest.toString('base64'));assert.equal(h.calls[1].body.digestCrc32c,String(observationCrc32c(digest)));assert(h.calls.every(c=>c.signal.aborted));assert.equal(h.calls[0].signal,h.calls[2].signal);checks+=4;
 await h.writer.authorizationDenied(context);assert.notEqual(h.entries[1].entries[0].insertId,entry.insertId);checks++;
 for(const value of[null,{}, {...context,eventId:'forged'}, {...context,rootId:'other'}, {...context,actorUid:'other'},Object.defineProperty({...context},'rootId',{get(){throw Error('NO_GETTER');}})]){const x=harness();assert.equal(await x.writer.authorizationDenied(value),'INVALID_CONTEXT');assert.equal(x.calls.length,0);checks+=2;}
 // Exact local budgets reserve before credentials, including failures.
 const rate=harness();for(let i=0;i<6;i++)assert.equal(await rate.writer.authorizationDenied(context),'ACCEPTED');assert.equal(await rate.writer.authorizationDenied(context),'RATE_LIMITED');assert.equal(rate.metadataCount,6);checks+=2;
 let clock=NOW;const lifetime=harness({now:()=>clock});for(let i=0;i<20;i++){clock=NOW+Math.floor(i/5)*60000;assert.equal(await lifetime.writer.authorizationDenied(context),'ACCEPTED');}clock+=60000;assert.equal(await lifetime.writer.authorizationDenied(context),'RATE_LIMITED');assert.equal(lifetime.metadataCount,20);checks+=2;
 let release;const busy=harness({credential:signal=>new Promise(resolve=>{release=()=>resolve({accessToken:token,serviceAccount:email,projectId:'pay-0-system'});})});const first=busy.writer.authorizationDenied(context);await tick();assert.equal(await busy.writer.authorizationDenied(context),'RATE_LIMITED');release();assert.equal(await first,'ACCEPTED');checks+=2;
 let tries=0;const failure=harness({credential:async()=>{tries++;throw Error('PRIVATE_TOKEN_PROVIDER');}});for(let i=0;i<6;i++)assert.equal(await failure.writer.authorizationDenied(context),'WRITE_FAILED');assert.equal(await failure.writer.authorizationDenied(context),'RATE_LIMITED');assert.equal(tries,6);checks+=2;
 for(const bad of[()=>new Response('{}',{status:500}),()=>new Response('{"private":"provider"}',{headers:{'content-type':'application/json'}}),()=>new Response(Buffer.from([0xff]),{headers:{'content-type':'application/json'}}),()=>new Response(' '.repeat(1025),{headers:{'content-type':'application/json'}}),()=>new Response('{}',{headers:{'content-type':'text/plain'}}),()=>new Response('{}',{headers:{'content-type':'application/json','content-length':'1025'}})]){
  let sends=0;const x=harness({fetchImpl:async url=>{if(url.startsWith('https://cloudkms.'))return kms();sends++;return bad();}});assert.equal(await x.writer.authorizationDenied(context),'WRITE_FAILED');assert.equal(sends,1);checks+=2;
 }
 for(const emptyResponse of[()=>new Response(null),()=>new Response('')]){const x=harness({fetchImpl:async url=>url.startsWith('https://cloudkms.')?kms():emptyResponse()});assert.equal(await x.writer.authorizationDenied(context),'ACCEPTED');checks++;}
 // One deadline starts before credentials; KMS delay cannot restart the budget.
 let kmsSignal,loggingCount=0;const timed=harness({timeoutMs:30,credential:signal=>new Promise(resolve=>setTimeout(()=>resolve({accessToken:token,serviceAccount:email,projectId:'pay-0-system'}),15)),fetchImpl:async(url,opts)=>{if(url.startsWith('https://cloudkms.')){kmsSignal=opts.signal;return new Promise(resolve=>setTimeout(()=>resolve(kms()),30));}loggingCount++;return logging();}});
 assert.equal(await timed.writer.authorizationDenied(context),'WRITE_FAILED');assert.equal(loggingCount,0);assert(kmsSignal);assert.equal(kmsSignal.aborted,true);checks+=3;
 // Aborting Logging cancels stalled body; ignored abort cannot become late ACCEPTED.
 const p=new AbortController();let cancelled=0;const stalled=harness({fetchImpl:async url=>url.startsWith('https://cloudkms.')?kms():new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-type':'application/json'}})});const pending=stalled.writer.authorizationDenied(context,p.signal);await tick();p.abort();assert.equal(await pending,'WRITE_FAILED');assert.equal(cancelled,1);checks+=2;
 const lateParent=new AbortController();let resolveLogging,lateCancelled=0;const late=harness({fetchImpl:async url=>url.startsWith('https://cloudkms.')?kms():new Promise(resolve=>{resolveLogging=resolve;})});const lateResult=late.writer.authorizationDenied(context,lateParent.signal);await tick();lateParent.abort();assert.equal(await lateResult,'WRITE_FAILED');resolveLogging(new Response(new ReadableStream({cancel(){lateCancelled++;}}),{headers:{'content-type':'application/json'}}));await tick();assert.equal(lateCancelled,1);checks+=2;
 const early=new AbortController();early.abort();const earlyWriter=harness();assert.equal(await earlyWriter.writer.authorizationDenied(context,early.signal),'WRITE_FAILED');assert.equal(earlyWriter.calls.length,0);checks+=2;
 // Complete default metadata adapter path with injected fetch only.
 const urls=[];const full=harness({credential:undefined,fetchImpl:async(url,opts)=>{urls.push(url);if(url.startsWith('http://metadata.google.internal/')){const body=url.endsWith('/email')?email:url.endsWith('/project-id')?'pay-0-system':JSON.stringify({access_token:token,token_type:'Bearer',expires_in:3600});return new Response(body,{headers:{'metadata-flavor':'Google','content-type':'application/json'}});}return url.startsWith('https://cloudkms.')?kms():logging();}});
 assert.equal(await full.writer.authorizationDenied(context),'ACCEPTED');assert.equal(urls.length,5);checks+=2;
 const snapshot=harness();snapshot.options.resource.projectId='other';snapshot.options.roots[0]='other';assert.equal(await snapshot.writer.authorizationDenied(context),'ACCEPTED');checks++;
 for(const options of[{timeoutMs:751},{resource:{...resource,projectId:'other'}},{allowedKeyVersions:[]}]){assert.throws(()=>harness(options));checks++;}
 console.log('SENTINEL_SIGNED_LOGGING_FAKE_PASS checks='+checks+' network=0 realCredentials=0 productionPort=DISABLED');
})().catch(error=>{console.error(error);process.exitCode=1;});
