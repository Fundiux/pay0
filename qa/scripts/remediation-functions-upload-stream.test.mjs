import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {installVerifiedUpload} from '../../scripts/lib/functions-upload-verified-stream.mjs';
import {verifyArchiveBytes} from './verify-functions-upload-artifact.mjs';
import {cliRoot} from './helpers/functions-upload-contract.mjs';
const root=path.resolve(import.meta.dirname,'../..'), require=createRequire(path.join(cliRoot(),'package.json'));
const oldXdg=process.env.XDG_CONFIG_HOME;
process.env.XDG_CONFIG_HOME=path.join(root,'.firebase/verified-upload-tests/config-'+randomUUID());
fs.mkdirSync(process.env.XDG_CONFIG_HOME,{recursive:true});
process.on('exit',()=>{if(oldXdg===undefined)delete process.env.XDG_CONFIG_HOME;else process.env.XDG_CONFIG_HOME=oldXdg;});
const packer=require('./lib/deploy/functions/prepareFunctionsUpload'),deploy=require('./lib/deploy/functions/deploy'),storage=require('./lib/gcp/storage'),v2=require('./lib/gcp/cloudfunctionsv2');
const JSZip=createRequire(path.join(root,'functions/package.json'))('jszip');
const hash=b=>createHash('sha256').update(b).digest('hex');
const backendApi=require('./lib/deploy/functions/backend'),prepare=require('./lib/deploy/functions/prepare'),helper=require('./lib/deploy/functions/functionsDeployHelper');
const checkIam=require('./lib/deploy/functions/checkIam');
const ids=['notes',...Array.from({length:346},(_,i)=>'synthetic'+i)];
const backend=backendApi.of(...ids.map(id=>({id,project:'demo-upload',region:'us-central1',platform:'gcfv2',codebase:'default',callableTrigger:{}})));
const filters=helper.getEndpointFilters({only:'functions:notes'},[{codebase:'default',source:'functions'}]);
prepare.updateEndpointTargetedStatus({default:backend},filters);
const signed='https://storage.googleapis.com/synthetic/source?GoogleAccessId=synthetic&Expires=9999999999&Signature=synthetic';
async function fixture(action,{omitGeneration=false,conflictGeneration=false,generationPlaceholder,url=signed}={}){
 const dir=path.join(root,'.firebase/verified-upload-tests',randomUUID()),source=path.join(dir,'functions'),temp=path.join(dir,'tmp');fs.mkdirSync(source,{recursive:true});fs.mkdirSync(temp);
 fs.writeFileSync(path.join(source,'package.json'),'{}');
 const expected=[{file:'package.json',sha256:hash('{}')}];
 const saved=[packer,deploy,storage,v2,checkIam].map(owner=>[owner,Object.getOwnPropertyDescriptors(owner)]);
 const env={};for(const key of ['TMPDIR','TEMP','TMP']){env[key]=process.env[key];process.env[key]=temp;}
 const logger=require('./lib/logger').logger,oldSilent=logger.silent;logger.silent=true;
 const network=[];for(const [owner,key] of [[require('node:net').Socket.prototype,'connect'],[require('node:http'),'request'],[require('node:https'),'request'],[globalThis,'fetch']]){network.push([owner,key,owner[key]]);owner[key]=()=>{throw Error('NETWORK_FORBIDDEN');};}
 let uploads=0,body=null,fail=false;
 try{
  checkIam.checkHttpIam=async()=>{};
  v2.generateUploadUrl=async()=>({uploadUrl:url,storageSource:{bucket:'synthetic',object:'source.zip',...(omitGeneration?{}:{generation:generationPlaceholder??(conflictGeneration?'2':'1')})}});
  storage.upload=async source=>{uploads++;const chunks=[];for await(const chunk of source.stream)chunks.push(chunk);body=Buffer.concat(chunks);if(fail)throw Error('UNCERTAIN');return{generation:'1'};};
  const guard=installVerifiedUpload({packer,deploy,storage,v2,sourceRoot:source,privateTemp:temp,project:'demo-upload',region:'us-central1',endpoint:'notes',approvedEndpointIds:ids,approvedUploadHost:'storage.googleapis.com',ignore:['node_modules','.git'],verifyBytes:bytes=>verifyArchiveBytes({bytes,expected,JSZip})});
  const pack=()=>packer.prepareFunctionsUpload(dir,source,{ignore:['node_modules','.git']},[]);
  const send=packed=>deploy.uploadSourceV2('demo-upload','123',{functionsSourceV2:packed.pathToSource},backend);
  const sendFull=(packed,selectedFilters=filters,want=backend)=>deploy.deploy({projectId:'demo-upload',filters:selectedFilters,config:[{codebase:'default',source:'functions'}],sources:{default:{functionsSourceV2:packed.pathToSource}}},{projectNumber:'123'},{functions:{default:{wantBackend:want,haveBackend:backendApi.empty()}}});
  await action({pack,send,sendFull,guard,source,expected,setFail:()=>{fail=true;},counts:()=>({uploads,body})});
 }finally{
  for(const [owner,props]of saved)Object.defineProperties(owner,props);
  for(const [owner,key,value]of network)owner[key]=value;
  logger.silent=oldSilent;for(const [key,value]of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
}
test('real CLI pack and uploadSourceV2 send exactly verified bytes and bind receipt',async()=>fixture(async f=>{
 const packed=await f.pack(), bytes=fs.readFileSync(packed.pathToSource);const source=await f.send(packed);
 assert.deepEqual(source,f.guard.receipt().storageSource);assert.equal(f.counts().uploads,1);assert.deepEqual(f.counts().body,bytes);assert.equal(f.guard.receipt().archiveSha256,hash(bytes));
 await assert.rejects(f.send(packed),/STREAM_ORDER_OR_REPLAY/);
}));
test('disk mutation before stream is rejected before PUT',async()=>fixture(async f=>{
 const packed=await f.pack();fs.appendFileSync(packed.pathToSource,'changed');await assert.rejects(f.send(packed),/ZIP_DRIFT/);assert.equal(f.counts().uploads,0);
}));
test('disk mutation after stream cannot replace the verified body',async()=>fixture(async f=>{
 const packed=await f.pack(),original=fs.readFileSync(packed.pathToSource),stream=deploy.createReadStream(packed.pathToSource);
 fs.writeFileSync(packed.pathToSource,'changed');const dest=await v2.generateUploadUrl('demo-upload','us-central1');
 await storage.upload({file:packed.pathToSource,stream},dest.uploadUrl,undefined,true);assert.deepEqual(f.counts().body,original);
}));
test('alternate stream route is rejected, not uploaded',async()=>fixture(async f=>{
 const packed=await f.pack();deploy.createReadStream(packed.pathToSource);const dest=await v2.generateUploadUrl('demo-upload','us-central1');
 await assert.rejects(storage.upload({file:packed.pathToSource,stream:Readable.from('evil')},dest.uploadUrl,undefined,true),/UPLOAD_STREAM/);assert.equal(f.counts().uploads,0);
}));
test('uncertain upload cannot dispatch twice',async()=>fixture(async f=>{
 const packed=await f.pack();f.setFail();await assert.rejects(f.send(packed),/UNCERTAIN/);await assert.rejects(f.send(packed),/STREAM_ORDER_OR_REPLAY/);assert.equal(f.counts().uploads,1);assert.throws(()=>f.guard.receipt(),/UPLOAD_INCOMPLETE/);
}));
test('unexpected source entry fails exact shared verifier before PUT',async()=>fixture(async f=>{
 fs.writeFileSync(path.join(f.source,'rogue.js'),'synthetic');await assert.rejects(f.pack(),/ZIP_FILESET_MISMATCH/);assert.equal(f.counts().uploads,0);
}));
test('duplicate expected names are rejected by shared byte verifier',async()=>{
 const zip=new JSZip();zip.file('a','x');const bytes=await zip.generateAsync({type:'nodebuffer'});
 await assert.rejects(verifyArchiveBytes({bytes,expected:[{file:'a',sha256:hash('x')},{file:'a',sha256:hash('x')}],JSZip}),/ZIP_FILESET_MISMATCH/);
});
test('other endpoint and alternate upload entry are blocked',async()=>fixture(async f=>{
 const packed=await f.pack(),other=structuredClone(backend);other.endpoints['us-central1'].notes.id='other';
 await assert.rejects(deploy.uploadSourceV2('demo-upload','123',{functionsSourceV2:packed.pathToSource},other),/UPLOAD_MANIFEST_IDS/);
 assert.throws(()=>storage.uploadObject({},'synthetic','application/zip'),/UPLOAD_SCOPE_BLOCKED/);assert.equal(f.counts().uploads,0);
}));
test('upload without prepared verified stream is blocked',async()=>fixture(async f=>{
 await assert.rejects(storage.upload({file:'synthetic',stream:Readable.from('bad')},'https://synthetic.invalid/source',undefined,true),/UPLOAD_ORDER_OR_REPLAY/);assert.equal(f.counts().uploads,0);
}));
test('real CLI storage.upload forwards the supplied verified stream as PUT body',async()=>{
 const Client=require('./lib/apiv2').Client,request=Client.prototype.request;let seen;
 const bytes=Buffer.from('synthetic zip body'),stream=Readable.from(bytes);
 try{
  Client.prototype.request=async function(options){seen=options;const chunks=[];for await(const chunk of options.body)chunks.push(chunk);assert.deepEqual(Buffer.concat(chunks),bytes);return{response:{headers:new Map([['x-goog-generation','7']])}};};
  assert.deepEqual(await storage.upload({file:'not-read-from-disk',stream},'https://synthetic.invalid/source?GoogleAccessId=synthetic',undefined,true),{generation:'7'});
  assert.equal(seen.method,'PUT');assert.equal(seen.body,stream);assert.equal(seen.headers['content-type'],'application/zip');assert.equal(seen.ignoreQuotaProject,true);
 }finally{Client.prototype.request=request;}
});

test('real deploy.deploy uploads full347 with actual prepare targeting and generation pinned after PUT',async()=>fixture(async f=>{
 const packed=await f.pack();await f.sendFull(packed);assert.equal(f.counts().uploads,1);
 assert.equal(f.guard.receipt().uploadedGeneration,'1');assert.equal(f.guard.receipt().storageSource.generation,'1');
},{omitGeneration:true}));
test('real uploadSourceV2 returns generation injected into the same GCF source object',async()=>fixture(async f=>{
 const result=await f.send(await f.pack());assert.equal(result.generation,'1');assert.deepEqual(result,f.guard.receipt().storageSource);
},{omitGeneration:true}));
test('conflicting generation fails without a successful receipt',async()=>fixture(async f=>{
 await assert.rejects(f.send(await f.pack()),/GENERATION_MISMATCH/);assert.equal(f.counts().uploads,1);assert.throws(()=>f.guard.receipt(),/UPLOAD_INCOMPLETE/);
},{conflictGeneration:true}));
test('unapproved upload destination fails before PUT',async()=>fixture(async f=>{
 await assert.rejects(f.send(await f.pack()),/UPLOAD_URL_HOST/);assert.equal(f.counts().uploads,0);
},{url:'https://synthetic.invalid/source?GoogleAccessId=a&Expires=1&Signature=b'}));

test('full backend filters and targeted flags cannot authorize another endpoint',async()=>fixture(async f=>{
 const packed=await f.pack();await assert.rejects(f.sendFull(packed,[{codebase:'default'}]),/UPLOAD_FILTERS/);
 const changed=structuredClone(backend);changed.endpoints['us-central1'].synthetic0.targetedByOnly=true;
 await assert.rejects(f.sendFull(packed,filters,changed),/UPLOAD_TARGETING/);assert.equal(f.counts().uploads,0);
}));

test('documented zero generation placeholders are replaced by immutable PUT generation',async()=>{
 for(const generationPlaceholder of [0,'0'])await fixture(async f=>{const result=await f.send(await f.pack());assert.equal(result.generation,'1');assert.equal(f.guard.receipt().uploadedGeneration,'1');},{generationPlaceholder});
});
