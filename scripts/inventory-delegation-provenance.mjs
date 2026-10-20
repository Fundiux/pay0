// READ ONLY. Default dry run. No grants migration, authorization verdict or ancestor traversal.
// Scope evidence: clientDelegations/access.ts checks cleanId(user.rootId || uid).
// Existing profile with absent/null/empty rootId may therefore use uid, ONLY when
// an explicit client.rootId agrees. Missing profile/client/root remains UNKNOWN.
// Other malformed falsy values (false/0) stay UNKNOWN here, not an inferred scope.
// scopeBasis distinguishes this backend fallback from an explicit profile root;
// neither proves role, lifecycle, restriction, direct ownership or ancestor authority.
// Temporal evidence: policy.ts returns Timestamp.toMillis() without positivity,
// but numeric millis must be >0. Thus past Timestamp starts may be current while
// numeric0/-1 are invalid. Classification mirrors that distinction descriptively;
// CURRENT_BY_LIFETIME_ONLY is never an authorization verdict.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {memoryCredential,boundedJson,PROJECT} from '../qa/scripts/remediation-document-inventory-bootstrap.mjs';
import {selectBootstrapRoot} from '../qa/scripts/remediation-document-inventory-rest.mjs';
export const FIELDS=['rootId','targetUid','clientId','active','mode','startsAt','expiresAt','revokedAt','grantAuthority','grantedBy','createdBy'];
const DOCUMENTS=`projects/${PROJECT}/databases/(default)/documents`;
const validId=v=>typeof v==='string'&&v.length>0&&v.length<=180&&!/[\/\\\x00-\x1f]/.test(v);
const clean=v=>String(v||'').trim();
export class StoredTimestamp{constructor(ms){this.ms=ms;}}
export function decode(value){if(!value||typeof value!=='object')return undefined;if('nullValue'in value)return null;if('stringValue'in value)return value.stringValue;if('booleanValue'in value)return value.booleanValue;if('integerValue'in value)return Number(value.integerValue);if('doubleValue'in value)return Number(value.doubleValue);if('timestampValue'in value)return new StoredTimestamp(Date.parse(value.timestampValue));if('mapValue'in value)return Object.fromEntries(Object.entries(value.mapValue.fields||{}).map(([k,v])=>[k,decode(v)]));if('arrayValue'in value)return(value.arrayValue.values||[]).map(decode);return {unsupported:true};}
const millis=value=>value instanceof StoredTimestamp&&Number.isFinite(value.ms)?value.ms:typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=253402300799999?value:null;
const shape=value=>value===undefined?'ABSENT':value===null?'NULL':value instanceof StoredTimestamp?'TIMESTAMP':Array.isArray(value)?'ARRAY':typeof value==='string'?'STRING':typeof value==='number'?'NUMBER':typeof value==='boolean'?'BOOLEAN':'OBJECT';
export function classify(grant,{uid,clientId,rootId,now}){
 const a=grant.grantAuthority;
 const invalid=a!==undefined&&(!a||a.version!==1||!['SUPERADMIN','DIRECT','DELEGATED'].includes(a.source)||typeof a.grantorUid!=='string'||!a.grantorUid.trim());
 const grantor=clean(a?.grantorUid||grant.grantedBy||grant.createdBy);
 const provenance=invalid?'AUTHORITY_INVALID':!grantor?'LEGACY_PROVENANCE_UNVERIFIED':(/[\/]/.test(grantor)||grantor===uid||(a?.source==='DELEGATED'&&a.parentPath!==`userClientAccess/${grantor}/clients/${clientId}`))?'LINEAGE_REFERENCE_INVALID':a!==undefined?'AUTHORITY_V1_REQUIRES_VALIDATION':'LEGACY_GRANTOR_REQUIRES_VALIDATION';
 let lifetime='CURRENT_BY_LIFETIME_ONLY';
 if(grant.active!==true)lifetime='INACTIVE';else if(grant.revokedAt!=null)lifetime='REVOKED';else if(grant.mode==='TEMPORARY'&&grant.expiresAt==null)lifetime='TEMPORARY_WITHOUT_EXPIRY';else if(grant.expiresAt!=null&&(millis(grant.expiresAt)===null||millis(grant.expiresAt)<=now))lifetime=millis(grant.expiresAt)===null?'INVALID_EXPIRY':'EXPIRED';else if(grant.startsAt!=null&&(millis(grant.startsAt)===null||millis(grant.startsAt)>now))lifetime=millis(grant.startsAt)===null?'INVALID_START':'NOT_STARTED';
 const declaredScope=['rootId','targetUid','clientId'].some(k=>Object.hasOwn(grant,k)&&grant[k]!==({rootId,targetUid:uid,clientId})[k])?'DECLARED_SCOPE_MISMATCH':'DECLARED_SCOPE_CONSISTENT_OR_ABSENT';
 const authoritySource=a===undefined?'ABSENT':['SUPERADMIN','DIRECT','DELEGATED'].includes(a?.source)?a.source:'INVALID';
 const grantorOrigin=a?.grantorUid?'AUTHORITY':grant.grantedBy?'GRANTED_BY':grant.createdBy?'CREATED_BY':'NONE';
 return{provenance,lifetime,declaredScope,authoritySource,grantorOrigin,formats:Object.fromEntries(['grantAuthority','grantedBy','createdBy','rootId','startsAt','expiresAt','revokedAt','mode'].map(k=>[k,shape(grant[k])]))};
}
export function groupQuery(after,limit){assert.ok(Number.isInteger(limit)&&limit>=1&&limit<=100);if(after)assert.ok(typeof after==='string'&&after.startsWith(DOCUMENTS+'/')&&!/[\x00-\x1f]/.test(after));return{select:{fields:FIELDS.map(fieldPath=>({fieldPath}))},from:[{collectionId:'clients',allDescendants:true}],orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit,...(after?{startAt:{values:[{referenceValue:after}],before:false}}:{})};}
export function restAdapter({credential,fetchImpl=fetch}){
 async function request(url,body){let result;try{const token=await credential.getAccessToken();result=await fetchImpl(url,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error('READ_FAILED');}if(!body&&result.status===404)return null;return boundedJson(result);}
 return{async list(after,limit){const result=await request(`https://firestore.googleapis.com/v1/${DOCUMENTS}:runQuery`,{structuredQuery:groupQuery(after,limit)});assert.ok(Array.isArray(result)&&result.length<=limit+1);return result.filter(x=>x.document).map(x=>x.document);},async scope(collection,id){assert.ok(['users','clients'].includes(collection)&&validId(id));const row=await request(`https://firestore.googleapis.com/v1/${DOCUMENTS}/${collection}/${encodeURIComponent(id)}?mask.fieldPaths=rootId`);if(row)assert.equal(row.name,`${DOCUMENTS}/${collection}/${id}`);return row?{rootId:decode(row.fields?.rootId)}:null;}};
}
export async function inventory(adapter,{rootId,maxRecords=25,pageSize=25,now=Date.now(),after=null,onPage=async()=>{}}){
 assert.ok(validId(rootId));assert.ok(Number.isInteger(maxRecords)&&maxRecords>=1&&maxRecords<=100);assert.ok(Number.isInteger(pageSize)&&pageSize>=1&&pageSize<=100);
 const summary={mode:'BOUNDED_READ_ONLY',limits:{maxRecords,pageSize,maxScopeReads:2*maxRecords,maxResponseBytes:512*1024},sampleOnly:true,securityClosure:false,scanned:0,grantPaths:0,otherPaths:0,inScope:0,outsideRoot:0,scopeUnknown:0,scopeBasis:{},queries:0,scopeReads:0,exhaustedAtRead:false,budgetExhausted:false,provenance:{},lifetime:{},declaredScope:{},authoritySource:{},grantorOrigin:{},formats:{},legacyCurrentByLifetime:0,authorizationEvaluated:false,migrationPerformed:false,snapshotConsistent:false,unknowns:['ROLE_LIFECYCLE_RESTRICTION_NOT_READ','GRANTOR_ANCESTORS_NOT_READ','DIRECT_OWNERSHIP_NOT_EVALUATED','MISSING_CLIENT_ROOT_NOT_ASSUMED','CONCURRENT_CHANGES_POSSIBLE'],legacySemantics:'LEGACY_PROVENANCE_UNVERIFIED may remain allowed by current backend; absence of provenance is not rejection.'};
 const inc=(obj,key)=>obj[key]=(obj[key]||0)+1;let cursor=after;if(cursor)groupQuery(cursor,1);
 while(summary.scanned<maxRecords){const limit=Math.min(pageSize,maxRecords-summary.scanned);summary.queries++;const rows=await adapter.list(cursor,limit);assert.ok(Array.isArray(rows)&&rows.length<=limit);
 for(const row of rows){assert.ok(typeof row.name==='string'&&row.name.startsWith(DOCUMENTS+'/')&&(!cursor||row.name>cursor));cursor=row.name;summary.scanned++;
 const relative=row.name.slice(DOCUMENTS.length+1),parts=relative.split('/');if(parts.length!==4||parts[0]!=='userClientAccess'||parts[2]!=='clients'||!validId(parts[1])||!validId(parts[3])){summary.otherPaths++;continue;}
 summary.grantPaths++;const uid=parts[1],clientId=parts[3];summary.scopeReads++;const owner=await adapter.scope('users',uid);summary.scopeReads++;const client=await adapter.scope('clients',clientId);
 const fallback=!!owner&&(owner.rootId===undefined||owner.rootId===null||owner.rootId==='');
 const ownerRoot=fallback?uid:typeof owner?.rootId==='string'?clean(owner.rootId):null;
 const clientRoot=typeof client?.rootId==='string'?clean(client.rootId):null;
 if(!owner||!client||!validId(ownerRoot)||!validId(clientRoot)||ownerRoot!==clientRoot){summary.scopeUnknown++;continue;}if(ownerRoot!==rootId){summary.outsideRoot++;continue;}
 summary.inScope++;inc(summary.scopeBasis,fallback?'PROFILE_UID_FALLBACK_MATCHED_CLIENT_ROOT':'EXPLICIT_PROFILE_AND_CLIENT_ROOT');const grant=Object.fromEntries(FIELDS.filter(k=>Object.hasOwn(row.fields||{},k)).map(k=>[k,decode(row.fields[k])]));const result=classify(grant,{uid,clientId,rootId,now});inc(summary.provenance,result.provenance);inc(summary.lifetime,result.lifetime);inc(summary.declaredScope,result.declaredScope);inc(summary.authoritySource,result.authoritySource);inc(summary.grantorOrigin,result.grantorOrigin);for(const[k,v]of Object.entries(result.formats)){summary.formats[k]||={};inc(summary.formats[k],v);}if(result.provenance==='LEGACY_PROVENANCE_UNVERIFIED'&&result.lifetime==='CURRENT_BY_LIFETIME_ONLY')summary.legacyCurrentByLifetime++;
 }
 if(rows.length<limit)summary.exhaustedAtRead=true;
 summary.budgetExhausted=!summary.exhaustedAtRead&&summary.scanned===maxRecords;
 await onPage({cursor,summary:structuredClone(summary)});
 if(summary.exhaustedAtRead)break;}
 summary.budgetExhausted=!summary.exhaustedAtRead&&summary.scanned===maxRecords;return summary;
}
// Checkpoints contain document names/root IDs: private local files only, never stdout.
const TOTALS=['scanned','grantPaths','otherPaths','inScope','outsideRoot','scopeUnknown','queries','scopeReads','legacyCurrentByLifetime'];
const HISTOGRAMS=['scopeBasis','provenance','lifetime','declaredScope','authoritySource','grantorOrigin','formats'];
function addCounts(a={},b={}){const out=structuredClone(a);for(const[k,v]of Object.entries(b)){if(v&&typeof v==='object')out[k]=addCounts(out[k],v);else{assert.ok(Number.isSafeInteger(v)&&v>=0);out[k]=(out[k]||0)+v;assert.ok(Number.isSafeInteger(out[k]));}}return out;}
const CATEGORIES={scopeBasis:['PROFILE_UID_FALLBACK_MATCHED_CLIENT_ROOT','EXPLICIT_PROFILE_AND_CLIENT_ROOT'],provenance:['AUTHORITY_INVALID','LEGACY_PROVENANCE_UNVERIFIED','LINEAGE_REFERENCE_INVALID','AUTHORITY_V1_REQUIRES_VALIDATION','LEGACY_GRANTOR_REQUIRES_VALIDATION'],lifetime:['CURRENT_BY_LIFETIME_ONLY','INACTIVE','REVOKED','TEMPORARY_WITHOUT_EXPIRY','INVALID_EXPIRY','EXPIRED','INVALID_START','NOT_STARTED'],declaredScope:['DECLARED_SCOPE_MISMATCH','DECLARED_SCOPE_CONSISTENT_OR_ABSENT'],authoritySource:['ABSENT','SUPERADMIN','DIRECT','DELEGATED','INVALID'],grantorOrigin:['AUTHORITY','GRANTED_BY','CREATED_BY','NONE']};
function validateCounts(c){
 assert.deepEqual(Object.keys(c).sort(),[...TOTALS,...HISTOGRAMS].sort());
 const integer=v=>assert.ok(Number.isSafeInteger(v)&&v>=0);
 const histogram=(obj,keys)=>{assert.ok(obj&&typeof obj==='object'&&!Array.isArray(obj));for(const[k,v]of Object.entries(obj)){assert.ok(keys.includes(k));integer(v);}};
 for(const k of TOTALS)integer(c[k]);for(const[k,keys]of Object.entries(CATEGORIES))histogram(c[k],keys);
 assert.ok(c.formats&&typeof c.formats==='object'&&!Array.isArray(c.formats));
 for(const[k,v]of Object.entries(c.formats)){assert.ok(['grantAuthority','grantedBy','createdBy','rootId','startsAt','expiresAt','revokedAt','mode'].includes(k));histogram(v,['ABSENT','NULL','TIMESTAMP','ARRAY','STRING','NUMBER','BOOLEAN','OBJECT']);}
 assert.equal(c.scanned,c.grantPaths+c.otherPaths);assert.equal(c.grantPaths,c.inScope+c.outsideRoot+c.scopeUnknown);assert.equal(c.scopeReads,2*c.grantPaths);
}
function counts(summary){return Object.fromEntries([...TOTALS,...HISTOGRAMS].map(k=>[k,summary[k]??(TOTALS.includes(k)?0:{})]));}
export function privateCheckpoint(file,base='.firebase/document-inventory'){
 const directory=fs.realpathSync(base),target=path.resolve(file);
 assert.equal(fs.realpathSync(path.dirname(target)),directory);
 assert.ok(path.basename(target).endsWith('.json')&&!path.basename(target).startsWith('.'));
 if(fs.existsSync(target)){assert.ok(!fs.lstatSync(target).isSymbolicLink());assert.equal(fs.realpathSync(target),target);}
 return target;
}
export async function durableInventory(adapter,{checkpoint,rootId,maxRecords=25,pageSize=25,now=Date.now(),privateBase='.firebase/document-inventory'}){
 assert.ok(validId(rootId)&&Number.isInteger(maxRecords)&&maxRecords>=1&&maxRecords<=100&&Number.isInteger(pageSize)&&pageSize>=1&&pageSize<=100);
 const file=privateCheckpoint(checkpoint,privateBase),lock=file+'.lock';
 const fd=fs.openSync(lock,'wx',0o600);let temp;
 try{
 const config={project:PROJECT,rootId,maxRecords,pageSize,projection:FIELDS,scopePolicy:'OWNER_PROFILE_AND_EXPLICIT_CLIENT_V1'};
 let saved=null;
 if(fs.existsSync(file)){assert.ok(fs.statSync(file).size<=512*1024);saved=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(saved.schema,1);assert.deepEqual(saved.config,config);assert.ok(Number.isFinite(saved.classificationAsOf));assert.equal(typeof saved.complete,'boolean');if(saved.cursor)groupQuery(saved.cursor,1);else assert.equal(saved.cursor,null);validateCounts(saved.cumulative);assert.equal(saved.cursor===null,saved.cumulative.scanned===0);}
 const prior=saved?.cumulative||counts({}),asOf=saved?.classificationAsOf??now;
 let latest=saved,batch=null;
 if(!saved?.complete)batch=await inventory(adapter,{rootId,maxRecords,pageSize,now:asOf,after:saved?.cursor??null,onPage:async({cursor,summary})=>{
  const next={schema:1,config,classificationAsOf:asOf,cursor,complete:summary.exhaustedAtRead,cumulative:addCounts(prior,counts(summary))};
  const candidate=file+'.'+process.pid+'.tmp';const handle=fs.openSync(candidate,'wx',0o600);temp=candidate;try{fs.writeFileSync(handle,JSON.stringify(next));fs.fsyncSync(handle);}finally{fs.closeSync(handle);}
  fs.renameSync(temp,file);temp=null;latest=next;
 }});
 return{mode:'DURABLE_BOUNDED_READ_ONLY',batch:batch||{...counts({}),alreadyComplete:true},cumulative:latest.cumulative,complete:latest.complete,classificationAsOf:asOf,limits:{maxRecordsPerInvocation:maxRecords,pageSize},authorizationEvaluated:false,snapshotConsistent:false,securityClosure:false,checkpointContainsPrivateIdentifiers:true};
 }finally{if(temp&&fs.existsSync(temp))fs.unlinkSync(temp);fs.closeSync(fd);fs.unlinkSync(lock);}
}
export async function main(args){const values={};let execute=false;for(let i=0;i<args.length;i++){if(args[i]==='--execute-read-only'){execute=true;continue;}assert.ok(['--bootstrap','--root-index','--max-records','--page-size','--checkpoint'].includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--'));assert.ok(!Object.hasOwn(values,args[i]));values[args[i]]=args[++i];}
 const maxRecords=Number(values['--max-records']||25),pageSize=Number(values['--page-size']||25),index=Number(values['--root-index']||0);assert.ok(Number.isInteger(maxRecords)&&maxRecords>=1&&maxRecords<=100&&Number.isInteger(pageSize)&&pageSize>=1&&pageSize<=100&&Number.isInteger(index)&&index>=0);
 if(!execute){console.log(JSON.stringify({mode:'DRY_RUN',project:PROJECT,collectionGroup:'clients',projection:FIELDS,scopeProjection:['rootId'],maxRecords,pageSize,maxScopeReads:2*maxRecords,noNetwork:true,noCredential:true,checkpointRequiredForExecution:true}));return;}
 assert.ok(values['--bootstrap']&&values['--checkpoint']&&!process.env.FIRESTORE_EMULATOR_HOST);const base=fs.realpathSync('.firebase/document-inventory')+path.sep,file=fs.realpathSync(values['--bootstrap']);assert.ok(file.startsWith(base)&&file.endsWith('.json')&&fs.statSync(file).size<=512*1024);process.env.DEBUG='';const rootId=selectBootstrapRoot(JSON.parse(fs.readFileSync(file,'utf8')),index);
 assert.notEqual(path.resolve(values['--checkpoint']),file);
 console.log(JSON.stringify(await durableInventory(restAdapter({credential:memoryCredential()}),{checkpoint:values['--checkpoint'],rootId,maxRecords,pageSize})));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(()=>{console.error(JSON.stringify({error:'DELEGATION_INVENTORY_FAILED',detailsRedacted:true,productionWrites:false}));process.exitCode=1;});
