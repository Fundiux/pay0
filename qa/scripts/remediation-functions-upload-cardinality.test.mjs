import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {installVerifiedUpload} from '../../scripts/lib/functions-upload-verified-stream.mjs';
const root=path.resolve(import.meta.dirname,'../..'),cli=process.env.PAY0_FIREBASE_TOOLS_ROOT||path.join(process.env.APPDATA,'npm/node_modules/firebase-tools');
assert.equal(JSON.parse(fs.readFileSync(path.join(cli,'package.json'))).version,'15.3.1');
const oldXdg=process.env.XDG_CONFIG_HOME;process.env.XDG_CONFIG_HOME=path.join(root,'.firebase/upload-cardinality/config-'+randomUUID());fs.mkdirSync(process.env.XDG_CONFIG_HOME,{recursive:true});process.on('exit',()=>{if(oldXdg===undefined)delete process.env.XDG_CONFIG_HOME;else process.env.XDG_CONFIG_HOME=oldXdg;});
const require=createRequire(path.join(cli,'package.json')),deploy=require('./lib/deploy/functions/deploy'),v2=require('./lib/gcp/cloudfunctionsv2'),storage=require('./lib/gcp/storage'),iam=require('./lib/deploy/functions/checkIam'),backendApi=require('./lib/deploy/functions/backend'),prepare=require('./lib/deploy/functions/prepare'),helper=require('./lib/deploy/functions/functionsDeployHelper');
const digest=b=>createHash('sha256').update(b).digest('hex');
const ids=n=>['notes',...Array.from({length:n-1},(_,i)=>'synthetic'+i)];
async function fixture(action,options={}){
 const dir=path.join(root,'.firebase/upload-cardinality',randomUUID()),source=path.join(dir,'functions'),temp=path.join(dir,'tmp');fs.mkdirSync(source,{recursive:true});fs.mkdirSync(temp);
 const bytes=Buffer.from('synthetic archive; ZIP matching covered by historical suite'),file=path.join(temp,'source.zip');fs.writeFileSync(file,bytes);
 const saved=[deploy,v2,storage,iam].map(owner=>[owner,Object.getOwnPropertyDescriptors(owner)]),network=[];
 for(const [owner,key]of [[require('node:net').Socket.prototype,'connect'],[require('node:http'),'request'],[require('node:https'),'request'],[globalThis,'fetch']]){network.push([owner,key,owner[key]]);owner[key]=()=>{throw Error('NETWORK_FORBIDDEN');};}
 const logger=require('./lib/logger').logger,silent=logger.silent;logger.silent=true;
 let uploads=0,body=null;const list=options.ids||ids(options.count||347);
 try{
  iam.checkHttpIam=async()=>{};
  v2.generateUploadUrl=async()=>({uploadUrl:'https://storage.googleapis.com/synthetic/source?GoogleAccessId=x&Expires=1&Signature=x',storageSource:{bucket:'synthetic',object:'source'}});
  storage.upload=async value=>{uploads++;const chunks=[];for await(const chunk of value.stream)chunks.push(chunk);body=Buffer.concat(chunks);return{generation:'7'};};
  const packer={prepareFunctionsUpload:async()=>({pathToSource:file})};
  const config={packer,deploy,storage,v2,sourceRoot:source,privateTemp:temp,project:'demo-upload',region:'us-central1',endpoint:'notes',approvedEndpointIds:list,approvedUploadHost:'storage.googleapis.com',ignore:['node_modules','.git'],verifyBytes:async b=>({exactFileSet:true,archiveSha256:digest(b),archiveFiles:1}),...options.guard};
  if(Object.hasOwn(options,'expected'))config.expectedEndpointCount=options.expected;
  const install=()=>installVerifiedUpload(config);
  const makeBackend=()=>{const backend=backendApi.of(...ids(options.count||347).map(id=>({id,project:'demo-upload',region:'us-central1',platform:'gcfv2',codebase:'default',callableTrigger:{}})));const filters=helper.getEndpointFilters({only:'functions:notes'},[{codebase:'default',source:'functions'}]);prepare.updateEndpointTargetedStatus({default:backend},filters);return{backend,filters};};
  const {backend,filters}=makeBackend();
  await action({install,list,backend,filters,pack:()=>packer.prepareFunctionsUpload(dir,source,{ignore:config.ignore},[]),send:(packed,chosen=filters,want=backend)=>deploy.deploy({projectId:'demo-upload',filters:chosen,config:[{codebase:'default',source:'functions'}],sources:{default:{functionsSourceV2:packed.pathToSource}}},{projectNumber:'123',nonInteractive:true},{functions:{default:{wantBackend:want,haveBackend:backendApi.empty()}}}),counts:()=>({uploads,body}),bytes});
 }finally{for(const [owner,props]of saved)Object.defineProperties(owner,props);for(const [owner,key,value]of network)owner[key]=value;logger.silent=silent;}
}
for(const count of [347,348])test('real CLI singleton upload count '+count,()=>fixture(async f=>{const guard=f.install();await f.send(await f.pack());assert.equal(f.counts().uploads,1);assert.deepEqual(f.counts().body,f.bytes);assert.equal(guard.receipt().uploadedGeneration,'7');},{count,...(count===348?{expected:348}:{})}));
test('348 does not infer approval from array length',()=>fixture(async f=>assert.throws(f.install,/MANIFEST_ENDPOINTS_PIN/),{count:348}));
for(const expected of [null,0,-1,1.5,'348',true,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])test('invalid count '+String(expected),()=>fixture(async f=>assert.throws(f.install,/MANIFEST_ENDPOINT_COUNT/),{expected}));
for(const [label,make]of [['duplicate',()=>{const a=ids(347);a[2]=a[1];return a;}],['sparse',()=>{const a=ids(347);delete a[2];return a;}],['extra',()=>Object.assign(ids(347),{extra:true})],['symbol',()=>Object.assign(ids(347),{[Symbol()]:true})],['missing selected',()=>ids(347).map(x=>x==='notes'?'other':x)],['null prototype',()=>Object.setPrototypeOf(ids(347),null)]])test('closed array '+label,()=>fixture(async f=>assert.throws(f.install,/MANIFEST_ENDPOINTS_PIN/),{ids:make()}));
test('array getter rejected without invocation',async()=>{let reads=0;const a=ids(347);Object.defineProperty(a,'2',{get(){reads++;return'synthetic1';}});await fixture(async f=>assert.throws(f.install,/MANIFEST_ENDPOINTS_PIN/),{ids:a});assert.equal(reads,0);});
for(const bad of ['', ' leading','trailing ','x,y','x:y','x/y','x\n','x\t',false,{},'1name'])test('invalid endpoint ID '+JSON.stringify(bad),()=>fixture(async f=>assert.throws(f.install,/MANIFEST_ENDPOINTS_PIN/),{ids:ids(347).map((v,i)=>i===2?bad:v)}));
test('selected endpoint rejects filter delimiter',()=>fixture(async f=>assert.throws(f.install,/MANIFEST_SELECTED_ENDPOINT/),{guard:{endpoint:'notes,other'}}));
test('approved array mutation cannot redirect pinned set',()=>fixture(async f=>{f.install();f.list[1]='replacement';f.list.push('extra');await f.send(await f.pack());assert.equal(f.counts().uploads,1);}));
for(const [label,mutate]of [['set',b=>b.endpoints['us-central1'].synthetic0.id='replacement'],['missing',b=>delete b.endpoints['us-central1'].synthetic0],['extra target',b=>b.endpoints['us-central1'].synthetic0.targetedByOnly=true],['missing target',b=>b.endpoints['us-central1'].notes.targetedByOnly=false],['region',b=>b.endpoints['us-central1'].notes.region='other'],['platform',b=>b.endpoints['us-central1'].notes.platform='gcfv1']])test('backend drift '+label,()=>fixture(async f=>{f.install();const b=structuredClone(f.backend);mutate(b);await assert.rejects(f.send(await f.pack(),f.filters,b),/UPLOAD_/);assert.equal(f.counts().uploads,0);}));
for(const filters of [[{codebase:'default'}],[{codebase:'default',idChunks:['other']}],[{codebase:'default',idChunks:['notes']},{codebase:'default',idChunks:['synthetic0']}]])test('exact singleton filters '+JSON.stringify(filters),()=>fixture(async f=>{f.install();await assert.rejects(f.send(await f.pack(),filters),/UPLOAD_FILTERS/);assert.equal(f.counts().uploads,0);}));
