// Read-only candidate. Default performs no credential lookup or network call.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {memoryCredential,boundedJson,PROJECT} from '../qa/scripts/remediation-document-inventory-bootstrap.mjs';
import {selectBootstrapRoot} from '../qa/scripts/remediation-document-inventory-rest.mjs';
import {privateCheckpoint} from './inventory-delegation-provenance.mjs';
export const BUCKET='pay-0-system.firebasestorage.app';
const BASE=`projects/${PROJECT}/databases/(default)/documents`,PREFIX=BASE+'/uploads/';
export const FIELDS=['rootId','entityType','entityId','dispersionId','clientId','clienteId','documentType','storagePath','sizeBytes','contentType','storageGeneration','finalizedBy','status','active','deleted','isDeleted','deletedAt'];
const MASKS={clientDispersions:['rootId','clientId','clienteId','fundingSource.holderType','active','deleted','isDeleted','deletedAt'],clients:['rootId','active','deleted','isDeleted','deletedAt'],users:['rootId','active','isActive','disabled','deleted','isDeleted','deletedAt','trustedRestrictionV1.state'],telegramClientNotificationEvents:['rootId','clientId','dispersionId','uploadId','status','deliveryVersion']};
const CATEGORIES=['UPLOAD_IDENTITY_INVALID','UPLOAD_NOT_CURRENT','PARENT_OR_CLIENT_UNAVAILABLE','ACTOR_MISSING_OR_SCOPE_INVALID','ACTOR_LIFECYCLE_OR_RESTRICTION_REVIEW','USER_POLICY_PENDING','EVENT_IDENTITY_CONFLICT','EVENT_SENT_NO_REPLAY','EVENT_UNCERTAIN_NO_REPLAY','GENERATION_INVALID','OBJECT_MISSING','OBJECT_METADATA_MISMATCH','CURRENT_METADATA_MATCH_ONLY','PINNED_METADATA_MATCH_ONLY'];
const fail=()=>{throw Error('PREFLIGHT_REFUSED');};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(v);
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const nameOk=n=>typeof n==='string'&&n.startsWith(PREFIX)&&id(n.slice(PREFIX.length));
const stale=v=>!v||v.active===false||v.deleted===true||v.isDeleted===true||v.deletedAt!=null;
const generation=v=>typeof v==='string'&&/^[1-9][0-9]{0,39}$/.test(v);
const safeEventId=(c,d,u)=>`COMPROBANTE_DISPERSION_CLIENTE_${c}_${d}_${u}`.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,180);
export function query(rootId,limit=25,after=null){
 if(!id(rootId)||!Number.isInteger(limit)||limit<1||limit>25||(after&&!nameOk(after)))fail();
 return{structuredQuery:{select:{fields:FIELDS.map(fieldPath=>({fieldPath}))},from:[{collectionId:'uploads'}],where:{compositeFilter:{op:'AND',filters:[['rootId','stringValue',rootId],['entityType','stringValue','clientDispersions'],['status','stringValue','READY'],['active','booleanValue',true]].map(([field,type,value])=>({fieldFilter:{field:{fieldPath:field},op:'EQUAL',value:{[type]:value}}}))}},orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit:limit+1,...(after?{startAt:{values:[{referenceValue:after}],before:false}}:{})}};
}
function decode(v,depth=0){
 if(!plain(v)||Object.keys(v).length!==1||depth>4)fail();
 if(typeof v.stringValue==='string')return v.stringValue;
 if(typeof v.booleanValue==='boolean')return v.booleanValue;
 if(Object.hasOwn(v,'nullValue'))return null;
 if(typeof v.integerValue==='string'&&/^-?\d{1,16}$/.test(v.integerValue)&&Number.isSafeInteger(Number(v.integerValue)))return Number(v.integerValue);
 if(typeof v.timestampValue==='string')return {timestampPresent:true};
 if(plain(v.mapValue))return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x,depth+1)]));
 fail();
}
function fields(doc,allowed){
 if(!plain(doc)||!plain(doc.fields)||Object.keys(doc.fields).some(k=>!allowed.some(a=>a.split('.')[0]===k)))fail();
 return Object.fromEntries(Object.entries(doc.fields).map(([k,v])=>[k,decode(v)]));
}
export function restAdapter({credential,fetchImpl=fetch,now=Date.now}){
 let requests=0;const deadline=now()+120000;
 async function read(url,body){
  if(++requests>126||now()>=deadline)fail();
  const u=new URL(url);if(!['https://firestore.googleapis.com','https://storage.googleapis.com'].includes(u.origin))fail();
  const token=await credential.getAccessToken();
  if(now()>=deadline)fail();
  const response=await fetchImpl(url,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token.access_token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(Math.min(10000,Math.max(1,deadline-now())))});
  if(response.status===404){await response.body?.cancel();return null;}
  return boundedJson(response);
 }
 return{
  async list(root,limit,after){const data=await read(`https://firestore.googleapis.com/v1/${BASE}:runQuery`,query(root,limit,after));if(!Array.isArray(data)||data.length>limit+2)fail();const docs=[];let last=after;
   for(const row of data){if(!plain(row)||Object.keys(row).some(k=>!['document','readTime','done','skippedResults'].includes(k))||row.skippedResults>0)fail();if(!row.document)continue;const doc=row.document;if(!nameOk(doc.name)||(last&&doc.name<=last))fail();last=doc.name;docs.push({name:doc.name,...fields(doc,FIELDS)});}if(docs.length>limit+1)fail();return docs;},
  async document(collection,key){if(!Object.hasOwn(MASKS,collection)||typeof key!=='string'||!new RegExp(`^[A-Za-z0-9_-]{1,${collection==='telegramClientNotificationEvents'?180:160}}$`).test(key))fail();const params=new URLSearchParams();for(const field of MASKS[collection])params.append('mask.fieldPaths',field);const name=`${BASE}/${collection}/${key}`;const data=await read(`https://firestore.googleapis.com/v1/${name}?${params}`);if(data===null)return null;if(data.name!==name)fail();return fields(data,MASKS[collection]);},
  async object(storagePath,pinned){if(typeof storagePath!=='string'||!/^roots\/[A-Za-z0-9_-]+\/dispersiones\/[A-Za-z0-9_-]+\/docs\/COMPROBANTE_DISPERSION\/[A-Za-z0-9_.-]+$/.test(storagePath)||(pinned&&!generation(pinned)))fail();const params=new URLSearchParams({fields:'name,bucket,generation,metageneration,size,contentType,metadata(uploadid,uploadId,dispersionId,documentType)'});if(pinned)params.set('generation',pinned);const data=await read(`https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(storagePath)}?${params}`);if(data!==null&&(!plain(data)||Object.keys(data).some(k=>!['name','bucket','generation','metageneration','size','contentType','metadata'].includes(k))||(data.metadata&&Object.keys(data.metadata).some(k=>!['uploadid','uploadId','dispersionId','documentType'].includes(k)))))fail();return data;},
  get requests(){return requests;}
 };
}
export async function classifyUpload(row,rootId,adapter){
 const uploadId=row.name?.slice(PREFIX.length),d=row.dispersionId,c=row.clientId||row.clienteId;
 if(!nameOk(row.name)||row.rootId!==rootId||row.entityType!=='clientDispersions'||!id(d)||row.entityId!==d||!id(c)||row.documentType!=='COMPROBANTE_DISPERSION'||typeof row.storagePath!=='string'||!row.storagePath.startsWith(`roots/${rootId}/dispersiones/${d}/docs/COMPROBANTE_DISPERSION/${uploadId}-`)||!Number.isSafeInteger(row.sizeBytes)||row.sizeBytes<1||row.sizeBytes>1048576||typeof row.contentType!=='string'||!row.contentType||row.contentType.length>160)return'UPLOAD_IDENTITY_INVALID';
 if(stale(row)||row.status!=='READY'||row.active!==true)return'UPLOAD_NOT_CURRENT';
 const parent=await adapter.document('clientDispersions',d),client=await adapter.document('clients',c);
 if(stale(parent)||stale(client)||parent.rootId!==rootId||client.rootId!==rootId||(parent.clientId||parent.clienteId)!==c)return'PARENT_OR_CLIENT_UNAVAILABLE';
 if(parent.fundingSource?.holderType==='USER')return'USER_POLICY_PENDING';
 if(!id(row.finalizedBy))return'ACTOR_MISSING_OR_SCOPE_INVALID';
 const actor=await adapter.document('users',row.finalizedBy);
 if(!actor||(actor.rootId||row.finalizedBy)!==rootId)return'ACTOR_MISSING_OR_SCOPE_INVALID';
 if(stale(actor)||actor.disabled===true||actor.isActive===false||actor.trustedRestrictionV1!==undefined)return'ACTOR_LIFECYCLE_OR_RESTRICTION_REVIEW';
 const event=await adapter.document('telegramClientNotificationEvents',safeEventId(c,d,uploadId));
 if(event){if(event.rootId!==rootId||event.clientId!==c||event.dispersionId!==d||event.uploadId!==uploadId)return'EVENT_IDENTITY_CONFLICT';return event.status==='SENT'?'EVENT_SENT_NO_REPLAY':'EVENT_UNCERTAIN_NO_REPLAY';}
 if(row.storageGeneration!==undefined&&!generation(row.storageGeneration))return'GENERATION_INVALID';
 const object=await adapter.object(row.storagePath,row.storageGeneration||null);
 if(!object)return'OBJECT_MISSING';
 const m=object.metadata||{};
 if(object.name!==row.storagePath||object.bucket!==BUCKET||!generation(object.generation)||!generation(object.metageneration)||Number(object.size)!==row.sizeBytes||object.contentType!==row.contentType||(row.storageGeneration&&object.generation!==row.storageGeneration)||(!m.uploadid&&!m.uploadId)||(m.uploadid&&m.uploadid!==uploadId)||(m.uploadId&&m.uploadId!==uploadId)||m.dispersionId!==d||m.documentType!==row.documentType)return'OBJECT_METADATA_MISMATCH';
 return row.storageGeneration?'PINNED_METADATA_MATCH_ONLY':'CURRENT_METADATA_MATCH_ONLY';
}
const empty=()=>Object.fromEntries(CATEGORIES.map(k=>[k,0]));
const validCounts=c=>plain(c)&&Object.keys(c).length===CATEGORIES.length&&CATEGORIES.every(k=>Number.isSafeInteger(c[k])&&c[k]>=0);
export async function inventory(adapter,{rootId,limit=25,after=null}){
 query(rootId,limit,after);const rows=await adapter.list(rootId,limit,after);if(!Array.isArray(rows)||rows.length>limit+1)fail();
 const counts=empty();let cursor=after;for(const row of rows.slice(0,limit)){if(!nameOk(row.name)||(cursor&&row.name<=cursor))fail();cursor=row.name;const result=await classifyUpload(row,rootId,adapter);if(!CATEGORIES.includes(result))fail();counts[result]++;}
 return{cursor,counts,scanned:Math.min(rows.length,limit),complete:rows.length<=limit};
}
export async function durableInventory(adapter,{rootId,checkpoint,limit=25,privateBase='.firebase/document-inventory'}){
 query(rootId,limit);const file=privateCheckpoint(checkpoint,privateBase),lock=file+'.lock';const fd=fs.openSync(lock,'wx',0o600);let temp;
 try{let saved=null;if(fs.existsSync(file)){if(fs.statSync(file).size>32768)fail();saved=JSON.parse(fs.readFileSync(file,'utf8'));if(saved.schema!==1||saved.rootId!==rootId||saved.project!==PROJECT||!validCounts(saved.counts)||typeof saved.complete!=='boolean'||!Number.isSafeInteger(saved.scanned)||saved.scanned<0||saved.scanned!==Object.values(saved.counts).reduce((a,b)=>a+b,0)||(saved.cursor!==null&&!nameOk(saved.cursor))||((saved.cursor===null)!==(saved.scanned===0)))fail();}
 const prior=saved?.counts||empty(),batch=saved?.complete?{cursor:saved.cursor,counts:empty(),scanned:0,complete:true}:await inventory(adapter,{rootId,limit,after:saved?.cursor||null});
 const counts=Object.fromEntries(CATEGORIES.map(k=>[k,prior[k]+batch.counts[k]]));if(!validCounts(counts))fail();const next={schema:1,project:PROJECT,rootId,cursor:batch.cursor,counts,scanned:(saved?.scanned||0)+batch.scanned,complete:batch.complete};
 temp=file+'.'+process.pid+'.pending';const handle=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(handle,JSON.stringify(next));fs.fsyncSync(handle);}finally{fs.closeSync(handle);}fs.renameSync(temp,file);temp=null;
 return{mode:'BOUNDED_READ_ONLY',batchScanned:batch.scanned,batchCounts:batch.counts,cumulativeScanned:next.scanned,cumulativeCounts:counts,selectedRootExhaustedAtRead:batch.complete,authorization:'CURRENT_RESOLVER_REVALIDATION_REQUIRED',historicalIntegrity:'NOT_ESTABLISHED',attestationPerformed:false,deliveryAuthorized:false,snapshotConsistent:false,allRootsCovered:false,limits:{records:limit,httpRequests:126,responseBytes:524288,totalDeadlineMs:120000},checkpointContainsPrivateIdentifiers:true};
 }finally{if(temp&&fs.existsSync(temp))fs.unlinkSync(temp);fs.closeSync(fd);fs.unlinkSync(lock);}
}
export async function main(args){
 const opts={};let execute=false;for(let i=0;i<args.length;i++){if(args[i]==='--execute-read-only'&&!execute){execute=true;continue;}if(!['--bootstrap','--root-index','--checkpoint','--limit'].includes(args[i])||opts[args[i]]!==undefined||!args[i+1]||args[i+1].startsWith('--'))fail();opts[args[i]]=args[++i];}
 const index=Number(opts['--root-index']||0),limit=Number(opts['--limit']||25);if(!Number.isInteger(index)||index<0||!Number.isInteger(limit)||limit<1||limit>25)fail();
 if(!execute){console.log(JSON.stringify({mode:'DRY_RUN_NO_NETWORK',credentialRead:false,limit,productionWrites:false,deliveryAuthorized:false,checkpointRequired:true}));return;}
 if(!opts['--bootstrap']||!opts['--checkpoint']||process.env.FIRESTORE_EMULATOR_HOST)fail();
 const base=fs.realpathSync('.firebase/document-inventory')+path.sep,file=fs.realpathSync(opts['--bootstrap']);if(!file.startsWith(base)||!file.endsWith('.json')||fs.statSync(file).size>524288||path.resolve(opts['--checkpoint'])===file)fail();
 const rootId=selectBootstrapRoot(JSON.parse(fs.readFileSync(file,'utf8')),index);process.env.DEBUG='';
 console.log(JSON.stringify(await durableInventory(restAdapter({credential:memoryCredential()}),{rootId,checkpoint:opts['--checkpoint'],limit})));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(()=>{console.error(JSON.stringify({error:'PREFLIGHT_REFUSED',detailsRedacted:true,productionWrites:false,deliveryAuthorized:false}));process.exitCode=1;});
