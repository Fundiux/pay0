// Synthetic database, real authorization and delegation modules. No credentials/network.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
global.fetch=async()=>{throw Error('NETWORK_FORBIDDEN');};
const realDateNow=Date.now; Date.now=()=>1790000000000;
const compiled=new Map();
class HttpsError extends Error{constructor(code,message,details){super(message);this.code=code;this.details=details;}}
class Timestamp{constructor(seconds,nanoseconds){this.seconds=seconds;this.nanoseconds=nanoseconds;}}
function clone(value){if(value instanceof Timestamp)return new Timestamp(value.seconds,value.nanoseconds);if(Array.isArray(value))return value.map(clone);if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clone(v)]));return value;}
function setup(){
 const rows=new Map([['users/u',{role:'operador',rootId:'r',active:true}],['users/g',{role:'superadmin',rootId:'r',active:true}],['clients/c',{rootId:'r',active:true,adminId:'owner'}],['pagos/d',{rootId:'r',clientId:'c'}],['userClientAccess/u/clients/c',{active:true,grantedBy:'g',permissions:{operatePagos:true}}]]);
 for(let i=0;i<125;i++) rows.set('pagos/d/notas/n'+String(i).padStart(3,'0'),{text:'note'+i,createdAt:new Timestamp(100+Math.floor(i/3),0),authorName:'Author',financialPayload:'NEVER_RETURN'});
 let reads=0,queries=0,transactions=0,race=null; const versions=new Map(); const readPaths=[];
 const snap=p=>({id:p.split('/').at(-1),exists:rows.has(p),ref:ref(p),updateTime:versions.get(p)||new Timestamp(1700000000,1000),data:()=>clone(rows.get(p))});
 function ref(p){return{path:p,id:p.split('/').at(-1)};}
 function query(name,limit=1000,after=null){return{name,limitCount:limit,after,doc:id=>ref(name+'/'+id),orderBy:()=>query(name,limit,after),limit:n=>query(name,n,after),startAfter:anchor=>query(name,limit,{...anchor.data().createdAt,id:anchor.id})};}
 const cmp=(a,b)=>(a.time?.seconds||0)-(b.time?.seconds||0)||(a.time?.nanoseconds||0)-(b.time?.nanoseconds||0)||Buffer.compare(Buffer.from(a.id),Buffer.from(b.id));
 const db={doc:ref,collection:query,runTransaction:async(fn,options)=>{assert.equal(options.maxAttempts,3);transactions++;if(transactions===2&&race)race();return fn({get:async q=>{if(q.path){reads++;readPaths.push({transaction:transactions,path:q.path});return snap(q.path);}queries++;const docs=[...rows.keys()].filter(p=>p.startsWith(q.name+'/')&&p.split('/').length===q.name.split('/').length+1).map(p=>({p,id:p.split('/').at(-1),time:rows.get(p).createdAt})).filter(x=>x.time!==undefined&&(!q.after||cmp(x,{id:q.after.id,time:q.after})<0)).sort((a,b)=>-cmp(a,b)).slice(0,q.limitCount).map(x=>snap(x.p));reads+=docs.length;return{docs,size:docs.length};}});}};
 const admin={apps:[{}],firestore:()=>db},cache=new Map();
 function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const result={};cache.set(file,result);let code=compiled.get(file);if(!code){code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;compiled.set(file,code);}new Function('exports','require',code)(result,n=>{if(n==='firebase-admin')return admin;if(n==='firebase-admin/firestore')return{Timestamp,FieldPath:{documentId:()=> '__name__'}};if(n==='firebase-functions/v2/https')return{HttpsError,onCall:(_o,fn)=>fn};if(n==='firebase-functions')return{https:{HttpsError}};assert.ok(n.startsWith('.'),'unexpected dependency '+n);return load(path.resolve(path.dirname(file),n+'.ts'));});return result;}
 const api=load('functions/src/modules/notes/pagoReads.ts');
 return{rows,versions,readPaths,invoke:api.listPagoNotes,display:api.noteDisplayDate,call:(data={pagoId:'d',limit:50})=>api.listPagoNotes({auth:{uid:'u'},data}),race:fn=>race=fn,get reads(){return reads;},get queries(){return queries;},get transactions(){return transactions;},core:(data,batch)=>api.readPagoNotes({auth:{uid:"u"},data:{pagoId:"d",limit:50,...data}},batch)};
}
const parent=s=>s.rows.get('pagos/d'), user=s=>s.rows.get('users/u'), grant=s=>s.rows.get('userClientAccess/u/clients/c');
const denied=e=>e.code==='permission-denied';
for(const role of ['superadmin','admin','operador'])test('same-root direct authority '+role,async()=>{const s=setup();user(s).role=role;parent(s)[role==='admin'?'adminId':'createdBy']='u';s.rows.delete('userClientAccess/u/clients/c');assert.equal((await s.call()).items.length,50);assert.equal(s.transactions,2);});
for(const field of ['ownerId','operationalOwnerId','operadorId'])test(field+' alone does not grant pago authority',async()=>{const s=setup();parent(s)[field]='u';s.rows.delete('userClientAccess/u/clients/c');await assert.rejects(s.call(),denied);assert.equal(s.queries,0);});
for(const root of [undefined,null,'','   ',17,'foreign'])test('root fails before notes '+String(root),async()=>{const s=setup();user(s).role='superadmin';parent(s).createdBy='u';if(root===undefined)delete parent(s).rootId;else parent(s).rootId=root;await assert.rejects(s.call(),e=>root==='foreign'?denied(e):e.code==='failed-precondition'&&e.details?.reason==='ROOT_SCOPE_UNVERIFIED');assert.equal(s.queries,0);});
test('request root and parent ownership cannot repair missing stored root',async()=>{const s=setup();delete parent(s).rootId;parent(s).createdBy='u';await assert.rejects(s.call({pagoId:'d',rootId:'r'}),e=>e.details?.reason==='ROOT_SCOPE_UNVERIFIED');});
test('delegated operatePagos and explicit false override',async()=>{const s=setup();assert.equal((await s.call()).items.length,50);grant(s).permissions={operate:true,operatePagos:false};await assert.rejects(s.call(),denied);grant(s).permissions={operate:true};assert.equal((await s.call()).items.length,50);grant(s).permissions={viewBasic:true,operate:false};await assert.rejects(s.call(),denied);});
test('second distinct alias remains a legitimate OR path',async()=>{const s=setup();parent(s).clientId='missing';parent(s).clienteId='c';assert.equal((await s.call()).items.length,50);});
test('infrastructure failure is not hidden by an alternative alias',async()=>{const s=setup();parent(s).clienteId='other';Object.defineProperty(s.rows.get('clients/c'),'active',{get(){throw Error('SYNTHETIC_IO_FAILURE')},enumerable:true});await assert.rejects(s.call(),/SYNTHETIC_IO_FAILURE/);assert.equal(s.queries,0);});
for(const flag of ['active','isActive','disabled','deleted'])test('actor lifecycle '+flag,async()=>{const s=setup();parent(s).createdBy='u';user(s)[flag]=['active','isActive'].includes(flag)?false:true;await assert.rejects(s.call(),denied);assert.equal(s.queries,0);});
test('module view does not require cancel or comment',async()=>{const s=setup();parent(s).createdBy='u';user(s).modules={pagos:{view:true,cancel:false,comment:false}};assert.equal((await s.call()).items.length,50);user(s).modules.pagos.view=false;await assert.rejects(s.call(),denied);});
test('active trusted restriction applies to direct owner',async()=>{const s=setup();parent(s).createdBy='u';user(s).trustedRestrictionV1={schemaVersion:1,writer:'PAY0_TRUSTED_RESTRICTION_WRITER@1',policyVersion:'PAY0-CONTAINMENT@1',restrictionId:'restriction',rootId:'r',subjectUid:'u',state:'ACTIVE',scope:'ACCOUNT_OPERATIONS',authority:'HUMAN_SECURITY_ADMIN',authorityUid:'reviewer',reasonCode:'SECURITY_REVIEW',incidentId:'incident',issuedAtMs:Date.now()-1,expiresAtMs:Date.now()+1000,authorizationVersion:1};await assert.rejects(s.call(),denied);});
test('grantor lifecycle, expired and revoked delegation deny',async()=>{for(const mutate of [s=>s.rows.get('users/g').active=false,s=>grant(s).expiresAt=Date.now(),s=>grant(s).revokedAt=Date.now(),s=>grant(s).grantedBy='u']){const s=setup();mutate(s);await assert.rejects(s.call(),denied);assert.equal(s.queries,0);}});
test('legacy missing grantor provenance retains canonical compatibility only',async()=>{const s=setup();delete grant(s).grantedBy;assert.equal((await s.call()).items.length,50);});
for(const mutate of [s=>grant(s).active=false,s=>user(s).active=false,s=>parent(s).rootId='foreign',s=>parent(s).clienteId='new',s=>parent(s).createdBy='new'])test('fresh transaction denies changed authority or binding '+String(mutate),async()=>{const s=setup();s.race(()=>mutate(s));await assert.rejects(s.call(),denied);assert.ok(s.queries>0);});
test('125 notes cursor prefix, projection, counts and no writes',async()=>{const s=setup();const ids=[];let cursor;do{const page=await s.call({pagoId:'d',limit:17,...(cursor?{cursor}:{})});ids.push(...page.items.map(x=>x.id));assert.ok(page.items.every(x=>!('financialPayload'in x)));if(page.nextCursor)assert.equal(page.nextCursor.pagoId,'d');cursor=page.nextCursor;}while(cursor);assert.equal(ids.length,125);assert.equal(new Set(ids).size,125);assert.deepEqual(ids,Array.from({length:125},(_,i)=>'n'+String(124-i).padStart(3,'0')));assert.equal(parent(s).hasUnreadMsg,undefined);});
test('foreign and dispersion cursor rejected before authorization',async()=>{const s=setup(),page=await s.call();for(const cursor of [{...page.nextCursor,pagoId:'other'},{version:2,dispersionId:'d',id:'n100',updateSeconds:1,updateNanoseconds:0}])await assert.rejects(s.call({pagoId:'d',cursor}),e=>e.code==='invalid-argument');});
test('changed and deleted anchor fails before next query',async()=>{for(const remove of [false,true]){const s=setup(),page=await s.call();const before=s.queries;const p='pagos/d/notas/'+page.nextCursor.id;if(remove)s.rows.delete(p);else s.versions.set(p,new Timestamp(1700000001,0));await assert.rejects(s.call({pagoId:'d',cursor:page.nextCursor}),e=>e.code==='failed-precondition');assert.equal(s.queries,before);}});
test('stored whitespace note ids preserved by native cursor',async()=>{const s=setup();s.rows.set('pagos/d/notas/  ',{text:'space',createdAt:new Timestamp(500,0)});const p=await s.call({pagoId:'d',limit:1});assert.equal(p.nextCursor.id,'  ');assert.equal((await s.call({pagoId:'d',limit:1,cursor:p.nextCursor})).items[0].id,'n124');});
test('byte cut resumes last delivered note without truncation',async()=>{const s=setup();for(let i=0;i<9;i++)s.rows.set('pagos/d/notas/z'+i,{text:'x'.repeat(1048400),createdAt:new Timestamp(700,0)});const first=await s.call();assert.equal(first.items.length,8);assert.ok(first.items.every(x=>x.text.length===1048400));assert.equal(first.nextCursor.id,first.items.at(-1).id);const next=await s.call({pagoId:'d',cursor:first.nextCursor});assert.equal(next.items[0].id,'z0');});
test('single synthetic oversized note fails explicitly',async()=>{const s=setup();s.rows.get('pagos/d/notas/n124').text='\u0001'.repeat(1500000);await assert.rejects(s.call(),e=>e.code==='resource-exhausted');});
test('bounded limits and unauthenticated requests',async()=>{const s=setup();await assert.rejects(s.invoke({data:{pagoId:'d'}}),e=>e.code==='unauthenticated');for(const limit of [0,101,1.5,'10'])await assert.rejects(s.call({pagoId:'d',limit}),e=>e.code==='invalid-argument');});
test('rootless details require valid actor and module first',async()=>{for(const mutate of [s=>user(s).active=false,s=>user(s).modules={pagos:{view:false}},s=>s.rows.delete('users/u')]){const s=setup();delete parent(s).rootId;mutate(s);await assert.rejects(s.call(),e=>denied(e)&&e.details?.reason!=='ROOT_SCOPE_UNVERIFIED');assert.equal(s.queries,0);}});
test('absent parent and foreign explicit root remain generic',async()=>{for(const mutate of [s=>s.rows.delete('pagos/d'),s=>parent(s).rootId='foreign']){const s=setup();mutate(s);await assert.rejects(s.call(),e=>denied(e)&&e.details===undefined&&!e.message.includes('foreign'));assert.equal(s.queries,0);}});
for(const alias of [false,0,{},[],true,123])test('nonstring alias never coerces '+JSON.stringify(alias),async()=>{const s=setup();parent(s).clientId=alias;delete parent(s).clienteId;s.rows.set('clients/'+String(alias),{rootId:'r',active:true,managedByUserId:'u'});await assert.rejects(s.call(),denied);assert.equal(s.queries,0);});
test('rootless unrelated actor including delegated and superadmin gets generic denial',async()=>{for(const role of ['operador','superadmin']){const s=setup();user(s).role=role;delete parent(s).rootId;await assert.rejects(s.call(),e=>denied(e)&&e.details===undefined);assert.equal(s.queries,0);}});
test('rootless admin link may surface fixed reason without authorizing notes',async()=>{const s=setup();parent(s).adminId='u';delete parent(s).rootId;await assert.rejects(s.call(),e=>e.code==='failed-precondition'&&e.details?.reason==='ROOT_SCOPE_UNVERIFIED');assert.equal(s.queries,0);});

