const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { PassThrough, Writable } = require('node:stream');
const ts = require('../../functions/node_modules/typescript');
const root = path.resolve(__dirname, '../..');
function load(file, dependencies) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module = {exports:{}};
  vm.runInNewContext(code, {module,exports:module.exports,require:(name)=>dependencies[name] || require(name),Buffer,console,setTimeout,clearTimeout}, {filename:file});
  return module.exports;
}
const policy = load('functions/src/modules/telegram/downloadTokenPolicy.ts', {});
const time = n => ({toMillis:()=>n});
const active = () => ({status:'ACTIVE',actionType:'DOWNLOAD_DOCUMENT',expiresAt:time(Date.now()+900000),storageGeneration:'7',uid:'u',rootId:'r',entityType:'solicitud',entityId:'s',documentId:'d',storagePath:'roots/r/solicitudes/s/docs/PDF/a.pdf',fileName:'a.pdf',attempts:0});
function harness() {
  const rows = new Map([
    ['telegramActionTokens/'+'a'.repeat(43), active()], ['users/u',{role:'admin',active:true,rootId:'r'}],
    ['solicitudes/s',{rootId:'r',adminId:'u',clienteId:'c'}], ['clients/c',{rootId:'r'}],
    ['uploads/d',{rootId:'r',active:true,solicitudId:'s',storagePath:active().storagePath}],
    ['userClientAccess/u/clients/c',{active:true,permissions:{operateSolicitudes:true}}],
  ]);
  const deleted = Symbol('delete'); const logs=[]; const streams=[]; const generations=[];
  let chain=Promise.resolve(); let disabled=false; let roleAllowed=true; let delegationAllowed=true;
  const ref = p => ({path:p,get:async()=>({data:()=>rows.get(p)}), create:async value=>rows.set(p,value)});
  const transaction = {get:async r=>({data:()=>rows.get(r.path)}),update:(r,patch)=>{const row=rows.get(r.path); for(const [k,v] of Object.entries(patch)){ if(v===deleted) delete row[k]; else row[k]=v; }}};
  const db = {collection:c=>({doc:id=>ref(c+'/'+id)}),doc:ref,runTransaction:fn=>{const result=chain.then(()=>fn(transaction));chain=result.catch(()=>{});return result;}};
  const firestore = ()=>db;
  firestore.FieldValue={delete:()=>deleted,serverTimestamp:()=>time(Date.now())};
  firestore.Timestamp={fromDate:d=>time(d.getTime()),fromMillis:time};
  const admin={apps:[{}],firestore,auth:()=>({getUser:async()=>({disabled})}),storage:()=>({bucket:()=>({file:(p,options)=>{generations.push(options?.generation);return {getMetadata:async()=>[{generation:'7',contentType:'application/pdf'}],createReadStream:()=>{const s=new PassThrough();streams.push(s);return s;}};}})})};
  const app=load('functions/src/modules/telegram/actionTokens.ts', {
    'firebase-admin':admin,'firebase-functions':{logger:{error:(...args)=>logs.push(args)}},
    'firebase-functions/v2/https':{onRequest:(_opts,handler)=>handler},
    '../../utils/authGuard':{assertAuthorized:(_auth,user)=>{if(!roleAllowed||!user||user.active===false)throw Object.assign(Error('PRIVATE_BEARER'),{code:'permission-denied'});return user.role;}},
    '../clientDelegations/access':{requireClientOperationalAccess:async()=>{if(!delegationAllowed)throw Object.assign(Error('denied'),{code:'permission-denied'});return {source:'DELEGATED'};},normalizeClientAccessPermissions:p=>p||{}},
    '../clientDelegations/policy':{delegationIsCurrent:g=>!!g?.active&&!g.revokedAt&&(!g.expiresAt||g.expiresAt.toMillis()>Date.now())},
    './downloadTokenPolicy':policy,
  });
  const response=()=>{const r=new Writable({write(_chunk,_encoding,cb){r.headersSent=true;cb();}});r.headersSent=false;r.statusCode=200;r.headers={};r.setHeader=(k,v)=>r.headers[k]=v;r.status=s=>{r.statusCode=s;return r;};r.send=body=>{r.end(body);return r;};return r;};
  const request=()=>({method:'GET',headers:{},query:{token:'a'.repeat(43)}});
  return {app,rows,logs,streams,generations,response,request,setDisabled:v=>disabled=v,setDelegation:v=>delegationAllowed=v};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function waitStream(h,n=1){for(let i=0;i<30&&h.streams.length<n;i++)await tick();assert.equal(h.streams.length,n);}

test('TTL boundary, revoked, legacy, exhausted, leased and consumed tokens deny',()=>{
  const row=active(); assert.doesNotThrow(()=>policy.assertDownloadAvailable(row,Date.now()));
  for(const patch of [{expiresAt:time(100)},{revokedAt:time(1)},{storageGeneration:null},{attempts:3},{leaseUntil:time(Date.now()+99999)},{status:'CONSUMED'}]) assert.throws(()=>policy.assertDownloadAvailable({...row,...patch},100));
  for(const ttl of [0,16,Infinity,NaN,'15'])assert.throws(()=>policy.downloadTtlMinutes(ttl));
  assert.equal(policy.downloadTtlMinutes(undefined),15);
});
test('parallel requests acquire one lease, pin generation and consume successful transfer',async()=>{
 const h=harness(),a=h.response(),b=h.response();const pa=h.app.telegramDownloadAction(h.request(),a);await waitStream(h);
 await h.app.telegramDownloadAction(h.request(),b);assert.equal(b.statusCode,409);assert.equal(h.streams.length,1);
 h.streams[0].end('PDF');await pa;assert.equal(h.rows.get('telegramActionTokens/'+'a'.repeat(43)).status,'CONSUMED');assert.equal(h.generations[0],'7');
 const c=h.response();await h.app.telegramDownloadAction(h.request(),c);assert.equal(c.statusCode,403);
});
test('interrupted transfer retries at most three times and logs no raw error or token',async()=>{
 const h=harness();
 for(let i=1;i<=3;i++){const res=h.response();const p=h.app.telegramDownloadAction(h.request(),res);await waitStream(h,i);h.streams[i-1].destroy(Error('PRIVATE_BEARER '+ 'a'.repeat(43)));await p;}
 const res=h.response();await h.app.telegramDownloadAction(h.request(),res);assert.equal(res.statusCode,410);assert.equal(h.streams.length,3);
 assert.ok(!JSON.stringify(h.logs).includes('PRIVATE_BEARER'));assert.ok(!JSON.stringify(h.logs).includes('a'.repeat(43)));
});
test('disabled identity, wrong object, root or inactive upload cannot stream',async()=>{
 for(const mutate of [h=>h.setDisabled(true),h=>h.rows.get('uploads/d').storagePath='other',h=>h.rows.get('solicitudes/s').rootId='other',h=>h.rows.get('uploads/d').active=false,h=>h.rows.get('users/u').active=false]){
 const h=harness();mutate(h);const res=h.response();await h.app.telegramDownloadAction(h.request(),res);assert.equal(res.statusCode,403);assert.equal(h.streams.length,0);
 }
});
test('current delegated user can download; revoked or expired delegation denies',async()=>{
 for(const state of ['current','revoked','expired']){const h=harness();h.rows.get('solicitudes/s').adminId='other';const grant=h.rows.get('userClientAccess/u/clients/c');if(state==='revoked')grant.revokedAt=time(1);if(state==='expired')grant.expiresAt=time(1);
 const res=h.response();const p=h.app.telegramDownloadAction(h.request(),res);if(state==='current'){await waitStream(h);h.streams[0].end('PDF');}await p;assert.equal(res.statusCode,state==='current'?200:403);}
});
test('revocation during stream is never overwritten by settlement',async()=>{
 const h=harness(),res=h.response();const p=h.app.telegramDownloadAction(h.request(),res);await waitStream(h);h.rows.get('telegramActionTokens/'+'a'.repeat(43)).status='REVOKED';h.streams[0].end('PDF');await p;assert.equal(h.rows.get('telegramActionTokens/'+'a'.repeat(43)).status,'REVOKED');
});
