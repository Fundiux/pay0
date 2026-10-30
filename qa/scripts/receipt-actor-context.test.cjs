const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),Module=require('node:module');
const root=path.resolve(process.env.PAY0_RECEIPT_IDENTITY_UI_ROOT||'.');assert(root.startsWith(path.resolve('.')));
const emit=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
function load(file,imports={}){const p=path.join(root,file),m=new Module(p,module);m.filename=p;m.require=name=>{if(Object.hasOwn(imports,name))return imports[name];throw Error('UNEXPECTED_IMPORT '+name);};m._compile(emit(fs.readFileSync(p,'utf8')),p);return m.exports;}
const context=load('src/lib/receiptOperationPreference.ts');const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function actor(){const original={scope:'root/u',uid:'u',epoch:1};let current={...original},uid='u';return{original,guard:()=>context.assertReceiptActorContext(original,current,uid),switchAuth(){uid='other';},switchRoot(){current={scope:'other/u',uid:'u',epoch:2};},restoreWithNewEpoch(){current={...original,epoch:3};},isCurrent(){try{this.guard();return true;}catch{return false;}}};}
test('Actor context rejects Firebase uid changes before React updates, root changes and ABA epoch reuse',()=>{const a=actor();a.guard();a.switchAuth();assert.throws(a.guard);const b=actor();b.switchRoot();assert.throws(b.guard);b.restoreWithNewEpoch();assert.throws(b.guard);});
test('Auth changes during file reading dispatch zero parser calls; callback is never serialized in correction',async()=>{
 const a=actor(),read=deferred();let calls=0,body;
 const service=load('src/services/pagoReceipt.ts',{'firebase/functions':{httpsCallable:()=>async payload=>{calls++;body=payload;return{data:{}};}},'@/lib/firebaseClient':{functions:{}}});
 const pending=service.parsePagoReceiptPdfFile({name:'fixture.pdf',type:'application/pdf',size:3,arrayBuffer:()=>read.promise},{assertContext:a.guard});a.switchAuth();read.resolve(new Uint8Array([1,2,3]).buffer);await assert.rejects(pending);assert.equal(calls,0);
 const b=actor();await service.correctPagoReceiptSemanticField({analysisId:'a',field:'reference',correctedField:'folio',correctedValue:'x',assertContext:b.guard});assert.equal(calls,1);assert(!Object.hasOwn(body,'assertContext'));assert(!JSON.stringify(body).includes('assertContext'));
});
test('Upload init pending actor change dispatches no Storage or finalize; upload pending cancels and never finalizes',async()=>{
 for(const phase of ['init','upload']){const a=actor(),init=deferred(),initStarted=deferred(),storageStarted=deferred();let storageCalls=0,finalizeCalls=0,cancelled=0,progress;
 const utility=load('src/lib/uploadPagoDoc.ts',{'firebase/storage':{ref:()=>({}),uploadBytesResumable:()=>{storageCalls++;storageStarted.resolve();return{cancel:()=>{cancelled++;},on:(_event,onProgress,_reject,complete)=>{progress=()=>onProgress({totalBytes:3,bytesTransferred:1});if(phase==='init')complete();}};}},'firebase/functions':{httpsCallable:(_functions,name)=>async()=>{if(name==='INIT'){initStarted.resolve();return init.promise;}finalizeCalls++;return{data:{}};}},'@/lib/firebaseClient':{functions:{},storage:{}},'@/lib/callableNames':{CALLABLES:{initPagoDocumentUpload:'INIT',finalizePagoDocumentUpload:'FINAL'}}});
 const pending=utility.uploadPagoDoc({pagoId:'server-payment',documentType:'COMPROBANTE_PAGO',file:new File(['abc'],'fixture.pdf'),assertContext:a.guard});const denied=assert.rejects(pending);await initStarted.promise;
 if(phase==='init')a.switchAuth();init.resolve({data:{uploadId:'upload',storagePath:'authorized/path'}});
 if(phase==='upload'){await storageStarted.promise;assert.equal(storageCalls,1);a.switchAuth();progress();}
 await denied;assert.equal(storageCalls,phase==='init'?0:1);assert.equal(finalizeCalls,0);assert.equal(cancelled,phase==='upload'?1:0);
 }
});
function declaration(name){const file=path.join(root,'src/app/pagos/page.tsx'),s=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let result;function walk(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)result=n.getText(ast);ts.forEachChild(n,walk);}walk(ast);assert(result,name);return result;}
test('Actual void drop entry returns cleanly when Firebase auth changed before React updates',async()=>{
 const a=actor();a.switchAuth();const fn=new Function('receiptContextRef','receiptItemIsCurrent',emit(declaration('analyzeReceiptBatch'))+';return analyzeReceiptBatch;')({current:a.original},()=>a.isCurrent());
 await assert.doesNotReject(fn([]));
});
test('Actual worker drops stale pending parse without creating, uploading or publishing old UI state',async()=>{
 const a=actor(),parse=deferred();let creates=0,updates=0;
 const fn=new Function('item','receiptItemIsCurrent','assertReceiptItemCurrent','parsePagoReceiptPdfFile','receiptResolvedOperationTypeKey','receiptCanResumeRegisteredUpload','automaticReceiptPayload','registerReceiptItem','setReceiptBatchItems','findUniqueReceiptCatalogMatch','clientes','companies','let cursor=0;const queue=[item];'+emit(declaration('worker'))+';return worker();');
 const pending=fn({key:'r',file:{},receiptContext:a.original},()=>a.isCurrent(),a.guard,()=>parse.promise,()=>'',()=>false,()=>({}),async()=>{creates++;},()=>{updates++;},()=>null,[],[]);const before=updates;a.switchAuth();parse.resolve({identification:{status:'READY'}});await pending;assert.equal(creates,0);assert.equal(updates,before);
});
test('Actual create wrapper allows one already-dispatched create but no subsequent upload or UI after actor changes',async()=>{
 const a=actor(),create=deferred();let creates=0,uploads=0,published=0;
 const fn=new Function('pagosRequestSeq','createPago','uploadPagoDoc',emit(declaration('createPagoWithReceipt'))+';return createPagoWithReceipt;')({current:1},async()=>{creates++;return create.promise;},async()=>{uploads++;});
 const pending=fn({clienteId:'client',companyId:'company',receiptIdentificationId:'a'.repeat(64),file:{},assertContext:a.guard,onPagoCreated:()=>{published++;}});assert.equal(creates,1);a.switchAuth();create.resolve({pagoId:'created-under-original-auth'});await assert.rejects(pending);assert.equal(creates,1);assert.equal(uploads,0);assert.equal(published,0);
});
