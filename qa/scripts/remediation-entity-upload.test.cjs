const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const ts = require('../../functions/node_modules/typescript');
class HttpsError extends Error { constructor(code,message){super(message);this.code=code;} }
function load(file,deps={}) { const exports={}; const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports','require',code)(exports,name=>{if(Object.hasOwn(deps,name))return deps[name];throw Error('Unexpected import '+name);});return exports; }
const verifier=load('functions/src/utils/verifiedStorageObject.ts',{'node:crypto':crypto,'firebase-functions/v2/https':{HttpsError}});
const domain=load('functions/src/modules/entityDocuments/domain.ts');
const generated=load('functions/src/modules/users/authorizationPolicy.generated.ts');
const defaults=load('functions/src/modules/users/defaultModules.ts',{'./authorizationPolicy.generated':generated});
const restrictionsPath='functions/src/modules/users/restrictions.ts';
const authz=load('functions/src/modules/users/authorization.ts',{'./defaultModules':defaults,...(fs.existsSync(restrictionsPath)?{'./restrictions':load(restrictionsPath)}:{})});
const guard=load('functions/src/utils/authGuard.ts',{'firebase-functions':{https:{HttpsError}},'../modules/users/authorization':authz});
const bytes=Buffer.from('%PDF-1.7\nsynthetic document\n%%EOF');
const digest=crypto.createHash('sha256').update(bytes).digest('hex');
const storagePath='roots/r/entityDocuments/CLIENTE/c/CONSTANCIA_SITUACION_FISCAL/d-doc.pdf';
const document=(extra={})=>({id:'d',rootId:'r',entityType:'CLIENTE',entityId:'c',documentType:'CONSTANCIA_SITUACION_FISCAL',documentPeriod:'2026-10',version:1,createdBy:'u',fileName:'doc.pdf',storagePath,fileSize:bytes.length,sizeBytes:bytes.length,contentType:'application/pdf',uploadStatus:'PENDING_UPLOAD',active:false,isCurrent:false,status:'INACTIVE',supersedesDocumentId:null,...extra});
function bucketFake(options={}) {
 const reads=[];let calls=0;const initial={name:storagePath,generation:'111',metageneration:'1',size:String(bytes.length),contentType:'application/pdf',metadata:{entityDocumentId:'d',entityType:'CLIENTE',entityId:'c',documentType:'CONSTANCIA_SITUACION_FISCAL'},...options.metadata};
 return {reads,file(p,opts){reads.push({p,opts});return {getMetadata:async()=>{calls++;if(calls===2)options.afterRead?.();return [{...initial,...(options.dynamicPaths ? {name:p,metadata:{...initial.metadata,entityDocumentId:p.split('/').at(-1).split('-')[0]}} : {}),...(calls===2?options.changedMetadata:{})}];},createReadStream:()=>Readable.from(options.chunks||[bytes])};}};
}
function fixture(options={}) {
 const docs=new Map([['users/u',{rootId:'r',role:options.role||'superadmin',active:true}],['clients/c',{rootId:'r',createdBy:'u',fiscalProfile:{csfIntakeId:'i'}}],['clientCsfIntakes/i',{rootId:'r',createdBy:'u',clientId:'c',status:'CLIENT_CREATED'}],['entityDocuments/d',document(options.document)]]);
 let revision=0; const mutate=(p,patch)=>{docs.set(p,{...docs.get(p),...patch});revision++;};
 const ref=p=>({path:p,id:p.split('/').at(-1),get:async()=>snapshot(p),update:async patch=>mutate(p,patch),set:async value=>{docs.set(p,value);revision++;}});
 const snapshot=p=>{const value=docs.get(p);return {id:p.split('/').at(-1),ref:ref(p),exists:!!value,data:()=>value?structuredClone(value):undefined};};
 const collection=(name,filters=[])=>({query:true,name,filters,doc:id=>ref(name+'/'+id),where:(key,_op,value)=>collection(name,[...filters,[key,value]]),limit:()=>collection(name,filters),get:async()=>query({name,filters})});
 const query=q=>({docs:[...docs.entries()].filter(([p,v])=>p.startsWith(q.name+'/')&&q.filters.every(([k,w])=>v[k]===w)).map(([p])=>snapshot(p))});
 const db={doc:ref,collection,async runTransaction(fn){for(let i=0;i<20;i++){const seen=revision,writes=[];await fn({get:async target=>target.query?query(target):snapshot(target.path),update:(r,patch)=>writes.push([r.path,patch])});if(seen!==revision)continue;for(const [p,patch] of writes)mutate(p,patch);return;}throw Error('retry budget');}};
 const bucket=bucketFake({...options,afterRead:()=>options.duringRead?.({docs,mutate})});
 const fields={serverTimestamp:()=> 'SERVER_TIMESTAMP'};
 const csf=load('functions/src/modules/clients/csfService.ts',{'crypto':crypto,'firebase-admin/firestore':{FieldValue:fields},'firebase-functions/v2/https':{HttpsError},'../sharedCallables/helpers':{db},'../clientKyc/service':{},'pdf-parse':()=>{throw Error('Parser must not run');}});
 const service=load('functions/src/modules/entityDocuments/service.ts',{'firebase-admin':{apps:[{}]},'firebase-admin/firestore':{FieldValue:fields,getFirestore:()=>db},'firebase-admin/storage':{getStorage:()=>({bucket:()=>bucket})},'firebase-functions/v2/https':{HttpsError},'../../utils/authGuard':guard,'../../utils/verifiedStorageObject':verifier,'../clients/csfService':csf,'./domain':domain});
 return {service,docs,bucket,mutate,request:{auth:{uid:'u'},data:{entityDocumentId:'d'}}};
}

test('server computes exact generation-bound SHA and leaves malware explicitly NOT_SCANNED; repeat is idempotent',async()=>{
 const f=fixture();await f.service.finalizeEntityDocumentUploadCore(f.request);const saved=f.docs.get('entityDocuments/d');
 assert.equal(saved.sha256,digest);assert.equal(saved.storageGeneration,'111');assert.equal(saved.integritySealStatus,'HASH_SERVER_VERIFIED');assert.equal(saved.malwareScanStatus,'NOT_SCANNED');assert.equal(saved.contentValidationStatus,'BASIC_SIGNATURE_VERIFIED');assert.equal(saved.isCurrent,true);
 assert.ok(f.bucket.reads.some(x=>x.opts?.generation==='111'));await f.service.finalizeEntityDocumentUploadCore(f.request);assert.equal(f.docs.get('entityDocuments/d').sha256,digest);
});
test('wrong prepared hash, metadata, type, size, generation and oversized streams all reject without activation',async()=>{
 for(const options of [
  {document:{sha256:'a'.repeat(64)}}, {metadata:{name:'other'}}, {metadata:{size:'999'}}, {metadata:{contentType:'image/png'}},
  {changedMetadata:{generation:'222'}}, {changedMetadata:{metageneration:'2'}}, {chunks:[Buffer.from('plain text that is not PDF.....')]}, {chunks:[bytes,Buffer.from('extra')]},
  {metadata:{metadata:{entityDocumentId:'foreign'}}},
 ]){const f=fixture(options);await assert.rejects(f.service.finalizeEntityDocumentUploadCore(f.request));assert.equal(f.docs.get('entityDocuments/d').active,false);}
});
test('deleted, deactivated and replaced documents never reactivate, including concurrent metadata/profile changes',async()=>{
 for(const patch of [{deletedAt:'now'},{isDeleted:true},{status:'REPLACED'},{uploadStatus:'DEACTIVATED'},{supersededByDocumentId:'other'}]){const f=fixture({document:patch});await assert.rejects(f.service.finalizeEntityDocumentUploadCore(f.request));assert.equal(f.docs.get('entityDocuments/d').active,false);}
 for(const duringRead of [({mutate})=>mutate('entityDocuments/d',{uploadStatus:'DEACTIVATED',deactivatedAt:'now'}),({mutate})=>mutate('entityDocuments/d',{storagePath:'other'}),({mutate})=>mutate('users/u',{active:false}),({mutate})=>mutate('clients/c',{rootId:'foreign'})]){const f=fixture({duringRead});await assert.rejects(f.service.finalizeEntityDocumentUploadCore(f.request));assert.equal(f.docs.get('entityDocuments/d').active,false);}
});
test('concurrent completion of one upload remains one current version and preserves server seal',async()=>{
 const f=fixture();await Promise.all([f.service.finalizeEntityDocumentUploadCore(f.request),f.service.finalizeEntityDocumentUploadCore(f.request)]);assert.equal(f.docs.get('entityDocuments/d').sha256,digest);assert.equal([...f.docs.values()].filter(v=>v.isCurrent).length,1);
});
test('changed predecessor or a newer current upload rejects stale finalize; valid predecessor is replaced atomically',async()=>{
 for(const bad of [false,true]){const f=fixture({document:{supersedesDocumentId:'prev',version:2}});f.docs.set('entityDocuments/prev',document({id:'prev',active:true,isCurrent:true,status:'ACTIVE',uploadStatus:'FINALIZED',supersededByDocumentId:bad?'new':null}));
 if(bad){await assert.rejects(f.service.finalizeEntityDocumentUploadCore(f.request));assert.equal(f.docs.get('entityDocuments/d').active,false);}else{await f.service.finalizeEntityDocumentUploadCore(f.request);assert.equal(f.docs.get('entityDocuments/prev').active,false);assert.equal(f.docs.get('entityDocuments/prev').supersededByDocumentId,'d');}}
 const f=fixture();f.docs.set('entityDocuments/newer',document({id:'newer',active:true,isCurrent:true,status:'ACTIVE',uploadStatus:'FINALIZED'}));await assert.rejects(f.service.finalizeEntityDocumentUploadCore(f.request));
});
test('deployed CSF continuation supports admin/operator; foreign root, client, creator and revoked role deny',async()=>{
 for(const role of ['admin','operador']){const f=fixture({role});await f.service.finalizeEntityDocumentUploadCore(f.request);assert.equal(f.docs.get('entityDocuments/d').active,true);}
 for(const change of [f=>f.mutate('clientCsfIntakes/i',{rootId:'foreign'}),f=>f.mutate('clientCsfIntakes/i',{clientId:'other'}),f=>f.mutate('clientCsfIntakes/i',{createdBy:'other'}),f=>f.mutate('entityDocuments/d',{createdBy:'other'}),f=>f.mutate('users/u',{modules:{clientes:{view:true,create:false}}})]){const f=fixture({role:'operador'});change(f);await assert.rejects(f.service.finalizeEntityDocumentUploadCore(f.request));assert.equal(f.docs.get('entityDocuments/d').active,false);}
 const f=fixture({role:'admin',duringRead:({mutate})=>mutate('clientCsfIntakes/i',{clientId:'other'})});await assert.rejects(f.service.finalizeEntityDocumentUploadCore(f.request));
});


test('two prepared replacements racing for the same predecessor produce only one current document', async () => {
 const f=fixture({dynamicPaths:true,document:{supersedesDocumentId:'prev',version:2}});
 f.docs.set('entityDocuments/prev',document({id:'prev',active:true,isCurrent:true,status:'ACTIVE',uploadStatus:'FINALIZED'}));
 f.docs.set('entityDocuments/d2',document({id:'d2',storagePath:storagePath.replace('d-doc.pdf','d2-doc.pdf'),supersedesDocumentId:'prev',version:2}));
 const results=await Promise.allSettled([f.service.finalizeEntityDocumentUploadCore(f.request),f.service.finalizeEntityDocumentUploadCore({...f.request,data:{entityDocumentId:'d2'}})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal([...f.docs.values()].filter(v=>v.active&&v.isCurrent).length,1);
 const winner=f.docs.get('entityDocuments/prev').supersededByDocumentId;assert.ok(['d','d2'].includes(winner));
 assert.equal(f.docs.get('entityDocuments/'+winner).sha256,digest);
});

test('MIME compatibility keeps XML without declaration, JSON and empty ZIP; opaque formats stay explicitly unrecognized', async () => {
 const samples = [
  {type:'application/xml', bytes:Buffer.from('<invoice total="1"/>'), detected:'application/xml', status:'BASIC_SIGNATURE_VERIFIED'},
  {type:'text/xml', bytes:Buffer.from('<?xml version="1.0"?><invoice/>'), detected:'application/xml', status:'BASIC_SIGNATURE_VERIFIED'},
  {type:'application/json', bytes:Buffer.from('{"document":"synthetic"}'), detected:'application/json', status:'BASIC_SIGNATURE_VERIFIED'},
  {type:'application/zip', bytes:Buffer.from([80,75,5,6,...new Array(18).fill(0)]), detected:'application/zip', status:'BASIC_SIGNATURE_VERIFIED'},
  {type:'application/x-proprietary-document', bytes:Buffer.from([0,1,2,3,4,5]), detected:null, status:'UNRECOGNIZED_TYPE'},
  {type:'application/octet-stream', bytes:Buffer.from([0,1,2,3,4,5]), detected:null, status:'UNRECOGNIZED_TYPE'},
 ];
 for(const sample of samples){const bucket=bucketFake({chunks:[sample.bytes],metadata:{size:String(sample.bytes.length),contentType:sample.type}});
 const result=await verifier.verifyStorageObject({bucket,storagePath,expectedSize:sample.bytes.length,expectedContentType:sample.type,maxBytes:10000});
 assert.equal(result.detectedContentType,sample.detected);assert.equal(result.contentValidationStatus,sample.status);assert.equal(result.sha256,crypto.createHash('sha256').update(sample.bytes).digest('hex'));
 }
 const arbitrary=Buffer.from([0,1,2,3,4,5]);
 await assert.rejects(verifier.verifyStorageObject({bucket:bucketFake({chunks:[arbitrary],metadata:{size:String(arbitrary.length),contentType:'application/pdf'}}),storagePath,expectedSize:arbitrary.length,expectedContentType:'application/pdf',maxBytes:10000}));
});
