import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {memoryCredential,boundedJson,PROJECT} from './remediation-document-inventory-bootstrap.mjs';
import {FIELDS,FAMILIES,inventory} from './remediation-document-inventory.mjs';
export const BUCKET='pay-0-system.appspot.com';
const DOCUMENTS=`projects/${PROJECT}/databases/(default)/documents`;
const API=`https://firestore.googleapis.com/v1/${DOCUMENTS}:runQuery`;
const PARENT_FIELDS=['rootId','status','active','isDeleted','deleted','deletedAt'];
const PARENTS=['solicitudes','pagos','clientDispersions','clients','companies','despachos'];
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=180&&!/[\/\\\x00-\x1f]/.test(value);
function decode(value){if(!value||typeof value!=='object')return{};if('stringValue'in value)return value.stringValue;if('booleanValue'in value)return value.booleanValue;if('nullValue'in value)return null;if('integerValue'in value)return Number(value.integerValue);if('doubleValue'in value)return value.doubleValue;if('timestampValue'in value)return value.timestampValue;return{};}
function row(document,collection,fields){const prefix=`${DOCUMENTS}/${collection}/`;assert.ok(typeof document.name==='string'&&document.name.startsWith(prefix));const id=document.name.slice(prefix.length);assert.ok(validId(id));return{id,data:Object.fromEntries(fields.filter(key=>Object.hasOwn(document.fields||{},key)).map(key=>[key,decode(document.fields[key])]))};}
export function selectBootstrapRoot(checkpoint,index){assert.equal(checkpoint.version,1);assert.equal(checkpoint.project,PROJECT);assert.equal(checkpoint.collection,'uploads');assert.ok(Number.isInteger(index)&&index>=0);const selected=checkpoint.roots?.find(value=>value.index===index);assert.ok(selected&&validId(selected.rootId));return selected.rootId;}
export function restAdapter({credential,rootId,fetchImpl=fetch,save}){
 assert.ok(validId(rootId));
 async function request(url,body){const token=await credential.getAccessToken();let response;try{response=await fetchImpl(url,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token.access_token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000),redirect:'error'});}catch{throw Error('INVENTORY_READ_FAILED');}if(response.status===404){const error=Error('NOT_FOUND');error.code=404;throw error;}return boundedJson(response);}
 async function query(structuredQuery){const result=await request(API,{structuredQuery});assert.ok(Array.isArray(result)&&result.length<=101);return result.filter(item=>item.document).map(item=>item.document);}
 return{
  async list(family,{rootId:scope,after,limit,fields}){
   assert.ok(FAMILIES.includes(family));assert.equal(scope,rootId);assert.ok(Number.isInteger(limit)&&limit>=1&&limit<=100);assert.deepEqual(fields,FIELDS);if(after)assert.ok(validId(after));
   const docs=await query({select:{fields:fields.map(fieldPath=>({fieldPath}))},from:[{collectionId:family}],where:{fieldFilter:{field:{fieldPath:'rootId'},op:'EQUAL',value:{stringValue:rootId}}},orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit,...(after?{startAt:{values:[{referenceValue:`${DOCUMENTS}/${family}/${after}`}],before:false}}:{})});assert.ok(docs.length<=limit);return docs.map(doc=>row(doc,family,fields));
  },
  async parent(collection,id){assert.ok(PARENTS.includes(collection)&&validId(id));const docs=await query({select:{fields:PARENT_FIELDS.map(fieldPath=>({fieldPath}))},from:[{collectionId:collection}],where:{fieldFilter:{field:{fieldPath:'__name__'},op:'EQUAL',value:{referenceValue:`${DOCUMENTS}/${collection}/${id}`}}},limit:1});assert.ok(docs.length<=1);if(!docs.length)return null;const result=row(docs[0],collection,PARENT_FIELDS);assert.equal(result.id,id);return result.data;},
  async metadata(storagePath){assert.ok(typeof storagePath==='string'&&storagePath.startsWith(`roots/${rootId}/`)&&!storagePath.includes('..')&&!/[\\\x00-\x1f]/.test(storagePath));const result=await request(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(storagePath)}?fields=size`);return{size:result.size};},
  ...(save?{save}:{}),
 };
}
export async function main(args){
 const values={};let execute=false,metadata=false;for(let i=0;i<args.length;i++){if(args[i]==='--execute-read-only'){execute=true;continue;}if(args[i]==='--with-storage-metadata'){metadata=true;continue;}assert.ok(['--bootstrap','--root-index','--checkpoint','--max-records','--page-size'].includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--'));assert.ok(!Object.hasOwn(values,args[i]));values[args[i]]=args[++i];}
 const maxRecords=Number(values['--max-records']||100),pageSize=Number(values['--page-size']||25),index=Number(values['--root-index']||0);assert.ok(Number.isInteger(maxRecords)&&maxRecords>=1&&maxRecords<=100);assert.ok(Number.isInteger(pageSize)&&pageSize>=1&&pageSize<=100);assert.ok(Number.isInteger(index)&&index>=0);
 if(!execute){console.log(JSON.stringify({mode:'DRY_RUN',project:PROJECT,rootIndex:index,families:['uploads'],maxRecords,pageSize,maxMetadataReads:metadata?maxRecords:0,noNetwork:true,noCredential:true}));return;}
 assert.ok(values['--bootstrap']&&values['--checkpoint']);assert.ok(!process.env.FIRESTORE_EMULATOR_HOST&&!process.env.FIREBASE_STORAGE_EMULATOR_HOST);process.env.DEBUG='';
 const base=path.resolve('.firebase/document-inventory')+path.sep,bootstrap=path.resolve(values['--bootstrap']),checkpointFile=path.resolve(values['--checkpoint']);assert.ok(bootstrap.startsWith(base)&&checkpointFile.startsWith(base)&&bootstrap!==checkpointFile&&bootstrap.endsWith('.json')&&checkpointFile.endsWith('.json'));
 const rootId=selectBootstrapRoot(JSON.parse(fs.readFileSync(bootstrap,'utf8')),index);
 const options={project:PROJECT,root:rootId,bucket:metadata?BUCKET:'',families:['uploads'],pageSize,maxRecords,maxMetadata:maxRecords,withStorageMetadata:metadata};
 const checkpoint=fs.existsSync(checkpointFile)?JSON.parse(fs.readFileSync(checkpointFile,'utf8')):null;
 const adapter=restAdapter({credential:memoryCredential(),rootId,save:async state=>{fs.mkdirSync(path.dirname(checkpointFile),{recursive:true});fs.writeFileSync(checkpointFile+'.pending',JSON.stringify(state,null,2)+'\n',{mode:0o600});fs.renameSync(checkpointFile+'.pending',checkpointFile);}});
 const result=await inventory(adapter,options,checkpoint);console.log(JSON.stringify({...result.summary,rootIndex:index,sampleOnly:true}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(()=>{console.error(JSON.stringify({error:'INVENTORY_REST_FAILED',detailsRedacted:true,productionWrites:false}));process.exitCode=1;});
