const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ts=require('../../functions/node_modules/typescript');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {createRequire}=require('node:module'),fr=createRequire(path.resolve('functions/package.json'));
const {Timestamp}=fr('firebase-admin/firestore'),{HttpsError}=fr('firebase-functions/v2/https');
const guard=require('../../functions/src/utils/authGuard.ts');
const policy=require('../../functions/src/modules/clientDelegations/policy.ts');
const rows=new Map();let version=0,writes=0,beforeCommit=null,retries=0;
const put=(key,value)=>{rows.set(key,{value,version:++version});};
const ref=key=>({path:key,id:key.split('/').at(-1),get:async()=>snap(key)});
const snap=key=>({exists:rows.has(key),id:key.split('/').at(-1),ref:ref(key),data:()=>rows.get(key)?.value});
const query=prefix=>({path:prefix,query:true,get:async()=>({docs:[...rows.keys()].filter(k=>k.startsWith(prefix+'/')&&!k.slice(prefix.length+1).includes('/')).map(snap)})});
const db={doc:ref,collection:query,async runTransaction(fn){
 for(let attempt=0;attempt<3;attempt++){
  const seen=new Map(),pending=[];
  const tx={get:async r=>{assert.equal(pending.length,0,'read after write');if(r.query){seen.set('__query',version);return r.get();}seen.set(r.path,rows.get(r.path)?.version);return snap(r.path);},set:(r,data)=>pending.push([r.path,data])};
  const result=await fn(tx);if(beforeCommit){const hook=beforeCommit;beforeCommit=null;hook();}
  if([...seen].some(([key,v])=>key==='__query'?v!==version:rows.get(key)?.version!==v)){retries++;continue;}
  for(const[key,value]of pending){put(key,{...rows.get(key)?.value,...value});writes++;}return result;
 }throw Error('CONFLICT_RETRY_EXHAUSTED');
}};
const firestore=Object.assign(()=>db,{Timestamp,FieldValue:{serverTimestamp:()=>Timestamp.fromMillis(Date.now())}});
const admin={apps:[{}],firestore};
function load(file,deps){const exports={};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports','require',code)(exports,name=>{assert(name in deps,name);return deps[name];});return exports;}
const access=load('functions/src/modules/clientDelegations/access.ts',{'firebase-admin':admin,'firebase-functions/v2/https':{HttpsError},'./policy':policy,'../../utils/authGuard':guard});
const service=load('functions/src/modules/clientDelegations/service.ts',{'firebase-admin':admin,'firebase-functions/v2/https':{HttpsError},'./policy':policy,'../../utils/authGuard':guard,'./access':access});
const user=role=>({role,rootId:'root',active:true,modules:{usuarios:{clientDelegations:true}}});
const grant=(uid,grantor,permissions={view:true,operate:true})=>({active:true,rootId:'root',targetUid:uid,clientId:'client',permissions,grantedBy:grantor});
const resolve=uid=>access.resolveClientOperationalAccess({uid,role:rows.get(`users/${uid}`).value.role,rootId:'root',clientId:'client'});
const request=(caller,target,items=[{clientId:'client',active:true}])=>({auth:{uid:caller},data:{targetUid:target,accessItems:items}});
function reset(){rows.clear();version=0;writes=0;beforeCommit=null;retries=0;for(const uid of ['root','a','b','c','outsider'])put(`users/${uid}`,user(uid==='root'?'superadmin':'admin'));put('clients/client',{rootId:'root',active:true,adminId:'a'});}
(async()=>{
 reset();await service.setUserClientAccessService(request('a','b'));await service.setUserClientAccessService(request('b','c'));
 assert.equal((await resolve('c')).allowed,true);assert.equal(rows.get('userClientAccess/c/clients/client').value.grantAuthority.source,'DELEGATED');
 put('userClientAccess/b/clients/client',{...rows.get('userClientAccess/b/clients/client').value,permissions:{view:true,operate:true,operatePagos:false}});
 assert.equal((await resolve('c')).permissions.operatePagos,false);assert.equal((await resolve('c')).permissions.operateSolicitudes,true);
 put('users/a',{...user('admin'),modules:{usuarios:{clientDelegations:false}}});assert.equal((await resolve('c')).allowed,false);
 put('users/a',user('admin'));put('clients/client',{rootId:'root',active:true,adminId:'outsider'});assert.equal((await resolve('c')).allowed,false);
 reset();put('userClientAccess/b/clients/client',grant('b','a'));put('userClientAccess/c/clients/client',grant('c','b'));assert.equal((await resolve('c')).allowed,true);
 put('users/b',{...user('admin'),rootId:'foreign'});assert.equal((await resolve('c')).allowed,false);
 put('users/b',user('admin'));put('userClientAccess/b/clients/client',{...grant('b','a'),expiresAt:Timestamp.fromMillis(Date.now()-1)});assert.equal((await resolve('c')).allowed,false);
 reset();put('userClientAccess/b/clients/client',grant('b','c'));put('userClientAccess/c/clients/client',grant('c','b'));assert.equal((await resolve('c')).allowed,false);
 reset();put('userClientAccess/b/clients/client',grant('b','a'));const noCycle=request('b','a');put('clients/client',{rootId:'root',active:true,adminId:'root'});put('userClientAccess/a/clients/client',grant('a','root'));await assert.rejects(service.setUserClientAccessService(noCycle),e=>e.code==='permission-denied');
 reset();put('userClientAccess/c/clients/client',{active:true,permissions:{view:true,operate:true}});assert.equal((await resolve('c')).reason,'LEGACY_PROVENANCE_UNVERIFIED');
 // A concurrent actor/parent change retries the full authorization transaction.
 for(const mutation of ['actor','parent','client','target']){
  reset();put('userClientAccess/b/clients/client',grant('b','a'));
  beforeCommit=()=>{if(mutation==='actor')put('users/b',{...user('admin'),disabled:true});if(mutation==='parent')put('userClientAccess/b/clients/client',{...grant('b','a'),active:false});if(mutation==='client')put('clients/client',{rootId:'foreign',active:true,adminId:'a'});if(mutation==='target')put('users/c',{...user('admin'),rootId:'foreign'});};
  await assert.rejects(service.setUserClientAccessService(request('b','c')));assert.equal(rows.has('userClientAccess/c/clients/client'),false);assert.equal(writes,0);assert.equal(retries,1);
 }
 reset();put('clients/other',{rootId:'root',active:true,adminId:'outsider'});put('userClientAccess/c/clients/other',{active:true,rootId:'root',targetUid:'c',clientId:'other',grantedBy:'outsider'});
 await assert.rejects(service.setUserClientAccessService(request('a','c')),e=>e.code==='permission-denied');assert.equal(rows.get('userClientAccess/c/clients/other').value.active,true);assert.equal(writes,0);
 reset();await service.setUserClientAccessService(request('a','b'));await service.setUserClientAccessService(request('b','c'));await service.setUserClientAccessService(request('a','b',[]));assert.equal((await resolve('c')).allowed,false);
 for(const patch of [{disabled:true},{active:false},{role:'operador'},{modules:{usuarios:{clientDelegations:false}}}]){
  reset();put('userClientAccess/b/clients/client',grant('b','a'));put('userClientAccess/c/clients/client',grant('c','b'));put('users/b',{...user('admin'),...patch});assert.equal((await resolve('c')).allowed,false);
 }
 reset();const expiry=Timestamp.fromMillis(Date.now()+60000);put('userClientAccess/b/clients/client',{...grant('b','a'),expiresAt:expiry});put('userClientAccess/c/clients/client',grant('c','b'));
 assert.equal((await resolve('c')).delegation.expiresAt.toMillis(),expiry.toMillis());await assert.rejects(service.setUserClientAccessService(request('b','c')),e=>e.code==='permission-denied');
 reset();for(let n=1;n<=17;n++){put(`users/u${n}`,user('admin'));put(`userClientAccess/u${n}/clients/client`,grant(`u${n}`,n===1?'root':`u${n-1}`));}
 assert.equal((await resolve('u16')).allowed,true);assert.equal((await resolve('u17')).allowed,false);
 reset();put('userClientAccess/c/clients/client',{...grant('c','a'),grantAuthority:{version:2,source:'DIRECT',grantorUid:'a'}});assert.equal((await resolve('c')).allowed,false);
 console.log('PASS lineage: transitive permissions/revocation/expiry/root/ownership, cycles, explicit provenance, legacy unknown marker, four TOCTOU retries with zero writes, unauthorized removal denied');
})().catch(error=>{console.error(error);process.exitCode=1;});
