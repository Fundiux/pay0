import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {Readable} from 'node:stream';
import {createProbeClient,runReadProbe,fixtureName} from '../../services/pay0-sentinel-observation/scripts/producer-read-sdk.mjs';
const dependency=createRequire(new URL('../../functions/package.json',import.meta.url));
const grpc=dependency('@grpc/grpc-js'),gax=dependency('google-gax');
const run='a'.repeat(32),token='SYNTHETIC_TOKEN_NOT_A_CREDENTIAL';
const doc={name:fixtureName(run),fields:{schema:{integerValue:'1'},synthetic:{booleanValue:true},probeTag:{stringValue:run}}};
// No network permitted, including accidental ADC metadata calls.
for(const protocol of ['node:http','node:https']){const module=dependency(protocol);module.request=module.get=()=>{throw Error('NETWORK_FORBIDDEN');};}
global.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
function fixture(){const h=createProbeClient(token),seen=[];let errorCode=null,rows=[{document:doc}],hanging=false,lastStream=null,canceled=0;
 h.client.auth.getClient=async()=>{throw Error('ADC_FORBIDDEN');};h.client.auth.getApplicationDefault=async()=>{throw Error('ADC_FORBIDDEN');};
 const original=h.client._gaxGrpc.createStub.bind(h.client._gaxGrpc);
 class Stub{constructor(address,creds,opts){seen.push({address,creds,opts});return new Proxy(this,{get:(target,key)=>{if(key==='then')return undefined;if(key==='close')return()=>{};return(req,metadata,callOptions,callback)=>{
  seen.push({key,req,metadata,callOptions});if(key==='runQuery'){const stream=hanging?new Readable({objectMode:true,read(){}}):Readable.from(errorCode?[]:rows,{objectMode:true});lastStream=stream;stream.cancel=()=>{canceled++;stream.destroy();};stream.on('end',()=>stream.emit('status',{code:0}));if(errorCode)queueMicrotask(()=>stream.destroy(Object.assign(Error('PRIVATE_RESPONSE'),{code:errorCode})));return stream;}
  queueMicrotask(()=>callback(errorCode?Object.assign(Error('PRIVATE_RESPONSE'),{code:errorCode}):null,doc));return{cancel(){}};
 };}});}}
 h.client._gaxGrpc.createStub=(_ctor,opts,custom)=>original(Stub,opts,custom);
 return{h,seen,setError:n=>errorCode=n,setRows:r=>rows=r,hang:()=>hanging=true,get canceled(){return canceled;},get lastStream(){return lastStream;}};}
test('real SDK/GAX carries TLS credentials, endpoint, size limits and retry controls without ADC',async()=>{const f=fixture();try{assert.equal(await runReadProbe(f.h,run,'get'),'ALLOWED_EXACT_FIXTURE');const actual=f.seen[0];assert.equal(actual.address,'firestore.googleapis.com:443');assert.equal(actual.opts['grpc.max_receive_message_length'],262144);assert.equal(actual.opts['grpc.max_send_message_length'],262144);assert.equal(actual.opts['grpc.enable_retries'],0);assert.equal(actual.creds,f.h.client._opts.sslCreds);assert.equal(actual.creds._isSecure(),true);const credentials=actual.creds.callCredentials;const headers=await credentials.generateMetadata({service_url:'https://firestore.googleapis.com'});assert.deepEqual(headers.get('authorization'),['Bearer '+token]);assert.equal(f.seen[1].key,'getDocument');assert.ok(f.seen[1].callOptions.deadline instanceof Date);assert.ok(f.seen[1].callOptions.deadline.getTime()<=Date.now()+20000);assert.equal(f.seen.length,2);}finally{await f.h.close();}});
test('real SDK query encodes exact fixture and returns bounded result',async()=>{const f=fixture();try{assert.equal(await runReadProbe(f.h,run,'query'),'ALLOWED_EXACT_FIXTURE');assert.equal(f.seen[1].req.structuredQuery.limit.value,2);assert.equal(f.seen[1].req.structuredQuery.where.fieldFilter.value.stringValue,run);}finally{await f.h.close();}});
for(const [code,expected]of [[7,'DENIED'],[5,'NOT_FOUND_INCONCLUSIVE']])test(`SDK status ${code} preserves denial distinction with one request`,async()=>{const f=fixture();f.setError(code);try{assert.equal(await runReadProbe(f.h,run,'get'),expected);assert.equal(f.seen.length,2);}finally{await f.h.close();}});
test('closed credential cannot emit bearer and invalid fixture is rejected',async()=>{const f=fixture();await f.h.client.initialize();const creds=f.seen[0].creds.callCredentials;await f.h.close();await assert.rejects(creds.generateMetadata({service_url:'https://firestore.googleapis.com'}));assert.throws(()=>fixtureName('../real'));assert.throws(()=>createProbeClient('bad'));});

for(const [code,expected]of [[7,'DENIED'],[5,'NOT_FOUND_INCONCLUSIVE']])test(`SDK query status ${code} preserves distinction without retry`,async()=>{const f=fixture();f.setError(code);try{assert.equal(await runReadProbe(f.h,run,'query'),expected);assert.equal(f.seen.length,2);assert.equal(f.lastStream.destroyed,true);}finally{await f.h.close();}});
for(const rows of [[{document:doc},{document:doc}],[{document:{...doc,name:doc.name+'foreign'}}],[{document:{...doc,fields:{...doc.fields,secret:{stringValue:'PRIVATE'}}}}]])test('query rejects extra or malformed document and cancels',async()=>{const f=fixture();f.setRows(rows);try{await assert.rejects(runReadProbe(f.h,run,'query'),{message:'SDK_PROBE_REFUSED'});assert.equal(f.lastStream.destroyed,true);}finally{await f.h.close();}});
test('query cancellation honors remaining budget instead of starting fresh 20s window',async()=>{const f=fixture();f.hang();try{await assert.rejects(runReadProbe(f.h,run,'query',25),{message:'SDK_PROBE_REFUSED'});assert.ok(f.canceled>0);assert.equal(f.lastStream.destroyed,true);}finally{await f.h.close();}});
for(const kind of ['get','query'])test(`transient SDK ${kind} error has one attempt and no error payload output`,async()=>{const f=fixture();f.setError(14);try{await assert.rejects(runReadProbe(f.h,run,kind),{message:'SDK_PROBE_REFUSED'});assert.equal(f.seen.length,2);}finally{await f.h.close();}});

for(const code of [7,5])test(`query data followed by status ${code} cannot certify denial`,async()=>{
 let canceled=false;
 const stream=new Readable({objectMode:true,read(){this.push({document:doc});this._read=()=>{};queueMicrotask(()=>this.destroy(Object.assign(Error('PRIVATE_LATE_ERROR'),{code})));}});
 stream.cancel=()=>{canceled=true;stream.destroy();};
 const handle={client:{runQuery:()=>stream}};
 await assert.rejects(runReadProbe(handle,run,'query'),{message:'SDK_PROBE_REFUSED'});
 assert.equal(canceled,true);
});