for(const depth of [16,17])test('canonical ancestor bound '+depth,async()=>{
 const s=setup();
 for(let i=0;i<depth;i++){
  const uid=i===0?'u':'a'+i,next=i===depth-1?'g':'a'+(i+1);
  s.rows.set('users/'+uid,{role:i===0?'operador':'admin',rootId:'r',active:true});
  s.rows.set('userClientAccess/'+uid+'/clients/c',{active:true,grantedBy:next,permissions:{operate:true,operatePagos:true}});
 }
 if(depth===16)assert.equal((await s.call()).items.length,50);else await assert.rejects(s.call(),denied);
});
test('Solicitud-only granular permission never grants Pago notes',async()=>{const s=setup();grant(s).permissions={operate:false,operateSolicitudes:true,viewBasic:true};await assert.rejects(s.call(),denied);assert.equal(s.queries,0);});

for(const [kind,revoke] of [
 ['missing',s=>s.rows.delete('users/u')],
 ['inactive',s=>s.rows.get('users/u').active=false],
 ['module',s=>s.rows.get('users/u').modules={pagos:{view:false}}],
])for(const second of [false,true])test('profile precedes parent reads '+kind+' second='+second,async()=>{
 const s=setup();if(second)s.race(()=>revoke(s));else revoke(s);
 await assert.rejects(s.call(),e=>e.code==='permission-denied');
 const paths=s.readPaths.filter(x=>x.transaction===(second?2:1)).map(x=>x.path);
 assert.deepEqual(paths,['users/u']);
 assert.equal(s.transactions,second?2:1);
 if(second)assert.ok(s.queries>0);else assert.equal(s.queries,0);
});
