// Actual finalizer, fake persistence/Storage; no credentials, messages or network.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
global.fetch=async()=>{throw Error('NETWORK_FORBIDDEN');};
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
function setup(){
 const rows=new Map([['users/u',{role:'superadmin',rootId:'r',active:true}],['clientDispersions/d',{rootId:'r'}],['uploads/x',{rootId:'r',dispersionId:'d',entityId:'d',entityType:'clientDispersions',storagePath:'roots/r/dispersiones/d/docs/COMPROBANTE_DISPERSION/x-file.pdf',documentType:'COMPROBANTE_DISPERSION',status:'PENDING',active:false,version:null}]]);
 let audits=0,hook=null,queue=Promise.resolve();
 const snapshot=p=>({exists:rows.has(p),data:()=>structuredClone(rows.get(p)),ref:ref(p),id:p.split('/').at(-1)});
 function ref(p){return{path:p,get:async()=>snapshot(p),update:async v=>rows.set(p,{...rows.get(p),...v})};}
 function collection(name,filters=[]){return{doc:id=>ref(name+'/'+id),where:(...f)=>collection(name,[...filters,f]),filters,name};}
 const db={doc:ref,collection,runTransaction:fn=>{const run=queue.then(async()=>{let writes=[],events=[];const tx={get:async q=>q.path?snapshot(q.path):{docs:[...rows.keys()].filter(p=>p.startsWith(q.name+'/')&&q.filters.every(([k,op,v])=>{assert.equal(op,'==');return rows.get(p)[k]===v;})).map(snapshot)},update:(r,v)=>writes.push([r.path,v]),events};const value=await fn(tx);for(const[p,v]of writes)rows.set(p,{...rows.get(p),...v});audits+=events.length;return value;});queue=run.catch(()=>{});return run;}};
 const firestore=()=>db;firestore.FieldValue={serverTimestamp:()=>123};
 const admin={apps:[{}],firestore,storage:()=>({bucket:()=>({file:()=>({exists:async()=>{if(hook){const fn=hook;hook=null;fn();}return[true];}})})})};
 const cache=new Map();
 function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const out={};const deps={'firebase-admin':admin,'firebase-functions':{logger:{info(){},error(){}},https:{HttpsError}},'firebase-functions/v2/https':{HttpsError},'../../utils/logActivity':{logActivityTx:(tx,_db,e)=>tx.events.push(e),logActivity:async()=>{throw Error('UNEXPECTED_EVENT');}},'../telegram/service':{sendTelegramMessage:async()=>{throw Error('MESSAGE_FORBIDDEN');},sendTelegramDocumentBuffer:async()=>{throw Error('MESSAGE_FORBIDDEN');}},'../clientDelegations/access':{getCurrentClientDelegationAccess:async()=>null},'../users/authorization':{getEffectiveUserModules:()=>({wallet:{dispersiones:true}}),isCanonicalUserActive:u=>u.active===true}};
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('exports','require',code)(out,n=>{if(Object.hasOwn(deps,n))return deps[n];assert.ok(n.startsWith('.'),'unexpected import '+n);return load(path.resolve(path.dirname(file),n+'.ts'));});cache.set(file,out);return out;}
 const api=load('functions/src/modules/dispersionDocuments/service.ts');
 return{rows,call:()=>api.finalizeDispersionDocumentUploadCore({auth:{uid:'u'},data:{uploadId:'x',storagePath:rows.get('uploads/x').storagePath}}),get audits(){return audits;},race:fn=>hook=fn};
}
test('first finalization preserves READY/version1 contract',async()=>{const s=setup();const r=await s.call();assert.equal(r.version,1);assert.equal(r.active,true);assert.equal(s.audits,1);});
test('same upload replay retains version and emits one audit',async()=>{const s=setup();await s.call();const r=await s.call();assert.equal(r.version,1);assert.equal(s.audits,1);});
test('two concurrent finalizations retain one version and audit',async()=>{const s=setup();const r=await Promise.all([s.call(),s.call()]);assert.deepEqual(r.map(x=>x.version),[1,1]);assert.equal(s.audits,1);});
for(const status of ['INACTIVE','REPLACED','DELETED','FAILED'])test('cannot revive '+status,async()=>{const s=setup();Object.assign(s.rows.get('uploads/x'),{status,active:false,version:2});await assert.rejects(s.call(),e=>e.code==='failed-precondition');assert.equal(s.audits,0);assert.equal(s.rows.get('uploads/x').status,status);});
test('upload root changing during object lookup is denied',async()=>{const s=setup();s.race(()=>s.rows.get('uploads/x').rootId='foreign');await assert.rejects(s.call(),e=>e.code==='permission-denied'||e.code==='failed-precondition');assert.equal(s.audits,0);});
for(const field of ['dispersionId','storagePath','storageGeneration','documentType','entityType'])test('identity changes during lookup rejected: '+field,async()=>{const s=setup();s.race(()=>s.rows.get('uploads/x')[field]='different');await assert.rejects(s.call(),e=>e.code==='failed-precondition');assert.equal(s.audits,0);});
test('active previous version replaced once by new upload',async()=>{const s=setup();s.rows.set('uploads/old',{...s.rows.get('uploads/x'),status:'READY',active:true,version:3});await s.call();assert.equal(s.rows.get('uploads/old').status,'REPLACED');assert.equal(s.rows.get('uploads/x').version,4);await s.call();assert.equal(s.rows.get('uploads/x').version,4);assert.equal(s.audits,1);});
test('READY inactive and malformed version cannot be finalized',async()=>{for(const values of [{status:'READY',active:false,version:1},{status:'READY',active:true,version:0}]){const s=setup();Object.assign(s.rows.get('uploads/x'),values);await assert.rejects(s.call(),e=>e.code==='failed-precondition');assert.equal(s.audits,0);}});
