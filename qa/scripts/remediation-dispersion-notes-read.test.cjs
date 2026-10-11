// Separate HTTP client: its response buffers never enter the measured server heap.
if(process.argv.includes('--notes-http-client')){
 (async()=>{
 const assert=require('node:assert/strict'),http=require('node:http');
 assert.equal(process.env.PAY0_NOTES_REAL_SDK,'1');const port=Number(process.argv.at(-2)),scenario=process.argv.at(-1),nonce=process.env.PAY0_NOTES_HTTP_NONCE;
 assert.ok(Number.isInteger(port)&&port>1024&&port<65536);assert.match(nonce||'',/^[a-f0-9]{64}$/);assert.ok(['typical','large','wide','lineage'].includes(scenario));
 let pages=0,maxBytes=0,cursor;const ids=[];
 do{
 const input=JSON.stringify({data:{dispersionId:scenario==='large'?'bytes':scenario==='wide'?'wide':'typical',limit:50,...(cursor?{cursor}:{})}});
 const page=await new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:'/',method:'POST',headers:{'content-type':'application/json','content-length':Buffer.byteLength(input),authorization:'Bearer '+nonce}},res=>{const chunks=[];let length=0;res.on('data',data=>{length+=data.length;if(length>8388608){res.destroy();reject(Error('RESPONSE_BUDGET'));}else chunks.push(data);});res.on('error',reject);res.on('end',()=>{try{assert.equal(res.statusCode,200);maxBytes=Math.max(maxBytes,length);resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')).result);}catch(e){reject(e);}});});req.on('error',reject);req.setTimeout(60000,()=>req.destroy(Error('LOCAL_HTTP_TIMEOUT')));req.end(input);});
 pages++;if(scenario==='large'){assert.equal(page.items.length,1);assert.ok(/^\u0001+$/.test(page.items[0].text));assert.equal(page.items[0].text.length,1048400);}if(scenario==='wide')for(const row of page.items){assert.ok(/^x+$/.test(row.text));assert.equal(row.text.length,1048400);}
 ids.push(...page.items.map(x=>x.id));if(page.nextCursor)assert.equal(page.nextCursor.id,page.items.at(-1).id);cursor=['large','wide'].includes(scenario)?page.nextCursor:null;
 }while(cursor);
 assert.equal(ids.length,['large','wide'].includes(scenario)?9:50);assert.equal(new Set(ids).size,ids.length);if(['large','wide'].includes(scenario))assert.deepEqual(ids,Array.from({length:9},(_,i)=>'b'+(8-i)));if(scenario==='wide')assert.equal(pages,2);
 console.log(JSON.stringify({pages,maxBytes,items:ids.length}));
 })().catch(()=>{console.error('NOTES_HTTP_CLIENT_FAILED');process.exitCode=1;});
}else
// Fresh process: compiled product only, no TypeScript transpiler/fake fixture heap.
if(process.argv.includes('--notes-byte-child')){
 (async()=>{
 const assert=require('node:assert/strict'),path=require('node:path');
 const project='demo-pay0-dispersion-notes';assert.equal(process.env.PAY0_NOTES_REAL_SDK,'1');assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:18246');
 for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','FIREBASE_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN'])assert.ok(!process.env[key]);
 for(const key of ['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT','GCP_PROJECT','GOOGLE_CLOUD_QUOTA_PROJECT','FIREBASE_PROJECT_ID'])if(process.env[key])assert.equal(process.env[key],project);
 if(process.env.FIREBASE_CONFIG)assert.equal(JSON.parse(process.env.FIREBASE_CONFIG).projectId,project);
 const fullIndex=process.argv.includes('--full-index');
 const batch=Number(process.argv.at(-2)),scenario=process.argv.at(-1);assert.ok([4,8].includes(batch));assert.ok(['typical','large','wide','lineage'].includes(scenario));
 // Fail closed before transport, including metadata/credential discovery. No cloud.
 const net=require('node:net'),dns=require('node:dns');const connect=net.Socket.prototype.connect,lookup=dns.lookup;
 net.Socket.prototype.connect=function(...args){const o=Array.isArray(args[0])?args[0][0]:args[0];const host=typeof o==='object'?o.host:args[1],port=typeof o==='object'?o.port:o;assert.equal(host,'127.0.0.1','non-loopback transport forbidden');assert.equal(Number(port),18246,'unexpected transport port');return connect.apply(this,args);};
 dns.lookup=function(host,...args){assert.equal(host,'127.0.0.1','non-loopback DNS forbidden');return lookup.call(this,host,...args);};
 global.fetch=async()=>{throw Error('FETCH_FORBIDDEN');};
 const req=require('node:module').createRequire(path.resolve('functions/package.json')),admin=req('firebase-admin');const app=admin.initializeApp({projectId:project});const db=admin.firestore();
 let queries=0,documents=0,peakRss=0,peakHeap=0;const sample=()=>{const m=process.memoryUsage();peakRss=Math.max(peakRss,m.rss);peakHeap=Math.max(peakHeap,m.heapUsed);};
 const original=db.runTransaction.bind(db);db.runTransaction=(fn,opts)=>original(tx=>fn({get:async ref=>{const result=await tx.get(ref);if(ref.path)documents++;else{queries++;documents+=result.size;}sample();return result;}}),opts);
 const api=require(path.resolve('functions/lib/modules/financing/noteReads.js'));assert.equal(api.NOTES_RESPONSE_BYTES,8388608);assert.equal(typeof api.readClientDispersionNotes,'function');
 let callable=null,startupLogCount=0;
 if(fullIndex){assert.equal(batch,4);const saved={log:console.log,warn:console.warn,error:console.error};try{console.log=console.warn=console.error=()=>startupLogCount++;const entry=require(path.resolve('functions/lib/index.js'));assert.equal(Object.keys(entry).filter(k=>entry[k]?.__endpoint).length,347);callable=entry.listClientDispersionNotes;assert.equal(typeof callable.run,'function');}finally{Object.assign(console,saved);}}
 if(process.argv.includes('--http-server')){
 assert.ok(fullIndex);assert.equal(callable.__endpoint.concurrency,1);assert.equal(callable.__endpoint.availableMemoryMb,256);
 const frameworkRoot=path.resolve('.firebase/remediation-temp/notes-http-framework/node_modules/@google-cloud/functions-framework');assert.equal(require(path.join(frameworkRoot,'package.json')).version,'5.0.5');
 const {getServer}=require(path.join(frameworkRoot,'build/src/server.js')),{parseOptions}=require(path.join(frameworkRoot,'build/src/options.js'));
 const nonce=require('node:crypto').randomBytes(32).toString('hex');let verified=0;
 req('firebase-admin/auth').getAuth(app).verifyIdToken=async token=>{assert.equal(token,nonce,'synthetic token mismatch');verified++;return{uid:scenario==='lineage'?'chain':'u',sub:scenario==='lineage'?'chain':'u',aud:project,iss:'https://securetoken.google.com/'+project};};
 const server=getServer((request,response)=>{const end=response.end;response.end=function(...args){sample();const result=end.apply(this,args);sample();return result;};return callable(request,response);},parseOptions([],{FUNCTION_SIGNATURE_TYPE:'http',CLOUD_RUN_TIMEOUT_SECONDS:'60'}));
 const stdoutWrite=process.stdout.write,stderrWrite=process.stderr.write;let suppressedLogs=0;const discard=(...args)=>{suppressedLogs++;if(typeof args.at(-1)==='function')args.at(-1)();return true;};process.stdout.write=process.stderr.write=discard;
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));sample();const baseline=process.memoryUsage(),timer=setInterval(sample,5),started=performance.now();let result;
 try{
 result=await new Promise((resolve,reject)=>require('node:child_process').execFile(process.execPath,[__filename,'--notes-http-client',String(server.address().port),scenario],{cwd:process.cwd(),env:{...process.env,PAY0_NOTES_HTTP_NONCE:nonce},encoding:'utf8',timeout:120000,windowsHide:true},(error,stdout)=>{if(error)reject(Error('HTTP_CLIENT_EXIT'));else{try{resolve(JSON.parse(stdout.trim()));}catch{reject(Error('HTTP_CLIENT_FORMAT'));}}}));
 sample();assert.equal(verified,result.pages);const maxRssKiB=process.resourceUsage().maxRSS;
 const metrics={fullIndex:true,http:true,frameworkVersion:'5.0.5',batch,scenario,pages:result.pages,queries,documents,maxBytes:result.maxBytes,elapsedMs:Math.round(performance.now()-started),baselineRss:baseline.rss,peakRss,baselineHeap:baseline.heapUsed,peakHeap,maxRssKiB,verified,suppressedLogs};
 stdoutWrite.call(process.stdout,JSON.stringify(metrics)+'\n');assert.ok(peakRss<256*1024*1024,'HTTP sampled RSS exceeds256MiB');assert.ok(maxRssKiB<256*1024,'HTTP high-water RSS exceeds256MiB');
 }finally{process.stdout.write=stdoutWrite;process.stderr.write=stderrWrite;clearInterval(timer);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await db.terminate();await app.delete();}
 return;
 }
 sample();const baseline=process.memoryUsage(),timer=setInterval(sample,5),started=performance.now();let pages=0,maxBytes=0,cursor;const ids=[];
 try{
 do{
 const request={auth:{uid:scenario==='lineage'?'chain':'u'},data:{dispersionId:scenario==='large'?'bytes':scenario==='wide'?'wide':'typical',limit:50,...(cursor?{cursor}:{})}};
 const page=await (callable?callable.run(request):api.readClientDispersionNotes(request,batch));
 const encoded=JSON.stringify({result:page});sample();const bytes=Buffer.byteLength(encoded);assert.ok(bytes<=api.NOTES_RESPONSE_BYTES);maxBytes=Math.max(maxBytes,bytes);pages++;
 if(scenario==='large'){assert.equal(page.items.length,1);assert.equal(page.items[0].text.length,1048400);assert.ok(/^\u0001+$/.test(page.items[0].text));}
 if(scenario==='wide')for(const row of page.items){assert.equal(row.text.length,1048400);assert.ok(/^x+$/.test(row.text));}
 ids.push(...page.items.map(x=>x.id));if(page.nextCursor)assert.equal(page.nextCursor.id,page.items.at(-1).id);cursor=['large','wide'].includes(scenario)?page.nextCursor:null;
 }while(cursor);
 assert.equal(ids.length,['large','wide'].includes(scenario)?9:50);assert.equal(new Set(ids).size,ids.length);
 if(['large','wide'].includes(scenario))assert.deepEqual(ids,Array.from({length:9},(_,i)=>'b'+(8-i))); if(scenario==='wide')assert.equal(pages,2);
 const elapsedMs=performance.now()-started;sample();const maxRssKiB=process.resourceUsage().maxRSS;
 // A local single-request/process gate, not a claim about deployed concurrency.
 if(!fullIndex){assert.ok(peakRss<256*1024*1024,'sampled RSS exceeds declared Function memory');assert.ok(maxRssKiB<256*1024,'high-water RSS exceeds declared Function memory');}
 console.log(JSON.stringify({fullIndex,startupLogCount,batch,scenario,pages,queries,documents,maxBytes,elapsedMs:Math.round(elapsedMs),baselineRss:baseline.rss,peakRss,baselineHeap:baseline.heapUsed,peakHeap,maxRssKiB}));
 }finally{clearInterval(timer);await db.terminate();await app.delete();}
 })().catch(()=>{console.error('NOTES_BYTE_CHILD_FAILED');process.exitCode=1;});
}else{
// Execute the real callable and canonical authorization/lineage modules. No network.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
global.fetch=async()=>{throw Error('NETWORK_FORBIDDEN');};
const realDateNow=Date.now; Date.now=()=>1790000000000;
const compiled=new Map();
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
class Timestamp{constructor(seconds,nanoseconds){this.seconds=seconds;this.nanoseconds=nanoseconds;}}
function clone(value){if(value instanceof Timestamp)return new Timestamp(value.seconds,value.nanoseconds);if(Array.isArray(value))return value.map(clone);if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clone(v)]));return value;}
function setup(){
 const rows=new Map([['users/u',{role:'operador',rootId:'r',active:true}],['users/g',{role:'superadmin',rootId:'r',active:true}],['clients/c',{rootId:'r',active:true,adminId:'owner'}],['clientDispersions/d',{rootId:'r',clientId:'c'}],['userClientAccess/u/clients/c',{active:true,grantedBy:'g',permissions:{viewBasic:true}}]]);
 for(let i=0;i<125;i++) rows.set('clientDispersions/d/notas/n'+String(i).padStart(3,'0'),{text:'note'+i,createdAt:new Timestamp(100+Math.floor(i/3),0),authorName:'Author',financialPayload:'NEVER_RETURN'});
 let reads=0,queries=0,transactions=0,race=null; const versions=new Map();
 const snap=p=>({id:p.split('/').at(-1),exists:rows.has(p),ref:ref(p),updateTime:versions.get(p)||new Timestamp(1700000000,1000),data:()=>clone(rows.get(p))});
 function ref(p){return{path:p,id:p.split('/').at(-1)};}
 function query(name,limit=1000,after=null){return{name,limitCount:limit,after,doc:id=>ref(name+'/'+id),orderBy:()=>query(name,limit,after),limit:n=>query(name,n,after),startAfter:anchor=>query(name,limit,{...anchor.data().createdAt,id:anchor.id})};}
 const cmp=(a,b)=>(a.time?.seconds||0)-(b.time?.seconds||0)||(a.time?.nanoseconds||0)-(b.time?.nanoseconds||0)||Buffer.compare(Buffer.from(a.id),Buffer.from(b.id));
 const db={doc:ref,collection:query,runTransaction:async(fn,options)=>{assert.equal(options.maxAttempts,3);transactions++;if(transactions===2&&race)race();return fn({get:async q=>{if(q.path){reads++;return snap(q.path);}queries++;const docs=[...rows.keys()].filter(p=>p.startsWith(q.name+'/')&&p.split('/').length===q.name.split('/').length+1).map(p=>({p,id:p.split('/').at(-1),time:rows.get(p).createdAt})).filter(x=>x.time!==undefined&&(!q.after||cmp(x,{id:q.after.id,time:q.after})<0)).sort((a,b)=>-cmp(a,b)).slice(0,q.limitCount).map(x=>snap(x.p));reads+=docs.length;return{docs,size:docs.length};}});}};
 const admin={apps:[{}],firestore:()=>db},cache=new Map();
 function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const result={};cache.set(file,result);let code=compiled.get(file);if(!code){code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;compiled.set(file,code);}new Function('exports','require',code)(result,n=>{if(n==='firebase-admin')return admin;if(n==='firebase-admin/firestore')return{Timestamp,FieldPath:{documentId:()=> '__name__'}};if(n==='firebase-functions/v2/https')return{HttpsError,onCall:(_o,fn)=>fn};if(n==='firebase-functions')return{https:{HttpsError}};assert.ok(n.startsWith('.'),'unexpected dependency '+n);return load(path.resolve(path.dirname(file),n+'.ts'));});return result;}
 const api=load('functions/src/modules/financing/noteReads.ts');
 return{rows,versions,display:api.noteDisplayDate,call:(data={dispersionId:'d',limit:50})=>api.listClientDispersionNotes({auth:{uid:'u'},data}),race:fn=>race=fn,get reads(){return reads;},get queries(){return queries;},get transactions(){return transactions;},core:(data,batch)=>api.readClientDispersionNotes({auth:{uid:"u"},data:{dispersionId:"d",limit:50,...data}},batch)};
}
test('real canonical delegated authority, DTO and complete stable pagination',async()=>{const s=setup(),ids=[];let cursor;do{const page=await s.call({dispersionId:'d',limit:17,...(cursor?{cursor}:{})});for(const row of page.items){assert.equal(row.financialPayload,undefined);ids.push(row.id);}cursor=page.nextCursor;}while(cursor);assert.equal(ids.length,125);assert.equal(new Set(ids).size,125);assert.equal(ids[0],'n124');assert.equal(ids.at(-1),'n000');});
for(const [name,change] of [['inactive actor',s=>s.rows.get('users/u').active=false],['restriction actor',s=>s.rows.get('users/u').trustedRestrictionV1={}],['root mismatch',s=>s.rows.get('clientDispersions/d').rootId='foreign'],['grantor revoked',s=>s.rows.get('users/g').active=false],['grantor restricted',s=>s.rows.get('users/g').trustedRestrictionV1={}],['grant inactive',s=>s.rows.get('userClientAccess/u/clients/c').active=false],['permission revoked',s=>s.rows.get('userClientAccess/u/clients/c').permissions.viewBasic=false]])test(name+' denies before reading notes',async()=>{const s=setup();change(s);await assert.rejects(s.call(),e=>e.code==='permission-denied');assert.equal(s.queries,0);});
for(const [name,change] of [['ancestor revocation',s=>s.rows.get('users/g').active=false],['scope rebound',s=>{s.rows.get('clientDispersions/d').createdBy='u';s.rows.get('clientDispersions/d').clientId='new';}],['actor restricted',s=>s.rows.get('users/u').trustedRestrictionV1={}]])test('second transaction blocks '+name,async()=>{const s=setup();s.race(()=>change(s));await assert.rejects(s.call(),e=>e.code==='permission-denied');assert.equal(s.queries,13);assert.equal(s.transactions,2);});
test('distinct aliases retain OR authorization',async()=>{const s=setup();s.rows.get('clientDispersions/d').clientId='unavailable';s.rows.get('clientDispersions/d').clienteId='c';assert.equal((await s.call()).items.length,50);});
test('direct document owner does not require universal client grant',async()=>{const s=setup();s.rows.get('clientDispersions/d').createdBy='u';s.rows.delete('userClientAccess/u/clients/c');assert.equal((await s.call()).items.length,50);});
test('USER funding preserves holder and root boundary',async()=>{const s=setup(),parent=s.rows.get('clientDispersions/d');Object.assign(parent,{ownerUid:'u',fundingSource:{holderType:'USER',ownerUid:'u',sourceClientId:'c'}});s.rows.delete('userClientAccess/u/clients/c');assert.equal((await s.call()).items.length,50);parent.ownerUid='other';await assert.rejects(s.call(),e=>e.code==='permission-denied');});
test('forged and malformed cursors rejected',async()=>{for(const cursor of [null,{}, {version:2,dispersionId:'other',id:'n001',updateSeconds:100,updateNanoseconds:0},{version:2,dispersionId:'d',id:'n001',updateSeconds:100,updateNanoseconds:1e9},{version:2,dispersionId:'d',id:'../x',updateSeconds:100,updateNanoseconds:0},{version:2,dispersionId:'d',id:'n001',updateSeconds:101,updateNanoseconds:0}]){const s=setup();await assert.rejects(s.call({dispersionId:'d',cursor}),e=>['invalid-argument','failed-precondition'].includes(e.code));assert.equal(s.queries,0);}});
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
  await assert.rejects(call({cursor:{...first.nextCursor,updateNanoseconds:999}}),e=>e.code==='failed-precondition');
  await db.doc('clientDispersions/d/notas/'+first.nextCursor.id).delete();
  await assert.rejects(call({cursor:first.nextCursor}),e=>e.code==='failed-precondition');
  const readsBeforeTypes=reads;
  // Real stored types and exact IDs: structural DTO timestamps are not stored timestamps.
  await db.doc('clientDispersions/typed').set({rootId:'r',clientId:'c'});
  const typedIds=[' leading','trailing ','  '];
  for(let i=0;i<typedIds.length;i++)await db.doc('clientDispersions/typed/notas/'+typedIds[i]).set({text:'typed',createdAt:i===1?new Date(700000):new firestore.Timestamp(700,0)});
  await db.doc('clientDispersions/typed/notas/missing').set({text:'missing date remains excluded by orderBy'});
  assert.ok((await db.doc('clientDispersions/typed/notas/trailing ').get()).get('createdAt') instanceof firestore.Timestamp,'Date write is persisted as Timestamp');
  const typedSeen=[];let typedCursor,typedAnchor;
  do{const page=await call({dispersionId:'typed',limit:1,...(typedCursor?{cursor:typedCursor}:{})});typedSeen.push(...page.items.map(x=>x.id));typedAnchor ||= page.nextCursor;typedCursor=page.nextCursor;}while(typedCursor);
  assert.deepEqual(typedSeen,typedIds.sort((a,b)=>-Buffer.compare(Buffer.from(a),Buffer.from(b))));
  await db.doc('clientDispersions/typed/notas/'+typedAnchor.id).update({createdAt:{seconds:700,nanoseconds:0}});
  const beforeMapAnchor=queries;await assert.rejects(call({dispersionId:'typed',cursor:typedAnchor}),e=>e.code==='failed-precondition');assert.equal(queries,beforeMapAnchor);
  // Compare native Firestore ordering itself, never a client-side mixed-type comparator.
  await db.doc('clientDispersions/mixed').set({rootId:'r',clientId:'c'});
  const mixed=[['map',{seconds:700,nanoseconds:0,privateField:'DO_NOT_EXPOSE'}],['second-map',{seconds:700,nanoseconds:0}],['string','2026-10-10T13:45:00'],['null',null],['number',700],['bool',true],['false',false],['array',['2026-10-10']],['date',new Date(700000)],['native',new firestore.Timestamp(600,0)]];
  for(const [id,value]of mixed)await db.doc('clientDispersions/mixed/notas/'+id).set({text:'synthetic',createdAt:value});
  const ordered=db.collection('clientDispersions/mixed/notas').orderBy('createdAt','desc').orderBy(firestore.FieldPath.documentId(),'desc');
  const nativeDocs=(await ordered.get()).docs;
  const maps=nativeDocs.filter(x=>x.get('createdAt')?.seconds===700&&!(x.get('createdAt') instanceof firestore.Timestamp));
  assert.equal(maps.length,2);
  const wrongTypeRemainder=await ordered.startAfter(new firestore.Timestamp(700,0),maps[0].id).get();
  assert.ok(!wrongTypeRemainder.docs.some(x=>x.id===maps[1].id),'negative control: fabricated Timestamp skips another map');
  const seenMixed=[];let mixedCursor;let mixedCalls=0;
  do{const page=await call({dispersionId:'mixed',limit:1,...(mixedCursor?{cursor:mixedCursor}:{})});mixedCalls++;
   for(const row of page.items){seenMixed.push(row.id);assert.equal(row.createdAt,undefined);assert.ok(!JSON.stringify(row).includes('DO_NOT_EXPOSE'));}
   mixedCursor=page.nextCursor;
  }while(mixedCursor);
  assert.deepEqual(seenMixed,nativeDocs.map(x=>x.id));assert.equal(mixedCalls,10);
  const typeReads=reads-readsBeforeTypes;
  // Three whitespace pages:42 authority +2 anchors; changed anchor:7+1;
  // ten mixed pages:140 authority +9 anchors. Queries counted separately.
  assert.equal(typeReads,201,'explicit authority/anchor reads for stored-type/ID cases');
  console.log('NOTES_STORED_TYPES_PASS mixedNativeOrder=10 whitespaceIds=3 changedAnchor=denied missingDate=excludedByOrderBy');
  count=0;race=()=>db.doc('users/g').update({active:false});
  await assert.rejects(call({}),e=>e.code==='permission-denied');
  assert.equal(count,2,'fresh authority transaction executed');
  const before=queries;race=null;
  await assert.rejects(call({}),e=>e.code==='permission-denied');
  assert.equal(queries,before,'revoked grantor blocks query');
  assert.ok(reads-typeReads<200,'bounded original real SDK authority reads');

  if(process.env.PAY0_NOTES_SKIP_RESOURCE_BENCHMARKS!=='1'){
  // Legal near-limit documents: persist first, then measure fresh compiled workers.
  await db.doc('users/g').update({active:true});
  const fixtures=db.batch();
  for(const id of ['bytes','typical','wide'])fixtures.set(db.doc('clientDispersions/'+id),{rootId:'r',clientId:'c'});
  for(let i=0;i<60;i++)fixtures.set(db.doc('clientDispersions/typical/notas/t'+String(i).padStart(3,'0')),{text:'synthetic',createdAt:new firestore.Timestamp(500+i,0)});
  for(let i=0;i<16;i++){const uid=i?'chain'+i:'chain',next=i===15?'g':'chain'+(i+1);fixtures.set(db.doc('users/'+uid),{role:'admin',rootId:'r',active:true,modules:{usuarios:{view:true,clientDelegations:true},wallet:{view:true,dispersiones:true}}});fixtures.set(db.doc('userClientAccess/'+uid+'/clients/c'),{active:true,grantedBy:next});}
  await fixtures.commit();
  for(let i=0;i<9;i++)await db.doc('clientDispersions/bytes/notas/b'+i).set({text:'\u0001'.repeat(1048400),createdAt:new firestore.Timestamp(600,0)});
  for(let i=0;i<9;i++)await db.doc('clientDispersions/wide/notas/b'+i).set({text:'x'.repeat(1048400),createdAt:new firestore.Timestamp(600,0)});
  const {execFileSync}=require('node:child_process');const measurements=[];
  for(const scenario of ['typical','large','wide','lineage'])for(const size of [4,8]){
   const raw=execFileSync(process.execPath,[__filename,'--notes-byte-child',String(size),scenario],{cwd:process.cwd(),env:process.env,encoding:'utf8',timeout:120000,windowsHide:true});
   const result=JSON.parse(raw.trim());assert.equal(result.batch,size);assert.equal(result.scenario,scenario);measurements.push(result);
   if(['typical','lineage'].includes(scenario))assert.equal(result.queries,size===4?13:7);
  }
  for(const scenario of ['typical','large','wide','lineage']){
   const raw=execFileSync(process.execPath,[__filename,'--notes-byte-child','--full-index','4',scenario],{cwd:process.cwd(),env:process.env,encoding:'utf8',timeout:120000,windowsHide:true});
   const result=JSON.parse(raw.trim());assert.equal(result.fullIndex,true);assert.equal(result.scenario,scenario);measurements.push(result);
  }
  for(const scenario of ['typical','large','wide','lineage']){
   const raw=execFileSync(process.execPath,[__filename,'--notes-byte-child','--full-index','--http-server','4',scenario],{cwd:process.cwd(),env:process.env,encoding:'utf8',timeout:150000,windowsHide:true});
   const result=JSON.parse(raw.trim());assert.equal(result.http,true);assert.equal(result.scenario,scenario);measurements.push(result);
  }
  for(const row of measurements)console.log('NOTES_BYTE_MEASUREMENT '+JSON.stringify(row));
  }else console.log('NOTES_RESOURCE_BENCHMARKS_SKIPPED explicitNarrowRun=true');
  console.log('NOTES_REAL_SDK_PASS notes=125 distinct=125 authorityRace=denied cloud=0 rulesVerdict=NOT_TESTED');
 }finally{await db.terminate();await app.delete();}
});
test('string aliases follow canonical trimming without object coercion',async()=>{const s=setup();s.rows.get('clientDispersions/d').clientId=' c ';assert.equal((await s.call()).items.length,50);for(const value of [0,false,{id:'c'},['c']]){const other=setup();other.rows.get('clientDispersions/d').clientId=value;await assert.rejects(other.call(),e=>e.code==='permission-denied');assert.equal(other.queries,0);}});
test('deleted cursor anchor is rejected, not silently skipped',async()=>{const s=setup(),first=await s.call();s.rows.delete('clientDispersions/d/notas/'+first.nextCursor.id);const previous=s.queries;await assert.rejects(s.call({dispersionId:'d',cursor:first.nextCursor}),e=>e.code==='failed-precondition');assert.equal(s.queries,previous);});
test('primitive aliases match canonical cleanId for123/true and reject empty0/false',async()=>{for(const value of [123,true]){const s=setup(),id=String(value||'').trim();s.rows.set('clients/'+id,{...s.rows.get('clients/c')});s.rows.set('userClientAccess/u/clients/'+id,{...s.rows.get('userClientAccess/u/clients/c')});s.rows.get('clientDispersions/d').clientId=value;assert.equal((await s.call()).items.length,50);}for(const value of [0,false]){const s=setup();s.rows.get('clientDispersions/d').clientId=value;await assert.rejects(s.call(),e=>e.code==='permission-denied');s.rows.get('clientDispersions/d').clienteId='c';assert.equal((await s.call()).items.length,50);}const s=setup();s.rows.get('clientDispersions/d').clientId=123;s.rows.get('clientDispersions/d').clienteId=' c ';assert.equal((await s.call()).items.length,50);});
test('wallet action revocation applies before direct-owner bypass and after query',async()=>{const s=setup();s.rows.get('clientDispersions/d').createdBy='u';s.rows.get('users/u').modules={wallet:{view:true,dispersiones:false}};await assert.rejects(s.call(),e=>e.code==='permission-denied');assert.equal(s.queries,0);const raced=setup();raced.race(()=>raced.rows.get('users/u').modules={wallet:{view:true,dispersiones:false}});await assert.rejects(raced.call(),e=>e.code==='permission-denied');assert.equal(raced.queries,13);});
for(const batch of [4,8])test('bounded byte pages preserve whole near-limit notes and cursor, batch'+batch,async()=>{const s=setup();for(const key of [...s.rows.keys()])if(key.includes('/notas/'))s.rows.delete(key);const text='\u0001'.repeat(1048400);for(let i=0;i<5;i++)s.rows.set('clientDispersions/d/notas/b'+i,{text,authorName:'😀Author',createdAt:new Timestamp(200,0)});const ids=[];let cursor;do{const page=await s.core(cursor?{cursor}:{},batch);assert.equal(page.items.length,1);assert.equal(page.items[0].text,text);assert.equal(page.items[0].authorName,'😀Author');assert.ok(Buffer.byteLength(JSON.stringify({result:page}),'utf8')<=8*1024*1024);ids.push(page.items[0].id);if(page.nextCursor)assert.equal(page.nextCursor.id,page.items.at(-1).id);cursor=page.nextCursor;}while(cursor);assert.deepEqual(ids,['b4','b3','b2','b1','b0']);});
for(const batch of [4,8])test('normal50 rows count same documents with explicit query tradeoff batch'+batch,async()=>{const s=setup();const page=await s.core({},batch);assert.equal(page.items.length,50);assert.equal(s.reads,65);assert.equal(s.queries,batch===4?13:7);});
test('single non-storable oversized synthetic note fails explicitly instead of truncating or skipping',async()=>{const s=setup();s.rows.get('clientDispersions/d/notas/n124').text='\u0001'.repeat(1500000);await assert.rejects(s.call(),e=>e.code==='resource-exhausted');});
for(const batch of [4,8])test('byte cut retains exact UTF8 extreme ID cursor at equal timestamps batch'+batch,async()=>{
 const s=setup();for(const key of [...s.rows.keys()])if(key.includes('/notas/'))s.rows.delete(key);
 const ids=['a'.repeat(1500),'z'.repeat(1500),'\u00e9'.repeat(750),'\ud83d\ude00'.repeat(375)];
 for(const id of ids){assert.equal(Buffer.byteLength(id),1500);s.rows.set('clientDispersions/d/notas/'+id,{text:'\u0001'.repeat(1040000),createdAt:new Timestamp(200,999999000)});}
 const seen=[];let cursor;do{const page=await s.core(cursor?{cursor}:{},batch);assert.equal(page.items.length,1);assert.ok(Buffer.byteLength(JSON.stringify({result:page}))<=8388608);seen.push(page.items[0].id);if(page.nextCursor){assert.equal(page.nextCursor.id,page.items[0].id);assert.equal(page.nextCursor.updateNanoseconds,1000);}cursor=page.nextCursor;}while(cursor);
 assert.deepEqual(seen,ids.sort((a,b)=>-Buffer.compare(Buffer.from(a),Buffer.from(b))));
});
for(const value of [null,{seconds:200,nanoseconds:0},'2026-10-10',123])test('stored display type is preserved without enforcing business schema: '+JSON.stringify(value),async()=>{const s=setup();for(const key of [...s.rows.keys()])if(key.includes('/notas/')&&!key.endsWith('/n124'))s.rows.delete(key);s.rows.get('clientDispersions/d/notas/n124').createdAt=value;const result=await s.call();assert.equal(result.items.length,1);assert.deepEqual(result.items[0].displayDate,s.display(value));assert.equal(result.items[0].createdAt,undefined);});
test('cursor note ID preserves whitespace but parent ID stays strict',async()=>{const s=setup();for(const key of [...s.rows.keys()])if(key.includes('/notas/'))s.rows.delete(key);const ids=[' leading','trailing ','  '];for(const id of ids)s.rows.set('clientDispersions/d/notas/'+id,{text:'whole',createdAt:new Timestamp(200,0)});const seen=[];let cursor;do{const page=await s.call({dispersionId:'d',limit:1,...(cursor?{cursor}:{})});seen.push(...page.items.map(x=>x.id));cursor=page.nextCursor;}while(cursor);assert.deepEqual(seen,ids.sort((a,b)=>-Buffer.compare(Buffer.from(a),Buffer.from(b))));await assert.rejects(s.call({dispersionId:' d'}),e=>e.code==='invalid-argument');for(const id of ['.','..','a/b','a'.repeat(1501)])await assert.rejects(s.call({dispersionId:'d',cursor:{version:2,dispersionId:'d',id,updateSeconds:1700000000,updateNanoseconds:1000}}),e=>e.code==='invalid-argument');});
test('changed cursor updateTime rejects before querying even when createdAt is unchanged',async()=>{const s=setup(),first=await s.call();s.versions.set('clientDispersions/d/notas/'+first.nextCursor.id,new Timestamp(1700000001,1000));const before=s.queries;await assert.rejects(s.call({dispersionId:'d',cursor:first.nextCursor}),e=>e.code==='failed-precondition');assert.equal(s.queries,before);});
// Pure display contract compared to the old browser conversion, no native-order claim.
test('display descriptors preserve browser Date operands, including maps arrays booleans',()=>{
 const s=setup();
 const fixtures=[null,false,0,true,1,-1,Infinity,NaN,'','2026-10-10','2026-10-10T13:45:00','not a date',{seconds:700,extra:'private'},{_seconds:700},{seconds:NaN,_seconds:700},{arbitrary:'private'},['2026-10-10'],[2026,10,10],[],[null],[['2026-10-10']],new Timestamp(700,1000),new Timestamp(-1,1000)];
 const old=value=>{if(!value)return null;if(value instanceof Timestamp)return new Date(value.seconds*1000+value.nanoseconds/1e6).getTime();const operand=typeof value?.seconds==='number'?value.seconds*1000:typeof value?._seconds==='number'?value._seconds*1000:value;const time=new Date(operand).getTime();return Number.isFinite(time)?time:null;};
 const display=value=>{const d=s.display(value);const operand=d.kind==='NONE'?null:d.kind==='TIMESTAMP'?d.seconds*1000+d.nanoseconds/1e6:d.kind==='SECONDS'?d.value*1000:d.value;return operand===null?null:Number.isFinite(new Date(operand).getTime())?new Date(operand).getTime():null;};
 for(const value of fixtures)assert.equal(display(value),old(value));
 assert.deepEqual(s.display({seconds:700,extra:'private'}),{kind:'SECONDS',value:700});
});

}
