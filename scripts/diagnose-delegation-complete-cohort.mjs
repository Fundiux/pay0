// Current snapshot diagnostic only. No migration, historical claim or unbounded reads.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {decode,StoredTimestamp,groupQuery,FIELDS} from './inventory-delegation-provenance.mjs';
import {terminalAdapter} from './diagnose-delegation-terminal-authority.mjs';
import {boundedJson,memoryCredential,PROJECT} from '../qa/scripts/remediation-document-inventory-bootstrap.mjs';
import {selectBootstrapRoot} from '../qa/scripts/remediation-document-inventory-rest.mjs';
const BASE=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),PREFIX=`projects/${PROJECT}/databases/(default)/documents/`;
export const COHORT_FIELDS=[...FIELDS,'permissions'];
export const PERMISSIONS=['view','operate','viewBasic','operateSolicitudes','operatePagos','operateBeneficiarios','operateDispersiones','viewBalanceInDispersion','requestDispersionIncidents','commentDispersionNotes'];
const REASONS=['CLIENT_ACCESS_ACTOR_INVALID','CLIENT_OUT_OF_ROOT','DELEGATION_LINEAGE_INVALID','NO_DELEGATION','DELEGATION_INACTIVE','DELEGATION_REVOKED','DELEGATION_EXPIRED','DELEGATION_SCOPE_INVALID','DELEGATION_GRANTOR_INVALID','DELEGATION_WITHOUT_PERMISSIONS','LEGACY_PROVENANCE_UNVERIFIED'];
const id=v=>typeof v==='string'&&v.length>0&&v.length<=180&&!/[\/\\\x00-\x1f]/.test(v),clean=v=>String(v||'').trim();
StoredTimestamp.prototype.toMillis=function(){return this.ms;};
export function cohortBackend(documents,{now,sourceRoot=BASE}){
 const ts=createRequire(import.meta.url)('typescript'),cache=new Map();
 const allowed=['modules/clientDelegations/access','modules/clientDelegations/policy','utils/authGuard','modules/users/authorization','modules/users/defaultModules','modules/users/authorizationPolicy.generated','modules/users/restrictions'].map(p=>path.resolve(sourceRoot,'functions/src',p+'.ts'));
 class HttpError extends Error{constructor(code,message){super(message);this.code=code;}}
 class Clock extends Date{static now(){return now;}}
 const reads=[];
 const db={doc(p){if(!documents.has(p))throw Error('COHORT_INCOMPLETE');return{get:async()=>{reads.push(p);const data=documents.get(p);return{data:()=>data,exists:!!data,ref:{path:p},id:p.split('/').at(-1)};}};}};
 function load(file){assert.ok(allowed.includes(file));if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);const local=specifier=>{if(specifier==='firebase-admin')return{apps:[{}],firestore:()=>db};if(specifier==='firebase-admin/firestore')return{Timestamp:StoredTimestamp};if(specifier==='firebase-functions/v2/https')return{HttpsError:HttpError};if(specifier==='firebase-functions')return{https:{HttpsError:HttpError}};assert.ok(specifier.startsWith('.'));return load(path.resolve(path.dirname(file),specifier+'.ts'));};new Function('exports','require','Date',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(exports,local,Clock);return exports;}
 const access=load(allowed[0]),guard=load(allowed[2]);
 return{reads,async resolve({uid,clientId,rootId}){try{return await access.resolveClientOperationalAccess({uid,clientId,rootId,role:guard.getUserRole(documents.get('users/'+uid))});}catch(error){if(error instanceof HttpError&&error.code==='failed-precondition')return{allowed:false,source:'DENIED',reason:'CURRENT_CLIENT_INACTIVE',permissions:Object.fromEntries(PERMISSIONS.map(k=>[k,false]))};throw error;}}};
}
export function completeAdapter({credential,fetchImpl=fetch}){
 const scoped=terminalAdapter({credential,fetchImpl});return{read:scoped.read,async list(){const query=groupQuery(null,100);query.select.fields=COHORT_FIELDS.map(fieldPath=>({fieldPath}));let response;try{const token=await credential.getAccessToken();response=await fetchImpl(`https://firestore.googleapis.com/v1/${PREFIX.slice(0,-1)}:runQuery`,{method:'POST',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({structuredQuery:query}),redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error('READ_FAILED');}const rows=await boundedJson(response);assert.ok(Array.isArray(rows)&&rows.length<=101);return rows.filter(x=>x.document).map(x=>x.document);}};
}
export async function diagnoseCompleteCohort(adapter,{rootId,now=Date.now(),sourceRoot=BASE}){
 assert.ok(id(rootId)&&Number.isFinite(now));const documents=new Map(),rows=await adapter.list(null,100);assert.ok(Array.isArray(rows)&&rows.length<100);let previous=null,otherPaths=0,profileClientReads=0;const grants=[],grantors=new Set();
 for(const row of rows){assert.ok(typeof row.name==='string'&&row.name.startsWith(PREFIX)&&(!previous||row.name>previous));previous=row.name;const p=row.name.slice(PREFIX.length).split('/');if(p.length!==4||p[0]!=='userClientAccess'||p[2]!=='clients'||!id(p[1])||!id(p[3])){otherPaths++;continue;}assert.ok(grants.length<4);const data=Object.fromEntries(Object.entries(row.fields||{}).map(([k,v])=>[k,decode(v)]));grants.push({uid:p[1],clientId:p[3],data});documents.set(row.name.slice(PREFIX.length),data);}
 assert.equal(grants.length,4);
 async function read(collection,uid){assert.ok(id(uid));const key=collection+'/'+uid;if(!documents.has(key)){assert.ok(profileClientReads<9);profileClientReads++;documents.set(key,await adapter.read(collection,uid));}return documents.get(key);}
 for(const {uid,clientId,data}of grants){const user=await read('users',uid),client=await read('clients',clientId);const userRoot=user&&(user.rootId==null||user.rootId==='')?uid:typeof user?.rootId==='string'?clean(user.rootId):null,clientRoot=typeof client?.rootId==='string'?clean(client.rootId):null;assert.ok(id(userRoot)&&id(clientRoot)&&userRoot===rootId&&clientRoot===rootId);const grantor=clean(data.grantAuthority?.grantorUid||data.grantedBy||data.createdBy);if(grantor){assert.ok(id(grantor));grantors.add(grantor);assert.ok(grantors.size<=1);}}
 for(const grantor of grantors)await read('users',grantor);
 const backend=cohortBackend(documents,{now,sourceRoot}),summary={mode:'COMPLETE_COHORT_CURRENT_SNAPSHOTS',scanned:rows.length,otherPaths,grants:4,inScope:4,uniqueGrantors:grantors.size,profileClientReads,allowed:0,denied:0,sources:{},reasons:{},permissions:Object.fromEntries(PERMISSIONS.map(k=>[k,{true:0,false:0}])),limits:{queries:1,scanned:100,grants:4,grantors:1,profileClientReads:9},snapshotConsistent:false,historicalAuthorityVerified:false,migrationPerformed:false,classificationAsOf:now};
 const inc=(o,k)=>o[k]=(o[k]||0)+1;
 for(const {uid,clientId}of grants){const result=await backend.resolve({uid,clientId,rootId});assert.equal(typeof result.allowed,'boolean');assert.ok(['SUPERADMIN','DIRECT','DELEGATED','DENIED'].includes(result.source));assert.ok(result.reason===null||REASONS.includes(result.reason)||result.reason==='CURRENT_CLIENT_INACTIVE');summary[result.allowed?'allowed':'denied']++;inc(summary.sources,result.source);inc(summary.reasons,result.reason??'NONE');assert.deepEqual(Object.keys(result.permissions).sort(),[...PERMISSIONS].sort());for(const key of PERMISSIONS){assert.equal(typeof result.permissions[key],'boolean');summary.permissions[key][String(result.permissions[key])]++;}}
 summary.cachedResolverReads={users:0,clients:0,grants:0};for(const reference of backend.reads)inc(summary.cachedResolverReads,reference.startsWith('users/')?'users':reference.startsWith('clients/')?'clients':'grants');
 return summary;
}
export async function main(args){let execute=false;const opts={};for(let i=0;i<args.length;i++){if(args[i]==='--execute-read-only'){execute=true;continue;}assert.ok(['--bootstrap','--root-index'].includes(args[i])&&args[i+1]&&!Object.hasOwn(opts,args[i]));opts[args[i]]=args[++i];}if(!execute){console.log(JSON.stringify({mode:'DRY_RUN',noNetwork:true,noCredential:true,grantFields:COHORT_FIELDS,queries:1,maximumScanned:100,requiredInScopeGrants:4,maximumGrantors:1,maximumMaskedReads:9}));return;}assert.ok(opts['--bootstrap']&&!process.env.FIRESTORE_EMULATOR_HOST);const base=fs.realpathSync('.firebase/document-inventory')+path.sep,file=fs.realpathSync(opts['--bootstrap']);assert.ok(file.startsWith(base)&&file.endsWith('.json')&&fs.statSync(file).size<=512*1024);const index=Number(opts['--root-index']||0);assert.ok(Number.isInteger(index)&&index>=0);const rootId=selectBootstrapRoot(JSON.parse(fs.readFileSync(file,'utf8')),index);process.env.DEBUG='';console.log(JSON.stringify(await diagnoseCompleteCohort(completeAdapter({credential:memoryCredential()}),{rootId})));}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(()=>{console.error(JSON.stringify({error:'COMPLETE_COHORT_DIAGNOSTIC_FAILED',detailsRedacted:true,productionWrites:false}));process.exitCode=1;});
