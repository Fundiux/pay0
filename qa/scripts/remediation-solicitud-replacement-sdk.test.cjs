// Opt-in isolated demo: actual source callback, real SDK transactions, no fiscal providers.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const PROJECT='demo-pay0-solicitud-replacement',HOST='127.0.0.1:18253';
test('same-original claim and explicit injected retry with real SDK',{skip:process.env.PAY0_SOLICITUD_REPLACEMENT_REAL_SDK!=='1',timeout:90000},async()=>{
 const watchdog=setTimeout(()=>{process.stderr.write(JSON.stringify({status:'REPLACEMENT_DEMO_WATCHDOG',cleanup:'UNKNOWN',exitCode:124})+'\n');process.exit(124);},120000);
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,HOST);
 for(const k of ['GOOGLE_APPLICATION_CREDENTIALS','CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','FIREBASE_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN','NODE_OPTIONS'])assert.ok(!process.env[k]);
 for(const k of ['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT','GCP_PROJECT','GOOGLE_CLOUD_QUOTA_PROJECT','FIREBASE_PROJECT_ID'])if(process.env[k])assert.equal(process.env[k],PROJECT);
 if(process.env.FIREBASE_CONFIG)assert.equal(JSON.parse(process.env.FIREBASE_CONFIG).projectId,PROJECT);
 assert.ok(!fs.existsSync(path.resolve('functions/.bundle-provenance.json')),'NORMAL_BUILD_REQUIRED');
 const net=require('node:net'),dns=require('node:dns'),tls=require('node:tls'),h2=require('node:http2');const connect=net.Socket.prototype.connect,lookup=dns.lookup,tlsConnect=tls.connect,h2Connect=h2.connect,fetch=global.fetch;
 net.Socket.prototype.connect=function(...args){const o=Array.isArray(args[0])?args[0][0]:args[0];assert.ok(o&&typeof o==='object'&&o.path==null);assert.equal(o.host,'127.0.0.1');assert.equal(Number(o.port),18253);return connect.apply(this,args);};
 dns.lookup=function(host,...args){assert.equal(host,'127.0.0.1');return lookup.call(this,host,...args);};tls.connect=()=>{throw Error('TLS_FORBIDDEN');};h2.connect=function(authority,...args){assert.equal(String(authority),'http://'+HOST);return h2Connect.call(this,authority,...args);};global.fetch=async()=>{throw Error('FETCH_FORBIDDEN');};
 const req=require('node:module').createRequire(path.resolve('functions/package.json')),admin=req('firebase-admin'),{FieldValue}=req('firebase-admin/firestore'),{HttpsError}=req('firebase-functions/v2/https');
 const app=admin.initializeApp({projectId:PROJECT}),db=admin.firestore(app),prefix='rc'+crypto.randomUUID().replace(/-/g,'');
 const uid=prefix+'u',root=prefix+'r',client=prefix+'c',company=prefix+'co',dispatch=prefix+'d',originalA=prefix+'a',originalB=prefix+'b';
 const seed=new Map(),owned=new Set(),known=new Map(),written=new Set(),effects={audit:0,materiality:0,draft:0,metric:0};const notes=[],parents=[],checks=[];
 let stage='SEED',cleanupVerified=false,allocation=0,mode='concurrent',transactionInvocations=0,commits=0,injectedCallbacks=0,firstReadBarrierCount=0,releaseBarrier;
 const beforeReads=new Promise(resolve=>releaseBarrier=resolve);
 const seedRecord=(p,d)=>{seed.set(p,{...d,syntheticOwner:prefix});owned.add(p);};
 seedRecord('users/'+uid,{rootId:root,role:'operador',active:true,name:'Synthetic author',modules:{solicitudes:{create:true,comment:false}}});
 seedRecord('clients/'+client,{rootId:root,active:true,managedByUserId:uid,operadorId:uid,adminId:root,nombre:'Synthetic client'});
 seedRecord('companies/'+company,{rootId:root,active:true,despachoId:dispatch,companyNumber:3,nombre:'Synthetic company'});
 seedRecord('despachos/'+dispatch,{active:true});seedRecord('userCompanyAccess/'+uid+'/companies/'+company,{active:true});
 for(const id of [originalA,originalB])seedRecord('solicitudes/'+id,{rootId:root,clienteId:client,companyId:company,facturamaEnvironment:'PRODUCTION',facturamaInvoiceId:'synthetic-invoice',facturaUuid:'OLD-UUID',folio:'Synthetic-original',status:'COMPLETADA',totalAbonado:0});
 const load=file=>require(path.resolve('functions/lib/'+file+'.js'));
 const helpers=load('modules/sharedCallables/helpers'),guard=load('utils/authGuard'),sequence=load('modules/sequences/service'),domain=load('modules/notes/domain'),folio=load('modules/sequences/businessFolioContext');
 const counterPath=sequence.buildCounterPath({rootId:root,scope:'solicitudes',scopeKey:`cliente_${client}__usuario_${uid}__empresa_${company}`});owned.add(counterPath);
 function attest(p,d){
  assert.ok(owned.has(p));if(seed.has(p))assert.equal(d.syntheticOwner,prefix);
  else if(p===counterPath){assert.equal(d.rootId,root);assert.equal(d.scope,'solicitudes');assert.ok(d.value===1||d.value===2);}
  else if(p.includes('/notas/')){assert.equal(d.text,prefix);assert.equal(d.rootId,root);assert.equal(d.createdBy,uid);assert.equal(d.referenceId,p.split('/')[1]);}
  else{assert.ok(parents.includes(p));assert.equal(d.rootId,root);assert.equal(d.createdBy,uid);assert.equal(d.clienteId,client);assert.equal(d.companyId,company);assert.equal(d.monto,100);assert.equal(d.totalAbonado,0);}
 }
 async function captureWrites(onlyUnknown=false){for(const p of written){if(onlyUnknown&&known.has(p))continue;const s=await db.doc(p).get();if(s.exists){attest(p,s.data());known.set(p,s.updateTime);}}}
 async function mutateOriginal(){const p='solicitudes/'+originalB;const result=await db.doc(p).update({facturaUuid:'FRESH-UUID',folio:'Fresh-original',facturaFecha:'2026-10-11'},{lastUpdateTime:known.get(p)});known.set(p,result.writeTime);}
 const facade={doc:p=>{assert.ok(owned.has(p),'EXACT_REF_REQUIRED');return db.doc(p);},collection:name=>{assert.equal(name,'solicitudes');return{doc:()=>{
  assert.ok(++allocation<=3);const p='solicitudes/'+prefix+'created'+allocation;owned.add(p);parents.push(p);const ref=db.doc(p),realCollection=ref.collection.bind(ref);
  ref.collection=name=>{assert.equal(name,'notas');const col=realCollection(name),realDoc=col.doc.bind(col);col.doc=()=>{const note=realDoc();owned.add(note.path);notes.push(note.path);assert.ok(owned.size<=14);return note;};return col;};return ref;
 }};},runTransaction:async fn=>{
  const invocation=++transactionInvocations;let attempt=0;
  // Rendezvous before opening/reading either SDK transaction: no lock barrier.
  if(mode==='concurrent'){if(++firstReadBarrierCount===2)releaseBarrier();await beforeReads;}
  const result=await db.runTransaction(async tx=>{
   attempt++;if(mode==='injected'){injectedCallbacks++;if(attempt===2)await mutateOriginal();}
   const returned=await fn({get:r=>{assert.ok(owned.has(r.path));return tx.get(r);},set:(r,d,options)=>{assert.ok(owned.has(r.path));written.add(r.path);return options?tx.set(r,d,options):tx.set(r,d);},create:(r,d)=>{assert.ok(owned.has(r.path)&&notes.includes(r.path));written.add(r.path);return tx.create(r,d);}});
   if(mode==='injected'&&attempt===1)throw Object.assign(new Error('INJECTED_ABORTED'),{code:10});
   return returned;
  },{maxAttempts:3});commits++;return result;
 }};
 const effect=name=>async()=>{assert.ok(commits>0,'NO_EFFECT_BEFORE_COMMIT');effects[name]++;return{};};
 const deps={...helpers,...guard,...sequence,...domain,HttpsError,FieldValue,db:facade,getActiveClientDelegationAccess:async()=>null,resolveClientAssignedCostRate:async()=>2,resolveCanonicalBusinessFolioContext:async()=>({clientNumber:1,ownerUserNumber:2,ownerUid:uid,delegateUserNumber:null,delegateUid:null,accessSource:'OWNER',delegatedClientAccessPath:null}),buildCanonicalBusinessFolioParts:folio.buildCanonicalBusinessFolioParts,operationTiming:()=>{},logActivity:effect('audit'),linkSolicitudToMaterialityOperationCore:effect('materiality'),ensureAutomaticFacturamaDraftForSolicitud:effect('draft'),belongsToPay0Dispatch:()=>true,recordOperationalMetric:effect('metric'),console:{log:()=>{}}};
 const ts=require('typescript'),source=fs.readFileSync('functions/src/index.ts','utf8'),ast=ts.createSourceFile('index.ts',source,ts.ScriptTarget.Latest,true);let callback,count=0;
 for(const statement of ast.statements)if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations)if(declaration.name.getText(ast)==='createSolicitud'){count++;assert.ok(ts.isCallExpression(declaration.initializer));assert.equal(declaration.initializer.expression.getText(ast),'onCall');callback=declaration.initializer.arguments[1].getText(ast);}assert.equal(count,1);
 const out={};new Function('exports',...Object.keys(deps),ts.transpileModule('exports.handler='+callback,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(out,...Object.values(deps));
 const call=original=>out.handler({auth:{uid},data:{clienteId:client,companyId:company,despachoId:dispatch,operationTypeKey:'FACTURA',monto:100,tipoFactura:'PPD',comentario:prefix,replacementOfSolicitudId:original,replacementReason:'synthetic'}});
 try{
  const batch=db.batch();for(const[p,d]of seed)batch.create(db.doc(p),d);const created=await batch.commit();[...seed.keys()].forEach((p,i)=>known.set(p,created[i].writeTime));
  stage='TWO_CONTENDERS';const results=await Promise.allSettled([call(originalA),call(originalA)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.code,'already-exists');const winner=results.find(x=>x.status==='fulfilled').value;await captureWrites();
  assert.equal(commits,1);assert.equal((await db.doc(counterPath).get()).get('value'),1);assert.equal((await db.doc('solicitudes/'+originalA).get()).get('relatedSolicitudId'),winner.solicitudId);assert.equal((await db.getAll(...parents.map(p=>db.doc(p)))).filter(s=>s.exists).length,1);assert.equal((await db.getAll(...notes.map(p=>db.doc(p)))).filter(s=>s.exists).length,1);assert.deepEqual(effects,{audit:1,materiality:1,draft:1,metric:1});checks.push('NATURAL_CONTENTION_SINGLE_WINNER_NO_RETRY_COUNT_CLAIM');
  stage='INJECTED_RETRY';mode='injected';const beforeNotes=notes.length,result=await call(originalB);await captureWrites();assert.equal(injectedCallbacks,2);assert.equal(notes.length,beforeNotes+1,'one reserved note identity across retry');const replacement=await db.doc('solicitudes/'+result.solicitudId).get();assert.equal(replacement.get('replacementOfUuid'),'FRESH-UUID');assert.equal(replacement.get('replacementOfSolicitudFolio'),'Fresh-original');assert.equal(replacement.get('originalFacturaFecha'),'2026-10-11');assert.equal((await db.doc(counterPath).get()).get('value'),2);assert.equal((await db.doc('solicitudes/'+originalB).get()).get('relatedSolicitudId'),result.solicitudId);assert.deepEqual(effects,{audit:2,materiality:2,draft:2,metric:2});checks.push('INJECTED_ABORTED_FRESH_SOURCE_STABLE_NOTE');
  assert.equal(owned.size,14);assert.equal(transactionInvocations,3);
 }finally{
  try{
   // Never refresh already-known cleanup versions. Only captured uncertain
   // creates may be attested once; drift of existing known refs fails CAS.
   await captureWrites(true);const cleanup=db.batch();for(const[p,stamp]of known)cleanup.delete(db.doc(p),{lastUpdateTime:stamp});if(known.size)await cleanup.commit();const remaining=await db.getAll(...[...owned].map(p=>db.doc(p)));assert.ok(remaining.every(s=>!s.exists));cleanupVerified=true;
  }finally{await db.terminate();await app.delete();clearTimeout(watchdog);net.Socket.prototype.connect=connect;dns.lookup=lookup;tls.connect=tlsConnect;h2.connect=h2Connect;global.fetch=fetch;console.log(JSON.stringify({status:'REPLACEMENT_DEMO_CLEANUP',stage,cleanupVerified,trackedRefs:owned.size,cloudCalls:0}));}
 }
 console.log(JSON.stringify({status:'REPLACEMENT_DEMO_SDK_PASS',checks,cleanup:'EXACT_REFS_ABSENT',cloudCalls:0,emulatorOnly:true,injectedAborted:true,sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),callbackSha256:crypto.createHash('sha256').update(callback).digest('hex')}));
});
