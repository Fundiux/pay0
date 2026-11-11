// Actual createSolicitud callback; optimistic read-version transaction conflict fixture.
// Real sequence/auth/author helpers. On main the initial note is still a
// postcommit add (atomic initial notes were a separate, unmerged change),
// synthetic Firestore and postcommit effects. No index initialization or providers.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
global.fetch=async()=>{throw Error('NETWORK_FORBIDDEN');};
const source=fs.readFileSync('functions/src/modules/legacyCore/callables.ts','utf8'),ast=ts.createSourceFile('index.ts',source,ts.ScriptTarget.Latest,true);let callback;
for(const stmt of ast.statements)if(ts.isVariableStatement(stmt))for(const d of stmt.declarationList.declarations)if(d.name.getText(ast)==='createSolicitud'){assert.ok(ts.isCallExpression(d.initializer));assert.equal(d.initializer.expression.getText(ast),'onCall');callback=d.initializer.arguments[1].getText(ast);}
assert.ok(callback);const callbackCode=ts.transpileModule('exports.handler='+callback,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,compiled=new Map();
class HttpsError extends Error{constructor(code,message,details){super(message);this.code=code;this.details=details;}}
function setup({concurrent=false}={}){
 const rows=new Map([['users/u',{role:'operador',rootId:'r',active:true,name:'Server author',username:'server',modules:{solicitudes:{create:true,comment:false}}}],['clients/c',{rootId:'r',active:true,managedByUserId:'u',operadorId:'u',adminId:'r',nombre:'Client'}],['companies/co',{rootId:'r',active:true,despachoId:'d',companyNumber:3,nombre:'Company'}],['despachos/d',{active:true}],['userCompanyAccess/u/companies/co',{active:true}],['solicitudes/original',{rootId:'r',clienteId:'c',companyId:'co',facturamaEnvironment:'PRODUCTION',facturamaInvoiceId:'invoice',facturaUuid:'ABC',folio:'original',status:'COMPLETADA'}]]);
 let auto=0,noteAlloc=0,attempts=0,commits=0,failAudit=false,ownDispatch=true;const stagedAttempts=[],effects={audit:0,materiality:0,draft:0,metric:0};const stamp={serverTimestamp:true};
 const clone=v=>structuredClone(v);
 const snap=p=>({exists:rows.has(p),ref:ref(p),data:()=>clone(rows.get(p))});
 function ref(p){return{path:p,id:p.split('/').at(-1),get:async()=>snap(p),collection:name=>({doc:id=>{if(!id)noteAlloc++;return ref(p+'/'+name+'/'+(id||'note'+noteAlloc));},add:async d=>{assert.equal(commits,1,'main writes the initial note only after one successful commit');noteAlloc++;const notePath=p+'/'+name+'/note'+noteAlloc;rows.set(notePath,clone(d));return ref(notePath);}}),update:async d=>{assert.equal(commits,1,'main flags the unread note only after one successful commit');assert.ok(rows.has(p));rows.set(p,{...rows.get(p),...clone(d)});},set:()=>{throw Error('UNEXPECTED_POSTCOMMIT_ERROR_WRITE');}};}
 const versions=new Map();let mutation=null,barrierCount=0,releaseBarrier;const barrier=new Promise(resolve=>releaseBarrier=resolve);
 const version=p=>versions.get(p)||0;
 const db={doc:ref,collection:name=>({doc:id=>ref(name+'/'+(id||'created'+(++auto)))}),runTransaction:async fn=>{
  for(let i=0;i<3;i++){
   const attemptNumber=++attempts,writes=[],readVersions=new Map();stagedAttempts.push(writes);let writing=false;
   const out=await fn({get:async r=>{assert.equal(writing,false,'source must be read before sequence stages writes');readVersions.set(r.path,version(r.path));return snap(r.path);},set:(r,d,opts)=>{writing=true;writes.push({kind:'set',path:r.path,data:clone(d),merge:opts?.merge});},create:(r,d)=>{writing=true;writes.push({kind:'create',path:r.path,data:clone(d)});}});
   if(concurrent&&attemptNumber<=2){if(++barrierCount===2)releaseBarrier();await barrier;}
   if(mutation){const mutate=mutation;mutation=null;mutate(rows);versions.set('solicitudes/original',version('solicitudes/original')+1);}
   if([...readVersions].some(([p,v])=>version(p)!==v))continue;
   assert.deepEqual(effects,{audit:0,materiality:0,draft:0,metric:0},'effects cannot start inside winning transaction');
   const staged=new Map(rows);for(const w of writes){if(w.kind==='create')assert.ok(!staged.has(w.path));staged.set(w.path,w.merge?{...staged.get(w.path),...w.data}:w.data);}
   rows.clear();for(const[k,v]of staged)rows.set(k,v);for(const w of writes)versions.set(w.path,version(w.path)+1);commits++;return out;
  }throw Error('RETRY_BOUND');
 }};
 const cache=new Map();function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const out={};cache.set(file,out);let code=compiled.get(file);if(!code){code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;compiled.set(file,code);}new Function('exports','require',code)(out,n=>{if(n==='firebase-admin')return{apps:[{}],firestore:()=>db};if(n==='firebase-admin/firestore')return{getFirestore:()=>db,FieldValue:{serverTimestamp:()=>stamp}};if(n==='firebase-admin/app')return{getApps:()=>[{}],initializeApp:()=>{throw Error('INIT_FORBIDDEN');}};if(n==='firebase-functions/v2/https')return{HttpsError};if(n==='firebase-functions')return{https:{HttpsError}};assert.ok(n.startsWith('.'),n);return load(path.resolve(path.dirname(file),n+'.ts'));});return out;}
 const helpers=load('functions/src/modules/sharedCallables/helpers.ts'),guard=load('functions/src/utils/authGuard.ts'),seq=load('functions/src/modules/sequences/service.ts'),domain=load('functions/src/modules/notes/domain.ts');
 const effect=name=>async()=>{assert.equal(commits,1,'posteffects only after one successful commit');effects[name]++;if(name==='audit'&&failAudit)throw Error('INJECTED_AUDIT_FAILURE');return{};};
 const deps={...helpers,...guard,...seq,...domain,HttpsError,FieldValue:{serverTimestamp:()=>stamp},db,getActiveClientDelegationAccess:async()=>null,resolveClientAssignedCostRate:async()=>2,resolveCanonicalBusinessFolioContext:async()=>({clientNumber:1,ownerUserNumber:2,ownerUid:'u',delegateUserNumber:null,delegateUid:null,accessSource:'OWNER',delegatedClientAccessPath:null}),buildCanonicalBusinessFolioParts:load('functions/src/modules/sequences/businessFolioContext.ts').buildCanonicalBusinessFolioParts,operationTiming:()=>{},logActivity:effect('audit'),linkSolicitudToMaterialityOperationCore:effect('materiality'),ensureAutomaticFacturamaDraftForSolicitud:effect('draft'),belongsToPay0Dispatch:()=>ownDispatch,recordOperationalMetric:effect('metric'),console:{log:()=>{}}};
 const out={};new Function('exports',...Object.keys(deps),callbackCode)(out,...Object.values(deps));
 return{mutateBetweenAttempts:fn=>mutation=fn,rows,effects,stagedAttempts,call:(extra={})=>out.handler({auth:{uid:'u'},data:{clienteId:'c',companyId:'co',despachoId:'d',operationTypeKey:'FACTURA',monto:100,tipoFactura:'PPD',comentario:'  Initial fixture  ',...extra}}),failAudit:()=>failAudit=true,external:()=>ownDispatch=false,get attempts(){return attempts;},get commits(){return commits;},get noteAlloc(){return noteAlloc;},notes:()=>[...rows.entries()].filter(([p])=>p.includes('/notas/')),created:()=>[...rows.entries()].filter(([p])=>p.startsWith('solicitudes/created')&&!p.includes('/notas/'))};
}
const replaceInput={replacementOfSolicitudId:'original',replacementReason:'fixture'};
test('two contenders claim the same original: only one parent, note, counter and effects',async()=>{
 const s=setup({concurrent:true});const results=await Promise.allSettled([s.call(replaceInput),s.call(replaceInput)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const loser=results.find(r=>r.status==='rejected');assert.equal(loser.reason.code,'already-exists');
 const winner=results.find(r=>r.status==='fulfilled').value;assert.equal(s.commits,1);assert.equal(s.attempts,3);assert.equal(s.created().length,1);assert.equal(s.notes().length,1);assert.equal(s.rows.get('solicitudes/original').relatedSolicitudId,winner.solicitudId);assert.equal(s.rows.get('solicitudes/original').relatedSolicitudFolio,winner.folio);assert.equal(s.created()[0][1].replacementOfSolicitudId,'original');const counters=[...s.rows.entries()].filter(([p])=>p.startsWith('counters/'));assert.equal(counters.length,1);assert.equal(counters[0][1].value,1);assert.deepEqual(s.effects,{audit:1,materiality:1,draft:1,metric:1});assert.equal(s.stagedAttempts[2].length,0,'loser fails before sequence/write staging');
});
for(const[name,mutate,code]of [
 ['deleted',rows=>rows.delete('solicitudes/original'),'not-found'],
 ['root',rows=>rows.get('solicitudes/original').rootId='foreign','permission-denied'],
 ['company',rows=>rows.get('solicitudes/original').companyId='foreign','failed-precondition'],
 ['client',rows=>rows.get('solicitudes/original').clienteId='foreign','failed-precondition'],
 ['environment',rows=>rows.get('solicitudes/original').facturamaEnvironment='SANDBOX','failed-precondition'],
 ['invoice removed',rows=>rows.get('solicitudes/original').facturamaInvoiceId='','failed-precondition'],
 ['uuid removed',rows=>rows.get('solicitudes/original').facturaUuid='','failed-precondition'],
 ['claimed',rows=>rows.get('solicitudes/original').relatedSolicitudId='winner','already-exists'],
])test('retry validates fresh source '+name,async()=>{const s=setup();s.mutateBetweenAttempts(mutate);await assert.rejects(s.call(replaceInput),e=>e.code===code);assert.equal(s.attempts,2);assert.equal(s.commits,0);assert.equal(s.created().length,0);assert.equal(s.notes().length,0);assert.equal([...s.rows.keys()].some(p=>p.startsWith('counters/')),false);assert.equal(s.stagedAttempts[1].length,0);assert.deepEqual(s.effects,{audit:0,materiality:0,draft:0,metric:0});});
test('valid source changes on retry are used coherently, not rejected by invented status policy',async()=>{
 const s=setup();s.mutateBetweenAttempts(rows=>Object.assign(rows.get('solicitudes/original'),{facturaUuid:' new-uuid ',folio:'Fresh-folio',facturaFecha:'2026-10-11',facturaDisplay:'Fresh-display',status:'EXISTING_LEGACY_STATUS'}));const result=await s.call(replaceInput);const p=s.created()[0][1];assert.equal(s.attempts,2);assert.equal(p.replacementOfUuid,'NEW-UUID');assert.equal(p.uuidCfdiSustituido,'NEW-UUID');assert.equal(p.replacementOfSolicitudFolio,'Fresh-folio');assert.equal(p.originalFacturaFecha,'2026-10-11');assert.equal(p.originalFacturaFolio,'Fresh-display');assert.equal(s.rows.get('solicitudes/original').relatedSolicitudId,result.solicitudId);assert.equal(s.noteAlloc,1);const createdWrite=writes=>writes.find(w=>w.path.startsWith('solicitudes/created'));assert.equal(createdWrite(s.stagedAttempts[0]).path,createdWrite(s.stagedAttempts[1]).path);assert.deepEqual(s.effects,{audit:1,materiality:1,draft:1,metric:1});
});
test('existing claim rejects without consuming sequence or starting effects',async()=>{const s=setup();s.rows.get('solicitudes/original').relatedSolicitudId='already';await assert.rejects(s.call(replaceInput),e=>e.code==='already-exists');assert.equal(s.stagedAttempts[0].length,0);assert.equal(s.commits,0);assert.deepEqual(s.effects,{audit:0,materiality:0,draft:0,metric:0});});
test('ordinary creation retains behavior without replacement read',async()=>{const s=setup();s.rows.delete('solicitudes/original');const result=await s.call();assert.equal(result.ok,true);assert.equal(s.created()[0][1].replacementOfSolicitudId,null);assert.equal(s.commits,1);});
