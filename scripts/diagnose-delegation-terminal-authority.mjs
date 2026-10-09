// Read-only bounded CURRENT authority diagnostic. Never reconstructs issuance history.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {decode,StoredTimestamp,restAdapter,classify} from './inventory-delegation-provenance.mjs';
import {boundedJson,memoryCredential,PROJECT} from '../qa/scripts/remediation-document-inventory-bootstrap.mjs';
import {selectBootstrapRoot} from '../qa/scripts/remediation-document-inventory-rest.mjs';
const BASE=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const PREFIX=`projects/${PROJECT}/databases/(default)/documents/`;
export const PROFILE_FIELDS=['rootId','role','supervisorRole','active','isActive','isDeleted','disabled','deleted','deletedAt','modules.usuarios','trustedRestrictionV1'];
export const CLIENT_FIELDS=['rootId','active','adminId','ownerId','managedByUserId','createdBy','operadorId'];
const id=v=>typeof v==='string'&&v.length>0&&v.length<=180&&!/[\/\\\x00-\x1f]/.test(v);
const clean=v=>String(v||'').trim();
const NEXT=Symbol('requires ancestor');
StoredTimestamp.prototype.toMillis=function(){return this.ms;};
// Compile only this explicit local module set; firebase-admin never initializes.
export function backendTerminal({now,readUser,sourceRoot=BASE}){
 const require=createRequire(import.meta.url),ts=require('typescript'),cache=new Map();
 const allowed=['modules/clientDelegations/access','modules/clientDelegations/policy','utils/authGuard','modules/users/authorization','modules/users/defaultModules','modules/users/authorizationPolicy.generated','modules/users/restrictions'].map(p=>path.resolve(sourceRoot,'functions/src',p+'.ts'));
 class HttpError extends Error{constructor(code,message){super(message);this.code=code;}}
 class Clock extends Date{static now(){return now;}}
 const db={doc(p){if(p.startsWith('userClientAccess/'))throw NEXT;assert.ok(p.startsWith('users/')&&id(p.slice(6)));return{get:async()=>{const data=await readUser(p.slice(6));return{data:()=>data,exists:!!data};}};}};
 function load(file){assert.ok(allowed.includes(file));if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);const local=specifier=>{if(specifier==='firebase-admin')return{apps:[{}],firestore:()=>db};if(specifier==='firebase-admin/firestore')return{Timestamp:StoredTimestamp};if(specifier==='firebase-functions/v2/https')return{HttpsError:HttpError};if(specifier==='firebase-functions')return{https:{HttpsError:HttpError}};assert.ok(specifier.startsWith('.'));return load(path.resolve(path.dirname(file),specifier+'.ts'));};new Function('exports','require','Date',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(exports,local,Clock);return exports;}
 const access=load(allowed[0]),guard=load(allowed[2]);
 return{async inspect({uid,rootId,clientId,client,user,grantor=false}){
  try{guard.assertAuthorized({uid},user,{allowedRoles:grantor?['superadmin','admin']:['superadmin','admin','operador'],...(grantor?{requiredModule:'usuarios',requiredAction:'clientDelegations'}:{})});}catch{return 'CURRENT_PROFILE_AUTHORIZATION_DENIED';}
  // Always exercise backend current-root/lifecycle checks before accepting terminal.
  try{const result=await access.resolveClientOperationalAccess({uid,rootId,clientId,client,role:guard.getUserRole(user)});return !result.allowed?'CURRENT_ACCESS_DENIED':result.source==='SUPERADMIN'?'CURRENT_SUPERADMIN_TERMINAL':result.source==='DIRECT'?'CURRENT_DIRECT_TERMINAL':'REQUIRES_ANCESTOR_REVIEW';}catch(error){if(error===NEXT)return 'REQUIRES_ANCESTOR_REVIEW';if(error instanceof HttpError&&error.code==='failed-precondition')return 'CURRENT_CLIENT_INACTIVE';throw error;}
 }};
}
export function terminalAdapter({credential,fetchImpl=fetch}){
 const group=restAdapter({credential,fetchImpl});return{list:group.list,async read(collection,uid){assert.ok(['users','clients'].includes(collection)&&id(uid));const mask=(collection==='users'?PROFILE_FIELDS:CLIENT_FIELDS).map(p=>'mask.fieldPaths='+encodeURIComponent(p)).join('&');let response;try{const token=await credential.getAccessToken();response=await fetchImpl(`https://firestore.googleapis.com/v1/${PREFIX}${collection}/${encodeURIComponent(uid)}?${mask}`,{headers:{Authorization:`Bearer ${token.access_token}`},redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error('READ_FAILED');}if(response.status===404)return null;const row=await boundedJson(response);assert.equal(row.name,PREFIX+collection+'/'+uid);return Object.fromEntries(Object.entries(row.fields||{}).map(([k,v])=>[k,decode(v)]));}};
}
export async function diagnoseTerminals(adapter,{rootId,now=Date.now(),sourceRoot=BASE}){
 assert.ok(id(rootId)&&Number.isFinite(now));const summary={mode:'CURRENT_TERMINAL_DIAGNOSTIC',scanned:0,otherPaths:0,grantPaths:0,inScope:0,scopeUnknown:0,outsideRoot:0,profileClientReads:0,uniqueGrantors:0,grantorFieldConflict:0,missingGrantor:0,invalidLineage:0,recipient:{},grantor:{},grantLifetime:{},limits:{scanned:100,grantPaths:4,uniqueGrantors:4,profileClientReads:12},exhaustedAtRead:false,snapshotConsistent:false,historicalAuthorityVerified:false,migrationPerformed:false,fullLineageEvaluated:false};
 const inc=(object,key)=>object[key]=(object[key]||0)+1,cache=new Map(),grantors=new Set();
 async function read(collection,uid){assert.ok(id(uid));const key=collection+'/'+uid;if(!cache.has(key)){assert.ok(summary.profileClientReads<12);summary.profileClientReads++;cache.set(key,await adapter.read(collection,uid));}return cache.get(key);}
 const backend=backendTerminal({now,sourceRoot,readUser:uid=>read('users',uid)});
 const rows=await adapter.list(null,100);assert.ok(Array.isArray(rows)&&rows.length<=100);summary.exhaustedAtRead=rows.length<100;let previous=null;
 for(const row of rows){assert.ok(typeof row.name==='string'&&row.name.startsWith(PREFIX)&&(!previous||row.name>previous));previous=row.name;summary.scanned++;const parts=row.name.slice(PREFIX.length).split('/');if(parts.length!==4||parts[0]!=='userClientAccess'||parts[2]!=='clients'||!id(parts[1])||!id(parts[3])){summary.otherPaths++;continue;}
  assert.ok(++summary.grantPaths<=4);const uid=parts[1],clientId=parts[3],user=await read('users',uid),client=await read('clients',clientId);
  const userRoot=user&&(user.rootId==null||user.rootId==='')?uid:typeof user?.rootId==='string'?clean(user.rootId):null,clientRoot=typeof client?.rootId==='string'?clean(client.rootId):null;
  if(!id(userRoot)||!id(clientRoot)||userRoot!==clientRoot){summary.scopeUnknown++;continue;}if(userRoot!==rootId){summary.outsideRoot++;continue;}summary.inScope++;
  const grant=Object.fromEntries(Object.entries(row.fields||{}).map(([k,v])=>[k,decode(v)]));
  inc(summary.grantLifetime,classify(grant,{uid,clientId,rootId,now}).lifetime);
  inc(summary.recipient,await backend.inspect({uid,rootId,clientId,client,user}));
  if(grant.grantedBy&&grant.createdBy&&clean(grant.grantedBy)!==clean(grant.createdBy))summary.grantorFieldConflict++;
  const authority=grant.grantAuthority,grantorUid=clean(authority?.grantorUid||grant.grantedBy||grant.createdBy);
  if(authority!==undefined&&(!authority||authority.version!==1||!['SUPERADMIN','DIRECT','DELEGATED'].includes(authority.source)||typeof authority.grantorUid!=='string'||!authority.grantorUid.trim())){summary.invalidLineage++;continue;}
  if(!grantorUid){summary.missingGrantor++;continue;}if(!id(grantorUid)||grantorUid===uid||(authority?.source==='DELEGATED'&&authority.parentPath!==`userClientAccess/${grantorUid}/clients/${clientId}`)){summary.invalidLineage++;continue;}
  grantors.add(grantorUid);assert.ok(grantors.size<=4);summary.uniqueGrantors=grantors.size;
  inc(summary.grantor,await backend.inspect({uid:grantorUid,rootId,clientId,client,user:await read('users',grantorUid),grantor:true}));
 }
 return summary;
}
export async function main(args){const opts={};let execute=false;for(let i=0;i<args.length;i++){if(args[i]==='--execute-read-only'){execute=true;continue;}assert.ok(['--bootstrap','--root-index'].includes(args[i])&&args[i+1]&&!Object.hasOwn(opts,args[i]));opts[args[i]]=args[++i];}if(!execute){console.log(JSON.stringify({mode:'DRY_RUN',noNetwork:true,noCredential:true,profileFields:PROFILE_FIELDS,clientFields:CLIENT_FIELDS,maximumScanned:100,maximumGrantPaths:4,maximumReads:12}));return;}assert.ok(opts['--bootstrap']&&!process.env.FIRESTORE_EMULATOR_HOST);const base=fs.realpathSync('.firebase/document-inventory')+path.sep,file=fs.realpathSync(opts['--bootstrap']);assert.ok(file.startsWith(base)&&file.endsWith('.json')&&fs.statSync(file).size<=512*1024);const index=Number(opts['--root-index']||0);assert.ok(Number.isInteger(index)&&index>=0);const rootId=selectBootstrapRoot(JSON.parse(fs.readFileSync(file,'utf8')),index);process.env.DEBUG='';console.log(JSON.stringify(await diagnoseTerminals(terminalAdapter({credential:memoryCredential()}),{rootId})));}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(()=>{console.error(JSON.stringify({error:'TERMINAL_DIAGNOSTIC_FAILED',detailsRedacted:true,productionWrites:false}));process.exitCode=1;});
