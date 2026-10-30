'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('../../functions/node_modules/typescript');
const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name);
  const source = fs.readFileSync(`functions/src/modules/securityObservation/${name}.ts`, 'utf8');
  const module = {exports:{}};
  vm.runInThisContext(`(function(require,module,exports){${ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText}\n})`)(id=>id.startsWith('./')?load(id.slice(2)):id==='node:crypto'?crypto:(()=>{throw Error('UNEXPECTED_IMPORT');})(),module,module.exports);
  modules.set(name,module.exports);return module.exports;
}
const {createKmsObservationSigner,observationCrc32c}=load('kmsSigner');
const {canonicalizeSignedTuple}=load('signedContract');
const NOW=1791500000000;
const key='projects/demo-observer/locations/us-central1/keyRings/observe/cryptoKeys/listusers/cryptoKeyVersions/1';
const tuple=()=>['PAY0-SECURITY-SIGNED@1','pay0-observation-v1',key,'pay-0-system','listUsers','listusers','listusers-00001-test','root-a','actor-a','12345678-1234-4123-8123-123456789abc','AUTHORIZATION_DENIED','SERVER_AUTH_DECISION',NOW,NOW,NOW+86400000];
const identity={projectId:'pay-0-system',serviceAccount:'pay0-listusers-observer@pay-0-system.iam.gserviceaccount.com',accessToken:'SYNTHETIC_TOKEN_NOT_A_CREDENTIAL_123456789'};
const signature=Buffer.alloc(384,7);
const good=()=>({name:key,verifiedDigestCrc32c:true,signature:signature.toString('base64'),signatureCrc32c:String(observationCrc32c(signature)),protectionLevel:'SOFTWARE'});
const response=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
let checks=0,requests=0;
function config(overrides={}){return{keyVersion:key,allowedKeyVersions:[key],expectedServiceAccount:identity.serviceAccount,audience:'pay0-observation-v1',serviceName:'listusers',revisionName:'listusers-00001-test',roots:['root-a'],actors:['actor-a'],now:()=>NOW,credential:async()=>({...identity}),fetchImpl:async()=>{requests++;return response(good());},...overrides};}
async function reject(fn){await assert.rejects(fn,{message:'OBSERVATION_SIGN_FAILED'});checks++;}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  assert.equal(observationCrc32c(Buffer.from('123456789')),0xe3069283);assert.equal(observationCrc32c(Buffer.alloc(0)),0);checks+=2;
  let credentialSignal,fetchSignal;
  const signer=createKmsObservationSigner(config({credential:async signal=>{credentialSignal=signal;return {...identity};},fetchImpl:async(url,options)=>{
    requests++;fetchSignal=options.signal;assert.equal(url,'https://cloudkms.googleapis.com/v1/'+key+':asymmetricSign');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');
    const body=JSON.parse(options.body);assert.deepEqual(Object.keys(body).sort(),['digest','digestCrc32c']);
    const digest=crypto.createHash('sha256').update(canonicalizeSignedTuple(tuple())).digest();assert.equal(body.digest.sha256,digest.toString('base64'));assert.equal(body.digestCrc32c,String(observationCrc32c(digest)));checks+=6;
    return response(good());
  }}));
  const result=await signer(tuple());assert.equal(result.signatureB64,signature.toString('base64'));assert.equal(result.signedBytesB64,canonicalizeSignedTuple(tuple()).toString('base64'));assert.equal(fetchSignal,credentialSignal);assert.equal(fetchSignal.aborted,true);checks+=4;
  for(const change of [r=>r.name=key+'0',r=>r.verifiedDigestCrc32c=false,r=>r.signatureCrc32c='0',r=>r.signatureCrc32c=1,r=>r.signatureCrc32c='4294967296',r=>r.signatureCrc32c='01',r=>r.signature='AA==',r=>r.signature+='=',r=>r.algorithm='none',r=>r.verifiedDataCrc32c=true,r=>r.protectionLevel='HSM',r=>r.extra='PRIVATE',r=>delete r.signature]){
    const r=good();change(r);await reject(()=>createKmsObservationSigner(config({fetchImpl:async()=>response(r)}))(tuple()));
  }
  await createKmsObservationSigner(config({fetchImpl:async()=>response({...good(),algorithm:'RSA_SIGN_PSS_3072_SHA256',verifiedDataCrc32c:false})}))(tuple());checks++;
  for(const raw of [JSON.stringify(good()).replace('"verifiedDigestCrc32c":true','"verifiedDigestCrc32c":true,"verifiedDigestCrc32c":true'),JSON.stringify(good()).replace('"name":','"\\u006eame":"wrong","name":'),Buffer.from([0xff]),'{}','[{}]','{"name":null}','{"name":1}',Buffer.alloc(4097,32)]) await reject(()=>createKmsObservationSigner(config({fetchImpl:async()=>new Response(raw,{headers:{'content-type':'application/json'}})}))(tuple()));
  for(const headers of [{'content-type':'text/plain'},{'content-type':'application/json','content-length':'4097'},{'content-type':'application/json','content-length':'x'}]) await reject(()=>createKmsObservationSigner(config({fetchImpl:async()=>new Response(JSON.stringify(good()),{headers})}))(tuple()));
  for(const status of [201,400,401,429,500,504]) await reject(()=>createKmsObservationSigner(config({fetchImpl:async()=>new Response('PRIVATE_PROVIDER_BODY',{status,headers:{'content-type':'application/json'}})}))(tuple()));
  for(const index of [1,2,3,4,5,6,7,8]){const t=tuple();t[index]='outside';let calls=0;await reject(()=>createKmsObservationSigner(config({credential:async()=>{calls++;return identity;}}))(t));assert.equal(calls,0);checks++;}
  for(const value of [Buffer.from('arbitrary'),null,{},['arbitrary']]) await reject(()=>createKmsObservationSigner(config())(value));
  for(const bad of [{projectId:'other'},{serviceAccount:'other@example.invalid'},{accessToken:'bad'}]){let calls=0;await reject(()=>createKmsObservationSigner(config({credential:async()=>({...identity,...bad}),fetchImpl:async()=>{calls++;return response(good());}}))(tuple()));assert.equal(calls,0);checks++;}
  for(const bad of [{timeoutMs:751},{timeoutMs:0},{allowedKeyVersions:[]},{allowedKeyVersions:[key+'0']},{allowedKeyVersions:[key,key]},{roots:['root-a','root-b']}]){assert.throws(()=>createKmsObservationSigner(config(bad)));checks++;}
  await reject(()=>createKmsObservationSigner(config({now:()=>NOW+86400000}))(tuple()));
  await reject(()=>createKmsObservationSigner(config({now:()=>NOW-60001}))(tuple()));
  // Early and mid-credential abort; a late credential cannot begin KMS fetch.
  const early=new AbortController();early.abort();let touched=0;await reject(()=>createKmsObservationSigner(config({credential:async()=>{touched++;return identity;}}))(tuple(),early.signal));assert.equal(touched,0);checks++;
  const parent=new AbortController();let release,seen;const mid=createKmsObservationSigner(config({credential:signal=>{seen=signal;return new Promise(resolve=>{release=resolve;});},fetchImpl:async()=>{touched++;return response(good());}}));
  const pending=mid(tuple(),parent.signal);await tick();parent.abort();await reject(()=>pending);assert.equal(seen.aborted,true);release(identity);await tick();assert.equal(touched,0);checks+=2;
  // Ignoring AbortSignal cannot return late success; returned body is cancelled.
  const parentFetch=new AbortController();let releaseFetch,cancelled=0;const delayed=createKmsObservationSigner(config({fetchImpl:(_u,o)=>{seen=o.signal;return new Promise(resolve=>{releaseFetch=resolve;});}}));
  const pendingFetch=delayed(tuple(),parentFetch.signal);await tick();parentFetch.abort();await reject(()=>pendingFetch);assert.equal(seen.aborted,true);checks++;
  releaseFetch(new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-type':'application/json'}}));await tick();assert.equal(cancelled,1);checks++;
  const parentBody=new AbortController();let bodyCancelled=0;const stalledBody=createKmsObservationSigner(config({fetchImpl:async()=>new Response(new ReadableStream({cancel(){bodyCancelled++;}}),{headers:{'content-type':'application/json'}})}));
  const pendingBody=stalledBody(tuple(),parentBody.signal);await tick();parentBody.abort();await reject(()=>pendingBody);assert.equal(bodyCancelled,1);checks++;
  // Real deadline timer reaches credential port; no Promise.race-only timeout.
  let timedSignal;const timed=createKmsObservationSigner(config({timeoutMs:20,credential:signal=>{timedSignal=signal;return new Promise(()=>{});}}));await reject(()=>timed(tuple()));assert.equal(timedSignal.aborted,true);checks++;
  // Mutable caller tuple/config cannot redirect an in-flight request.
  const cfg=config();const frozen=createKmsObservationSigner(cfg);cfg.keyVersion='outside';cfg.roots[0]='outside';await frozen(tuple());checks++;
  console.log(`SENTINEL_KMS_FAKE_PASS checks=${checks} network=0 realKeys=0 activation=0 requestsCounted=${requests}`);
})().catch(error=>{console.error(error);process.exitCode=1;});
