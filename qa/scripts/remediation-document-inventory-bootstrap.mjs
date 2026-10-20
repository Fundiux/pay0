import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
export const PROJECT='pay-0-system';
const PREFIX=`projects/${PROJECT}/databases/(default)/documents/uploads/`;
const hash=value=>createHash('sha256').update(value).digest('hex');
export function memoryCredential(run=spawnSync,now=Date.now){
 let cached=null,until=0;
 return {async getAccessToken(){
  if(cached&&now()<until)return{access_token:cached,expires_in:60};
  let result;try{result=run(process.platform==='win32'?'gcloud.cmd':'gcloud',['auth','print-access-token','--project',PROJECT,'--quiet'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true,shell:process.platform==='win32',timeout:30000,maxBuffer:8192});}catch{throw Error('AUTH_UNAVAILABLE');}
  if(result.status!==0||result.error)throw Error('AUTH_UNAVAILABLE');
  const token=String(result.stdout||'').trim();if(!/^[A-Za-z0-9._~-]{20,4096}$/.test(token))throw Error('AUTH_UNAVAILABLE');
  cached=token;until=now()+30000;return{access_token:cached,expires_in:60};
 }};
}
function validName(value){return typeof value==='string'&&value.startsWith(PREFIX)&&value.length>PREFIX.length&&!value.slice(PREFIX.length).includes('/');}
export function bootstrapQuery(after=null){if(after)assert.ok(validName(after));return{structuredQuery:{select:{fields:[{fieldPath:'rootId'}]},from:[{collectionId:'uploads'}],orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit:100,...(after?{startAt:{values:[{referenceValue:after}],before:false}}:{})}};}
export async function boundedJson(response){
 if(!response.ok)throw Error('BOOTSTRAP_READ_FAILED');let bytes=0;const chunks=[];
 const reader=response.body.getReader();try{for(;;){const{done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>512*1024){await reader.cancel();throw Error('BOOTSTRAP_RESPONSE_LIMIT');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('BOOTSTRAP_RESPONSE_INVALID');}
}
export async function discoverRoots({credential,fetchImpl=fetch,checkpoint=null}){
 if(checkpoint){assert.equal(checkpoint.version,1);assert.equal(checkpoint.project,PROJECT);assert.equal(checkpoint.collection,'uploads');assert.ok(!checkpoint.cursor||validName(checkpoint.cursor));}
 const body=bootstrapQuery(checkpoint?.cursor||null),token=await credential.getAccessToken();
 let response;try{response=await fetchImpl(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`,{method:'POST',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000),redirect:'error'});}catch{throw Error('BOOTSTRAP_READ_FAILED');}
 const data=await boundedJson(response);assert.ok(Array.isArray(data)&&data.length<=101);
 const docs=data.filter(x=>x.document).map(x=>x.document);assert.ok(docs.length<=100);
 const roots=new Map((checkpoint?.roots||[]).map(x=>[x.rootId,{...x}]));let missing=0,invalid=0,cursor=checkpoint?.cursor||null;
 for(const doc of docs){assert.ok(validName(doc.name));assert.ok(!cursor||doc.name>cursor);cursor=doc.name;const value=doc.fields?.rootId;
  if(!value){missing++;continue;}
  const root=value.stringValue;if(typeof root!=='string'||!root||root.length>180||/[\/\\\x00-\x1f]/.test(root)){invalid++;continue;}
  if(!roots.has(root))roots.set(root,{index:roots.size,hash:hash(root),rootId:root,count:0});roots.get(root).count++;
 }
 const state={version:1,project:PROJECT,collection:'uploads',cursor,roots:[...roots.values()],scanned:(checkpoint?.scanned||0)+docs.length,missing:(checkpoint?.missing||0)+missing,invalid:(checkpoint?.invalid||0)+invalid};
 return{checkpoint:state,summary:{mode:'BOOTSTRAP_READ_ONLY',project:PROJECT,collection:'uploads',batchScanned:docs.length,cumulativeScanned:state.scanned,missingRoot:state.missing,invalidRoot:state.invalid,roots:state.roots.map(({index,hash,count})=>({index,hash,count})),sampleOnly:true,exhaustedAtRead:docs.length<100,compatibilityClosure:false}};
}
export async function main(args){
 let execute=false,file=null;for(let i=0;i<args.length;i++){if(args[i]==='--execute-bootstrap-read-only'){execute=true;continue;}if(args[i]==='--checkpoint'&&args[i+1]){file=args[++i];continue;}throw Error('INVALID_OPTIONS');}
 if(!execute){console.log(JSON.stringify({mode:'DRY_RUN',project:PROJECT,collection:'uploads',select:['rootId'],limit:100,noNetwork:true,noCredential:true}));return;}
 assert.ok(file);assert.ok(!process.env.FIRESTORE_EMULATOR_HOST);process.env.DEBUG='';
 const base=path.resolve('.firebase/document-inventory'),target=path.resolve(file);assert.ok(target.startsWith(base+path.sep)&&target.endsWith('.json'));fs.mkdirSync(path.dirname(target),{recursive:true});
 const checkpoint=fs.existsSync(target)?JSON.parse(fs.readFileSync(target,'utf8')):null;
 const result=await discoverRoots({credential:memoryCredential(),checkpoint});
 const pending=target+'.pending';fs.writeFileSync(pending,JSON.stringify(result.checkpoint,null,2)+'\n',{mode:0o600});fs.renameSync(pending,target);console.log(JSON.stringify(result.summary));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(()=>{console.error(JSON.stringify({error:'BOOTSTRAP_FAILED',detailsRedacted:true,productionWrites:false}));process.exitCode=1;});
