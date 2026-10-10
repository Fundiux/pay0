'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const ts=require('../../functions/node_modules/typescript');const modules=new Map();
function load(name){if(modules.has(name))return modules.get(name);const mod={exports:{}};const source=fs.readFileSync(`functions/src/modules/securityObservation/${name}.ts`,'utf8');vm.runInThisContext(`(function(require,module,exports){${ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText}\n})`)(id=>id==='node:crypto'?crypto:id.startsWith('./')?load(id.slice(2)):(()=>{throw Error('UNEXPECTED_IMPORT');})(),mod,mod.exports);modules.set(name,mod.exports);return mod.exports;}
const {createObservationMetadataCredential}=load('metadataCredential');
const base='http://metadata.google.internal/computeMetadata/v1/',emailPath='instance/service-accounts/default/email',projectPath='project/project-id',tokenPath='instance/service-accounts/default/token';
const email='pay0-listusers-observer@pay-0-system.iam.gserviceaccount.com',token='SYNTHETIC_NOT_A_CREDENTIAL_123456789';
const goodToken=()=>({access_token:token,token_type:'Bearer',expires_in:3599});
const headers={'metadata-flavor':'Google'};
const reply=(path,value)=>new Response(value===undefined?(path===emailPath?email:path===projectPath?'pay-0-system':JSON.stringify(goodToken())):value,{headers:{...headers,'content-type':path===tokenPath?'application/json':'text/plain'}});
const fake=(override=()=>undefined,calls=[])=>async(url,opts)=>{assert(url.startsWith(base));const path=url.slice(base.length);assert([emailPath,projectPath,tokenPath].includes(path));assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');assert.equal(opts.headers['Metadata-Flavor'],'Google');assert(opts.signal instanceof AbortSignal);calls.push({path,signal:opts.signal});return await override(path,opts)??reply(path);};
const config=(fetchImpl,extra={})=>({expectedServiceAccount:email,expectedProjectId:'pay-0-system',fetchImpl,...extra});
const parent=()=>new AbortController();const tick=()=>new Promise(resolve=>setImmediate(resolve));let checks=0;
async function reject(fn){await assert.rejects(fn,{message:'OBSERVATION_CREDENTIAL_FAILED'});checks++;}
(async()=>{
  const calls=[];const port=createObservationMetadataCredential(config(fake(undefined,calls)));assert.equal(calls.length,0);checks++;
  const result=await port(parent().signal);assert.deepEqual(result,{accessToken:token,serviceAccount:email,projectId:'pay-0-system'});assert.deepEqual(calls.map(c=>c.path),[emailPath,projectPath,tokenPath]);assert(calls.every(c=>c.signal===calls[0].signal));assert.equal(calls[0].signal.aborted,true);checks+=4;
  for(const [path,value]of[[emailPath,'751158244178-compute@developer.gserviceaccount.com'],[emailPath,email+'\n'],[projectPath,'wrong-project'],[projectPath,'pay-0-system\n']]){const seen=[];await reject(()=>createObservationMetadataCredential(config(fake(p=>p===path?reply(p,value):undefined,seen)))(parent().signal));assert(!seen.some(c=>c.path===tokenPath));checks++;}
  for(const path of[emailPath,projectPath,tokenPath]){
    for(const kind of['status','flavor','large','declared','utf8','redirect'])await reject(()=>createObservationMetadataCredential(config(fake(p=>{
      if(p!==path)return;
      if(kind==='status')return new Response('PRIVATE_ERROR',{status:403,headers});
      if(kind==='flavor')return new Response('PRIVATE',{headers:{'metadata-flavor':'Wrong'}});
      if(kind==='large')return reply(p,'x'.repeat(p===emailPath?257:p===projectPath?129:8193));
      if(kind==='declared')return new Response('x',{headers:{...headers,'content-length':'99999'}});
      if(kind==='utf8')return reply(p,Buffer.from([0xff]));
      const r=reply(p);Object.defineProperty(r,'redirected',{value:true});return r;
    })))(parent().signal));
  }
  for(const change of[r=>r.token_type='bearer',r=>r.access_token='short',r=>r.access_token='x'.repeat(4097),r=>r.expires_in=29,r=>r.expires_in=3601,r=>r.expires_in='3600',r=>r.expires_in=1.5,r=>r.extra='not-allowed',r=>delete r.access_token]){const value=goodToken();change(value);await reject(()=>createObservationMetadataCredential(config(fake(p=>p===tokenPath?reply(p,JSON.stringify(value)):undefined)))(parent().signal));}
  for(const raw of['{}','null','[]','{"access_token":"x","access_token":"y"}',JSON.stringify(goodToken()).replace('"token_type":"Bearer"','"token_type":"Bearer","token_type":"Bearer"'),JSON.stringify(goodToken()).replace('"token_type"','"\\u0074oken_type"'),JSON.stringify(goodToken())+' {}','\uFEFF'+JSON.stringify(goodToken())])await reject(()=>createObservationMetadataCredential(config(fake(p=>p===tokenPath?reply(p,raw):undefined)))(parent().signal));
  for(const ttl of[30,3600]){await createObservationMetadataCredential(config(fake(p=>p===tokenPath?reply(p,JSON.stringify({...goodToken(),expires_in:ttl})):undefined)))(parent().signal);checks++;}
  for(const bad of[{expectedProjectId:'other'},{expectedServiceAccount:'751158244178-compute@developer.gserviceaccount.com'},{expectedServiceAccount:'x@example.invalid'},{timeoutMs:751},{timeoutMs:0}]){assert.throws(()=>createObservationMetadataCredential(config(fake(),bad)));checks++;}
  await reject(()=>port());
  const stopped=parent();stopped.abort();let touched=0;await reject(()=>createObservationMetadataCredential(config(async()=>{touched++;throw Error('MUST_NOT_RUN');}))(stopped.signal));assert.equal(touched,0);checks++;
  // Ignored fetch abort: reject promptly and cancel the late body, never request token.
  const controller=parent();let release,cancelled=0;const later=[];
  const delayed=createObservationMetadataCredential(config(fake(p=>p===emailPath?new Promise(resolve=>{release=resolve;}):undefined,later)));
  const pending=delayed(controller.signal);await tick();controller.abort();await reject(()=>pending);release(new Response(new ReadableStream({cancel(){cancelled++;}}),{headers}));await tick();assert.equal(cancelled,1);assert(!later.some(c=>c.path===tokenPath));checks+=2;
  for(const stalledPath of[emailPath,tokenPath]){let cancelled=0;const c=parent();const stuck=createObservationMetadataCredential(config(fake(p=>p===stalledPath?new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{...headers,'content-type':'application/json'}}):undefined)));const pending=stuck(c.signal);await tick();c.abort();await reject(()=>pending);assert.equal(cancelled,1);checks++;}
  let timeSignal;await reject(()=>createObservationMetadataCredential(config(async(_u,o)=>{timeSignal=o.signal;return new Promise(()=>{});},{timeoutMs:20}))(parent().signal));assert.equal(timeSignal.aborted,true);checks++;
  // Parent deadline from existing KMS signer cancels metadata child, no KMS POST.
  const {createKmsObservationSigner}=load('kmsSigner');const key='projects/demo-observer/locations/us-central1/keyRings/observe/cryptoKeys/listusers/cryptoKeyVersions/1',now=1791500000000;let kmsCalls=0,metadataSignal;
  const cred=createObservationMetadataCredential(config(async(_u,o)=>{metadataSignal=o.signal;return new Promise(()=>{});}));
  const signer=createKmsObservationSigner({keyVersion:key,allowedKeyVersions:[key],expectedServiceAccount:email,audience:'pay0-observation-v1',serviceName:'listusers',revisionName:'listusers-00001-test',roots:['root-a'],actors:['actor-a'],now:()=>now,timeoutMs:20,credential:cred,fetchImpl:async()=>{kmsCalls++;throw Error('MUST_NOT_RUN');}});
  await assert.rejects(()=>signer(['PAY0-SECURITY-SIGNED@1','pay0-observation-v1',key,'pay-0-system','listUsers','listusers','listusers-00001-test','root-a','actor-a','12345678-1234-4123-8123-123456789abc','AUTHORIZATION_DENIED','SERVER_AUTH_DECISION',now,now,now+86400000]),{message:'OBSERVATION_SIGN_FAILED'});assert.equal(metadataSignal.aborted,true);assert.equal(kmsCalls,0);checks+=3;
  console.log(`SENTINEL_METADATA_FAKE_PASS checks=${checks} network=0 metadataReal=0 activation=0`);
})().catch(error=>{console.error(error);process.exitCode=1;});
