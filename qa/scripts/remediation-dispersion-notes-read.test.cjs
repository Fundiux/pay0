// Execute the real callable and canonical authorization/lineage modules. No network.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
global.fetch=async()=>{throw Error('NETWORK_FORBIDDEN');};
const realDateNow=Date.now; Date.now=()=>1790000000000;
const compiled=new Map();
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
class Timestamp{constructor(seconds,nanoseconds){this.seconds=seconds;this.nanoseconds=nanoseconds;}}
function setup(){
 const rows=new Map([['users/u',{role:'operador',rootId:'r',active:true}],['users/g',{role:'superadmin',rootId:'r',active:true}],['clients/c',{rootId:'r',active:true,adminId:'owner'}],['clientDispersions/d',{rootId:'r',clientId:'c'}],['userClientAccess/u/clients/c',{active:true,grantedBy:'g',permissions:{viewBasic:true}}]]);
 for(let i=0;i<125;i++) rows.set('clientDispersions/d/notas/n'+String(i).padStart(3,'0'),{text:'note'+i,createdAt:{seconds:100+Math.floor(i/3),nanoseconds:0},authorName:'Author',financialPayload:'NEVER_RETURN'});
 let reads=0,queries=0,transactions=0,race=null;
 const snap=p=>({id:p.split('/').at(-1),exists:rows.has(p),ref:ref(p),data:()=>structuredClone(rows.get(p))});
 function ref(p){return{path:p,id:p.split('/').at(-1)};}
 function query(name,limit=1000,after=null){return{name,limitCount:limit,after,doc:id=>ref(name+'/'+id),orderBy:()=>query(name,limit,after),limit:n=>query(name,n,after),startAfter:(time,id)=>query(name,limit,{...time,id})};}
 const cmp=(a,b)=>a.time.seconds-b.time.seconds||a.time.nanoseconds-b.time.nanoseconds||Buffer.compare(Buffer.from(a.id),Buffer.from(b.id));
 const db={doc:ref,collection:query,runTransaction:async(fn,options)=>{assert.equal(options.maxAttempts,3);transactions++;if(transactions===2&&race)race();return fn({get:async q=>{if(q.path){reads++;return snap(q.path);}queries++;const docs=[...rows.keys()].filter(p=>p.startsWith(q.name+'/')&&p.split('/').length===q.name.split('/').length+1).map(p=>({p,id:p.split('/').at(-1),time:rows.get(p).createdAt})).filter(x=>x.time&&(!q.after||cmp(x,{id:q.after.id,time:q.after})<0)).sort((a,b)=>-cmp(a,b)).slice(0,q.limitCount).map(x=>snap(x.p));reads+=docs.length;return{docs,size:docs.length};}});}};
 const admin={apps:[{}],firestore:()=>db},cache=new Map();
 function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const result={};cache.set(file,result);let code=compiled.get(file);if(!code){code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;compiled.set(file,code);}new Function('exports','require',code)(result,n=>{if(n==='firebase-admin')return admin;if(n==='firebase-admin/firestore')return{Timestamp,FieldPath:{documentId:()=> '__name__'}};if(n==='firebase-functions/v2/https')return{HttpsError,onCall:(_o,fn)=>fn};if(n==='firebase-functions')return{https:{HttpsError}};assert.ok(n.startsWith('.'),'unexpected dependency '+n);return load(path.resolve(path.dirname(file),n+'.ts'));});return result;}
 const api=load('functions/src/modules/financing/noteReads.ts');
 return{rows,call:(data={dispersionId:'d',limit:50})=>api.listClientDispersionNotes({auth:{uid:'u'},data}),race:fn=>race=fn,get reads(){return reads;},get queries(){return queries;},get transactions(){return transactions;}};
}
test('real canonical delegated authority, DTO and complete stable pagination',async()=>{const s=setup(),ids=[];let cursor;do{const page=await s.call({dispersionId:'d',limit:17,...(cursor?{cursor}:{})});for(const row of page.items){assert.equal(row.financialPayload,undefined);ids.push(row.id);}cursor=page.nextCursor;}while(cursor);assert.equal(ids.length,125);assert.equal(new Set(ids).size,125);assert.equal(ids[0],'n124');assert.equal(ids.at(-1),'n000');});
for(const [name,change] of [['inactive actor',s=>s.rows.get('users/u').active=false],['restriction actor',s=>s.rows.get('users/u').trustedRestrictionV1={}],['root mismatch',s=>s.rows.get('clientDispersions/d').rootId='foreign'],['grantor revoked',s=>s.rows.get('users/g').active=false],['grantor restricted',s=>s.rows.get('users/g').trustedRestrictionV1={}],['grant inactive',s=>s.rows.get('userClientAccess/u/clients/c').active=false],['permission revoked',s=>s.rows.get('userClientAccess/u/clients/c').permissions.viewBasic=false]])test(name+' denies before reading notes',async()=>{const s=setup();change(s);await assert.rejects(s.call(),e=>e.code==='permission-denied');assert.equal(s.queries,0);});
for(const [name,change] of [['ancestor revocation',s=>s.rows.get('users/g').active=false],['scope rebound',s=>{s.rows.get('clientDispersions/d').createdBy='u';s.rows.get('clientDispersions/d').clientId='new';}],['actor restricted',s=>s.rows.get('users/u').trustedRestrictionV1={}]])test('second transaction blocks '+name,async()=>{const s=setup();s.race(()=>change(s));await assert.rejects(s.call(),e=>e.code==='permission-denied');assert.equal(s.queries,1);assert.equal(s.transactions,2);});
test('distinct aliases retain OR authorization',async()=>{const s=setup();s.rows.get('clientDispersions/d').clientId='unavailable';s.rows.get('clientDispersions/d').clienteId='c';assert.equal((await s.call()).items.length,50);});
test('direct document owner does not require universal client grant',async()=>{const s=setup();s.rows.get('clientDispersions/d').createdBy='u';s.rows.delete('userClientAccess/u/clients/c');assert.equal((await s.call()).items.length,50);});
test('USER funding preserves holder and root boundary',async()=>{const s=setup(),parent=s.rows.get('clientDispersions/d');Object.assign(parent,{ownerUid:'u',fundingSource:{holderType:'USER',ownerUid:'u',sourceClientId:'c'}});s.rows.delete('userClientAccess/u/clients/c');assert.equal((await s.call()).items.length,50);parent.ownerUid='other';await assert.rejects(s.call(),e=>e.code==='permission-denied');});
test('forged and malformed cursors rejected',async()=>{for(const cursor of [null,{}, {version:1,dispersionId:'other',id:'n001',seconds:100,nanoseconds:0},{version:1,dispersionId:'d',id:'n001',seconds:100,nanoseconds:1e9},{version:1,dispersionId:'d',id:'../x',seconds:100,nanoseconds:0},{version:1,dispersionId:'d',id:'n001',seconds:101,nanoseconds:0}]){const s=setup();await assert.rejects(s.call({dispersionId:'d',cursor}),e=>['invalid-argument','failed-precondition'].includes(e.code));assert.equal(s.queries,0);}});
test('canonical sixteen-ancestor limit remains bounded',async()=>{const s=setup();for(let i=0;i<17;i++){const uid=i?'a'+i:'u',next='a'+(i+1);s.rows.set('users/'+uid,{role:'admin',rootId:'r',active:true,modules:{usuarios:{view:true,clientDelegations:true},wallet:{view:true,dispersiones:true}}});s.rows.set('userClientAccess/'+uid+'/clients/c',{active:true,grantedBy:next});}await assert.rejects(s.call(),e=>e.code==='permission-denied');assert.equal(s.queries,0);assert.ok(s.reads<70);});
test('sixteen delegated hops to an actual superadmin terminal remain legitimate',async()=>{const s=setup();for(let i=0;i<16;i++){const uid=i?'a'+i:'u',next=i===15?'g':'a'+(i+1);s.rows.set('users/'+uid,{role:'admin',rootId:'r',active:true,modules:{usuarios:{view:true,clientDelegations:true},wallet:{view:true,dispersiones:true}}});s.rows.set('userClientAccess/'+uid+'/clients/c',{active:true,grantedBy:next});}assert.equal((await s.call()).items.length,50);assert.ok(s.reads>=100&&s.reads<160,'bounded full lineage must really be traversed twice');});
test('expiry equality denied and future timestamp allowed with fixed clock',async()=>{const s=setup(),grant=s.rows.get('userClientAccess/u/clients/c');grant.expiresAt=Date.now();await assert.rejects(s.call(),e=>e.code==='permission-denied');grant.expiresAt=Date.now()+1;assert.equal((await s.call()).items.length,50);});
test('valid active trusted restriction denies even a superadmin',async()=>{const s=setup(),user=s.rows.get('users/u');user.role='superadmin';user.trustedRestrictionV1={schemaVersion:1,writer:'PAY0_TRUSTED_RESTRICTION_WRITER@1',policyVersion:'PAY0-CONTAINMENT@1',restrictionId:'restriction',rootId:'r',subjectUid:'u',state:'ACTIVE',scope:'ACCOUNT_OPERATIONS',authority:'HUMAN_SECURITY_ADMIN',authorityUid:'reviewer',reasonCode:'SECURITY_REVIEW',incidentId:'incident',issuedAtMs:Date.now()-1,expiresAtMs:Date.now()+1000,authorizationVersion:1};await assert.rejects(s.call(),e=>e.code==='permission-denied');assert.equal(s.queries,0);});
test('unexpected resolver infrastructure error is not converted into an alias permission success',async()=>{const s=setup();s.rows.get('clientDispersions/d').clientId='c';s.rows.get('clientDispersions/d').clienteId='other';Object.defineProperty(s.rows.get('clients/c'),'active',{get(){throw Error('SYNTHETIC_IO_FAILURE');},enumerable:true});await assert.rejects(s.call(),/SYNTHETIC_IO_FAILURE/);assert.equal(s.queries,0);});
test('precise read-call counts for a50-note poll: direct55 and simple delegated65',async()=>{const delegated=setup();await delegated.call();assert.equal(delegated.reads,65);const direct=setup();direct.rows.get('clientDispersions/d').createdBy='u';await direct.call();assert.equal(direct.reads,55);const paged=setup();const first=await paged.call();const previous=paged.reads;await paged.call({dispersionId:'d',limit:50,cursor:first.nextCursor});assert.equal(paged.reads-previous,66);});
// Explicit opt-in only. Admin bypasses deny-all Rules; this is NOT a Rules gate.
test('real Admin SDK/demo emulator:125 notes, tie cursors and authority race',{skip:process.env.PAY0_NOTES_REAL_SDK!=='1'},async()=>{
 Date.now=realDateNow; // gRPC deadlines must use the real clock; synthetic expiry tests above are fixed-clock.
 const project='demo-pay0-dispersion-notes';
 assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^127\.0\.0\.1:18246$/);
 for(const key of ['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT','GCP_PROJECT','GOOGLE_CLOUD_QUOTA_PROJECT','FIREBASE_PROJECT_ID']) if(process.env[key])assert.equal(process.env[key],project,'non-demo project forbidden');
 for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','FIREBASE_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN'])assert.ok(!process.env[key],'credential environment forbidden');
 if(process.env.FIREBASE_CONFIG){const config=JSON.parse(process.env.FIREBASE_CONFIG);assert.equal(config.projectId,project);}
 const req=require('node:module').createRequire(path.resolve('functions/package.json'));
 const realAdmin=req('firebase-admin'),firestore=req('firebase-admin/firestore');
 const app=realAdmin.initializeApp({projectId:project},'notes-gate');
 const db=realAdmin.firestore(app);
 let count=0,race=null,reads=0,queries=0;
 const wrapped={doc:p=>db.doc(p),collection:p=>db.collection(p),runTransaction:async(fn,options)=>{count++;if(count===2&&race)await race();return db.runTransaction(tx=>fn({get:async ref=>{if(ref.path)reads++;else queries++;return tx.get(ref);}}),options);}};
 const admin={apps:[app],firestore:()=>wrapped};
 const cache=new Map();
 function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const result={};cache.set(file,result);const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports','require',code)(result,n=>{if(n==='firebase-admin')return admin;if(n==='firebase-admin/firestore')return firestore;if(n==='firebase-functions/v2/https')return{HttpsError,onCall:(_o,fn)=>fn};if(n==='firebase-functions')return{https:{HttpsError}};assert.ok(n.startsWith('.'));return load(path.resolve(path.dirname(file),n+'.ts'));});return result;}
 try{
  const batch=db.batch();
  const data=[['users/u',{role:'operador',rootId:'r',active:true}],['users/g',{role:'superadmin',rootId:'r',active:true}],['clients/c',{rootId:'r',active:true,adminId:'owner'}],['clientDispersions/d',{rootId:'r',clientId:'c'}],['userClientAccess/u/clients/c',{active:true,grantedBy:'g',permissions:{viewBasic:true}}]];
  for(const[p,row]of data)batch.set(db.doc(p),row);
  for(let i=0;i<125;i++)batch.set(db.doc('clientDispersions/d/notas/n'+String(i).padStart(3,'0')),{text:'synthetic',createdAt:new firestore.Timestamp(100+Math.floor(i/3),(i%2)*1000)});
  await batch.commit();
  assert.equal((await db.doc("clientDispersions/d/notas/n001").get()).get("createdAt").nanoseconds,1000,"stored microsecond precision must match the fixture");
  const api=load('functions/src/modules/financing/noteReads.ts');
  const call=data=>api.listClientDispersionNotes({auth:{uid:'u'},data:{dispersionId:'d',limit:17,...data}});
  const ids=[];let cursor,first;
  do{const page=await call(cursor?{cursor}:{});first ||= page;ids.push(...page.items.map(row=>row.id));cursor=page.nextCursor;}while(cursor);
  assert.equal(ids.length,125);assert.equal(new Set(ids).size,125);
  const expected=Array.from({length:125},(_,i)=>({i,seconds:100+Math.floor(i/3),nanos:(i%2)*1000})).sort((a,b)=>b.seconds-a.seconds||b.nanos-a.nanos||b.i-a.i).map(x=>'n'+String(x.i).padStart(3,'0'));
  assert.deepEqual(ids,expected);
  await assert.rejects(call({cursor:{...first.nextCursor,dispersionId:'foreign'}}),e=>e.code==='invalid-argument');
  await assert.rejects(call({cursor:{...first.nextCursor,nanoseconds:999}}),e=>e.code==='failed-precondition');
  await db.doc('clientDispersions/d/notas/'+first.nextCursor.id).delete();
  await assert.rejects(call({cursor:first.nextCursor}),e=>e.code==='failed-precondition');
  count=0;race=()=>db.doc('users/g').update({active:false});
  await assert.rejects(call({}),e=>e.code==='permission-denied');
  assert.equal(count,2,'fresh authority transaction executed');
  const before=queries;race=null;
  await assert.rejects(call({}),e=>e.code==='permission-denied');
  assert.equal(queries,before,'revoked grantor blocks query');
  assert.ok(reads<200,'bounded real SDK authority reads');
  console.log('NOTES_REAL_SDK_PASS notes=125 distinct=125 authorityRace=denied cloud=0 rulesVerdict=NOT_TESTED');
 }finally{await db.terminate();await app.delete();}
});
test('string aliases follow canonical trimming without object coercion',async()=>{const s=setup();s.rows.get('clientDispersions/d').clientId=' c ';assert.equal((await s.call()).items.length,50);for(const value of [0,false,{id:'c'},['c']]){const other=setup();other.rows.get('clientDispersions/d').clientId=value;await assert.rejects(other.call(),e=>e.code==='permission-denied');assert.equal(other.queries,0);}});
test('deleted cursor anchor is rejected, not silently skipped',async()=>{const s=setup(),first=await s.call();s.rows.delete('clientDispersions/d/notas/'+first.nextCursor.id);const previous=s.queries;await assert.rejects(s.call({dispersionId:'d',cursor:first.nextCursor}),e=>e.code==='failed-precondition');assert.equal(s.queries,previous);});
test('primitive aliases match canonical cleanId for123/true and reject empty0/false',async()=>{for(const value of [123,true]){const s=setup(),id=String(value||'').trim();s.rows.set('clients/'+id,{...s.rows.get('clients/c')});s.rows.set('userClientAccess/u/clients/'+id,{...s.rows.get('userClientAccess/u/clients/c')});s.rows.get('clientDispersions/d').clientId=value;assert.equal((await s.call()).items.length,50);}for(const value of [0,false]){const s=setup();s.rows.get('clientDispersions/d').clientId=value;await assert.rejects(s.call(),e=>e.code==='permission-denied');s.rows.get('clientDispersions/d').clienteId='c';assert.equal((await s.call()).items.length,50);}const s=setup();s.rows.get('clientDispersions/d').clientId=123;s.rows.get('clientDispersions/d').clienteId=' c ';assert.equal((await s.call()).items.length,50);});
test('wallet action revocation applies before direct-owner bypass and after query',async()=>{const s=setup();s.rows.get('clientDispersions/d').createdBy='u';s.rows.get('users/u').modules={wallet:{view:true,dispersiones:false}};await assert.rejects(s.call(),e=>e.code==='permission-denied');assert.equal(s.queries,0);const raced=setup();raced.race(()=>raced.rows.get('users/u').modules={wallet:{view:true,dispersiones:false}});await assert.rejects(raced.call(),e=>e.code==='permission-denied');assert.equal(raced.queries,1);});