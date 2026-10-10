// Local tool only. No network or credentials unless --execute-read-only is supplied.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {memoryCredential,boundedJson,PROJECT} from '../qa/scripts/remediation-document-inventory-bootstrap.mjs';
import {selectBootstrapRoot} from '../qa/scripts/remediation-document-inventory-rest.mjs';
import {privateCheckpoint} from './inventory-delegation-provenance.mjs';
const BASE=`projects/${PROJECT}/databases/(default)/documents`;
const BUCKET='pay-0-system.firebasestorage.app';
const FIELDS={clients:['rootId'],clientTelegramUsers:['rootId','clientId','active'],uploads:['rootId','entityType','entityId','dispersionId','clientId','clienteId','documentType','status','active','storagePath','storageGeneration','finalizedBy'],clientDispersions:['rootId','clientId','clienteId','fundingSource.holderType']};
const KEYS=['CLIENT_ROWS','LINK_ROWS_OBSERVED','LINK_ROWS_VALID_SCOPE','LINK_ROWS_INVALID_SCOPE','LINK_COUNT_0','LINK_COUNT_1','LINK_COUNT_2_10','LINK_COUNT_11_100','LINK_COUNT_GT100_LOWER_BOUND','UPLOAD_ROWS','INVALID_SCOPE','USER_SKIPPED','NON_CLIENT_FUNDING_REVIEW','CLIENT_UPLOAD','GENERATION_MISSING','GENERATION_INVALID','GENERATION_PRESENT','FINALIZER_MISSING','FINALIZER_INVALID','FINALIZER_PRESENT','OBJECT_NOT_READ','OBJECT_MISSING','OBJECT_IDENTITY_MISMATCH','ENCODING_IDENTITY_OR_ABSENT','ENCODING_OTHER'];
const refuse=()=>{throw Error('INVENTORY_REFUSED');};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(v);
const gen=v=>typeof v==='string'&&/^[1-9][0-9]{0,19}$/.test(v);
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const nameOk=(v,c)=>typeof v==='string'&&v.startsWith(`${BASE}/${c}/`)&&id(v.slice(`${BASE}/${c}/`.length));
const empty=()=>Object.fromEntries(KEYS.map(k=>[k,0]));
const validCounts=c=>plain(c)&&Object.keys(c).length===KEYS.length&&KEYS.every(k=>Number.isSafeInteger(c[k])&&c[k]>=0);
function fieldFilter(field,value){return{fieldFilter:{field:{fieldPath:field},op:'EQUAL',value:typeof value==='boolean'?{booleanValue:value}:{stringValue:value}}};}
export function query(collection,rootId,{limit=25,after=null,clientId=null}={}){
 if(!['clients','uploads','clientTelegramUsers'].includes(collection)||!id(rootId)||!Number.isInteger(limit)||limit<1||limit>(collection==='clientTelegramUsers'?100:25)||(after&&!nameOk(after,collection))||(collection==='clientTelegramUsers'&&!id(clientId)))refuse();
 // Match the notifier selection BEFORE it applies the root check and safety limit.
 const filters=collection==='clientTelegramUsers'?[]:[fieldFilter('rootId',rootId)];
 if(collection==='uploads')filters.push(fieldFilter('entityType','clientDispersions'),fieldFilter('status','READY'),fieldFilter('active',true));
 if(collection==='clientTelegramUsers')filters.push(fieldFilter('clientId',clientId),fieldFilter('active',true));
 return{structuredQuery:{select:{fields:FIELDS[collection].map(fieldPath=>({fieldPath}))},from:[{collectionId:collection}],where:{compositeFilter:{op:'AND',filters}},orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit:limit+1,...(after?{startAt:{values:[{referenceValue:after}],before:false}}:{})}};
}
const INVALID_FIELD_TYPE=Object.freeze({invalidFieldType:true});
function decode(value,depth=0){
 if(!plain(value)||Object.keys(value).length!==1||depth>3)refuse();
 if(typeof value.stringValue==='string')return value.stringValue;
 if(typeof value.booleanValue==='boolean')return value.booleanValue;
 if(Object.hasOwn(value,'nullValue'))return null;
 // Do not coerce Firestore numeric generations into strings or retain raw values.
 if(['integerValue','doubleValue','timestampValue','bytesValue','referenceValue','geoPointValue','arrayValue'].some(k=>Object.hasOwn(value,k)))return INVALID_FIELD_TYPE;
 if(plain(value.mapValue))return Object.fromEntries(Object.entries(value.mapValue.fields||{}).map(([k,v])=>[k,decode(v,depth+1)]));
 refuse();
}
function fields(doc,collection){
 if(!plain(doc)||!plain(doc.fields)||Object.keys(doc.fields).some(k=>!FIELDS[collection].some(f=>f.split('.')[0]===k)))refuse();
 const row=Object.fromEntries(Object.entries(doc.fields).map(([k,v])=>[k,decode(v)]));
 if(row.fundingSource!==undefined&&(!plain(row.fundingSource)||Object.keys(row.fundingSource).some(k=>k!=='holderType')))refuse();
 return row;
}
export function restAdapter({credential,fetchImpl=fetch,now=Date.now}){
 let requests=0;const deadline=now()+120000;
 async function read(url,body){
  if(++requests>51||now()>=deadline)refuse();
  const token=await credential.getAccessToken();if(now()>=deadline)refuse();
  const response=await fetchImpl(url,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token.access_token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(Math.min(10000,Math.max(1,deadline-now())))});
  if(response.status===404){await response.body?.cancel();return null;}return boundedJson(response);
 }
 return{
  async page(collection,root,options){const request=query(collection,root,options),data=await read(`https://firestore.googleapis.com/v1/${BASE}:runQuery`,request);if(!Array.isArray(data)||data.length>request.structuredQuery.limit+1)refuse();const rows=[];let last=options.after;
   for(const item of data){if(!plain(item)||Object.keys(item).some(k=>!['document','readTime','done','skippedResults'].includes(k))||item.skippedResults>0)refuse();if(!item.document)continue;const doc=item.document;if(!nameOk(doc.name,collection)||(last&&doc.name<=last))refuse();last=doc.name;rows.push({name:doc.name,...fields(doc,collection)});}if(rows.length>request.structuredQuery.limit)refuse();return rows;},
  async parent(key){if(!id(key))refuse();const name=`${BASE}/clientDispersions/${key}`,params=new URLSearchParams();for(const f of FIELDS.clientDispersions)params.append('mask.fieldPaths',f);const data=await read(`https://firestore.googleapis.com/v1/${name}?${params}`);if(data===null)return null;if(data.name!==name)refuse();return fields(data,'clientDispersions');},
  async object(objectPath,generation){if(typeof objectPath!=='string'||!/^roots\/[A-Za-z0-9_-]+\/dispersiones\/[A-Za-z0-9_-]+\/docs\/COMPROBANTE_DISPERSION\/[A-Za-z0-9_.-]+$/.test(objectPath)||(generation!==null&&!gen(generation)))refuse();const params=new URLSearchParams({fields:'name,bucket,generation,contentEncoding'});if(generation!==null)params.set('generation',generation);const row=await read(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(objectPath)}?${params}`);if(row!==null&&(!plain(row)||Object.keys(row).some(k=>!['name','bucket','generation','contentEncoding'].includes(k))))refuse();return row;},
  get requests(){return requests;}
 };
}
export async function inventory(adapter,{rootId,mode,limit=25,after=null}){
 if(!['clients','uploads'].includes(mode))refuse();query(mode,rootId,{limit,after});
 const rows=await adapter.page(mode,rootId,{limit,after});if(!Array.isArray(rows)||rows.length>limit+1)refuse();const counts=empty();let cursor=after;
 for(const row of rows.slice(0,limit)){
  if(!nameOk(row.name,mode)||(cursor&&row.name<=cursor))refuse();cursor=row.name;
  counts[mode==='clients'?'CLIENT_ROWS':'UPLOAD_ROWS']++;
  if(row.rootId!==rootId){counts.INVALID_SCOPE++;continue;}
  if(mode==='clients'){
   const clientId=row.name.split('/').at(-1),links=await adapter.page('clientTelegramUsers',rootId,{limit:100,clientId});
   if(!Array.isArray(links)||links.length>101)refuse();let prev=null;for(const link of links){if(!nameOk(link.name,'clientTelegramUsers')||(prev&&link.name<=prev)||link.clientId!==clientId||link.active!==true)refuse();prev=link.name;counts[link.rootId===rootId?'LINK_ROWS_VALID_SCOPE':'LINK_ROWS_INVALID_SCOPE']++;}
   counts.LINK_ROWS_OBSERVED+=links.length;counts[links.length===0?'LINK_COUNT_0':links.length===1?'LINK_COUNT_1':links.length<=10?'LINK_COUNT_2_10':links.length<=100?'LINK_COUNT_11_100':'LINK_COUNT_GT100_LOWER_BOUND']++;continue;
  }
  const uploadId=row.name.split('/').at(-1),d=row.dispersionId,c=row.clientId||row.clienteId;
  if(row.entityType!=='clientDispersions'||row.entityId!==d||!id(d)||!id(c)||row.documentType!=='COMPROBANTE_DISPERSION'||row.status!=='READY'||row.active!==true){counts.INVALID_SCOPE++;continue;}
  const parent=await adapter.parent(d);
  if(!parent||parent.rootId!==rootId||(parent.clientId||parent.clienteId)!==c){counts.INVALID_SCOPE++;continue;}
  if(parent.fundingSource?.holderType==='USER'){counts.USER_SKIPPED++;continue;}
  if(parent.fundingSource?.holderType!==undefined&&parent.fundingSource.holderType!=='CLIENT'){counts.NON_CLIENT_FUNDING_REVIEW++;continue;}
  counts.CLIENT_UPLOAD++;
  const generation=row.storageGeneration;
  counts[generation==null?'GENERATION_MISSING':gen(generation)?'GENERATION_PRESENT':'GENERATION_INVALID']++;
  counts[row.finalizedBy==null?'FINALIZER_MISSING':id(row.finalizedBy)?'FINALIZER_PRESENT':'FINALIZER_INVALID']++;
  const prefix=`roots/${rootId}/dispersiones/${d}/docs/COMPROBANTE_DISPERSION/${uploadId}-`;
  if((generation!=null&&!gen(generation))||typeof row.storagePath!=='string'||!row.storagePath.startsWith(prefix)||!/^roots\/[A-Za-z0-9_-]+\/dispersiones\/[A-Za-z0-9_-]+\/docs\/COMPROBANTE_DISPERSION\/[A-Za-z0-9_.-]+$/.test(row.storagePath)||row.storagePath.length<=prefix.length){counts.OBJECT_NOT_READ++;continue;}
  const object=await adapter.object(row.storagePath,generation??null);
  if(!object){counts.OBJECT_MISSING++;continue;}
  if(object.name!==row.storagePath||object.bucket!==BUCKET||!gen(object.generation)||(generation!=null&&object.generation!==generation)){counts.OBJECT_IDENTITY_MISMATCH++;continue;}
  counts[object.contentEncoding===undefined||object.contentEncoding==='identity'?'ENCODING_IDENTITY_OR_ABSENT':'ENCODING_OTHER']++;
 }
 return{cursor,counts,scanned:Math.min(rows.length,limit),complete:rows.length<=limit};
}
export async function durableInventory(adapter,{rootId,mode,bootstrapHash,checkpoint,limit=25,privateBase='.firebase/document-inventory'}){
 query(mode,rootId,{limit});if(!/^[a-f0-9]{64}$/.test(bootstrapHash))refuse();const file=privateCheckpoint(checkpoint,privateBase),lock=file+'.lock',fd=fs.openSync(lock,'wx',0o600);let temp;
 try{
  let saved=null;if(fs.existsSync(file)){if(fs.statSync(file).size>32768)refuse();saved=JSON.parse(fs.readFileSync(file,'utf8'));if(!plain(saved)||Object.keys(saved).some(k=>!['schema','project','rootId','mode','bootstrapHash','cursor','counts','scanned','complete'].includes(k))||saved.schema!==1||saved.project!==PROJECT||saved.rootId!==rootId||saved.mode!==mode||saved.bootstrapHash!==bootstrapHash||!validCounts(saved.counts)||typeof saved.complete!=='boolean'||!Number.isSafeInteger(saved.scanned)||saved.scanned<0||saved.scanned!==saved.counts[mode==='clients'?'CLIENT_ROWS':'UPLOAD_ROWS']||(saved.cursor!==null&&!nameOk(saved.cursor,mode))||((saved.cursor===null)!==(saved.scanned===0)))refuse();}
  const batch=saved?.complete?{cursor:saved.cursor,counts:empty(),scanned:0,complete:true}:await inventory(adapter,{rootId,mode,limit,after:saved?.cursor||null});
  const counts=Object.fromEntries(KEYS.map(k=>[k,(saved?.counts[k]||0)+batch.counts[k]]));if(!validCounts(counts))refuse();const next={schema:1,project:PROJECT,rootId,mode,bootstrapHash,cursor:batch.cursor,counts,scanned:(saved?.scanned||0)+batch.scanned,complete:batch.complete};
  temp=file+'.'+process.pid+'.pending';const handle=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(handle,JSON.stringify(next));fs.fsyncSync(handle);}finally{fs.closeSync(handle);}fs.renameSync(temp,file);temp=null;
  return{mode:'BOUNDED_READ_ONLY',dataset:mode,batchScanned:batch.scanned,batchCounts:batch.counts,cumulativeScanned:next.scanned,cumulativeCounts:counts,selectedRootDatasetExhaustedAtRead:batch.complete,allRootsCovered:false,snapshotConsistent:false,countsDistinctChats:false,deliveryAuthorized:false,attestationPerformed:false,productionWrites:false,authorization:'CURRENT_RESOLVER_REVALIDATION_REQUIRED',limits:{records:limit,linkRowsPerClient:101,httpRequests:51,responseBytes:524288,transportBudgetMs:120000}};
 }finally{if(temp&&fs.existsSync(temp))fs.unlinkSync(temp);fs.closeSync(fd);fs.unlinkSync(lock);}
}
export async function main(args){
 const opts={};let execute=false;for(let i=0;i<args.length;i++){if(args[i]==='--execute-read-only'&&!execute){execute=true;continue;}if(!['--bootstrap','--root-index','--checkpoint','--limit','--mode'].includes(args[i])||opts[args[i]]!==undefined||!args[i+1]||args[i+1].startsWith('--'))refuse();opts[args[i]]=args[++i];}
 const index=Number(opts['--root-index']||0),limit=Number(opts['--limit']||25),mode=opts['--mode']||'clients';if(!Number.isInteger(index)||index<0||!['clients','uploads'].includes(mode)||!Number.isInteger(limit)||limit<1||limit>25)refuse();
 if(!execute){console.log(JSON.stringify({mode:'DRY_RUN_NO_NETWORK',dataset:mode,credentialRead:false,productionWrites:false,deliveryAuthorized:false}));return;}
 if(!opts['--bootstrap']||!opts['--checkpoint']||process.env.FIRESTORE_EMULATOR_HOST)refuse();const base=fs.realpathSync('.firebase/document-inventory')+path.sep,file=fs.realpathSync(opts['--bootstrap']);if(!file.startsWith(base)||!file.endsWith('.json')||fs.statSync(file).size>524288||path.resolve(opts['--checkpoint'])===file)refuse();
 const bytes=fs.readFileSync(file),rootId=selectBootstrapRoot(JSON.parse(bytes.toString('utf8')),index),bootstrapHash=createHash('sha256').update(bytes).digest('hex');process.env.DEBUG='';
 console.log(JSON.stringify(await durableInventory(restAdapter({credential:memoryCredential()}),{rootId,mode,bootstrapHash,checkpoint:opts['--checkpoint'],limit})));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(()=>{console.error(JSON.stringify({error:'INVENTORY_REFUSED',detailsRedacted:true,productionWrites:false,deliveryAuthorized:false}));process.exitCode=1;});
