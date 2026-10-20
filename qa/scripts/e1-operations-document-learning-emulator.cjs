const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
assert.match(process.env.GCLOUD_PROJECT||'',/^demo-pay0-e1-/);assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^127\.0\.0\.1:\d+$/);
global.fetch=async()=>{throw Error('EXTERNAL_PROVIDER_FORBIDDEN')};
for(const protocol of ['http','https']){const api=require('node:'+protocol),original=api.request;api.request=function(url,...args){const host=typeof url==='string'||url instanceof URL?new URL(url).hostname:String(url.hostname||url.host||'').split(':')[0];assert.ok(['127.0.0.1','localhost'].includes(host),'EXTERNAL_HTTP_FORBIDDEN');return original.call(this,url,...args)}}
const workspace=path.resolve(__dirname,'../..'),ts=require('../../functions/node_modules/typescript');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const config=ts.readConfigFile(path.join(workspace,'functions/tsconfig.json'),ts.sys.readFile),options=ts.convertCompilerOptionsFromJson(config.config.compilerOptions,path.join(workspace,'functions')).options;
const functionsRoot=path.resolve(process.env.PAY0_DOCUMENT_FUNCTIONS_ROOT||path.join(workspace,'functions')),sourceRoot=path.resolve(process.env.PAY0_DOCUMENT_SOURCE_ROOT||functionsRoot);
for(const directory of [functionsRoot,sourceRoot])assert.ok(directory.startsWith(workspace+path.sep),'WORKSPACE_ONLY');
const load=require('node:module').createRequire(path.join(functionsRoot,'package.json'));
const matched=[];
for(const name of ['receiptPdfCallables','receiptLearning','receiptSemantics','receiptIdentification']){
 const source=path.join(sourceRoot,'src/modules/pagos',name+'.ts');if(!fs.existsSync(source))continue;
 const emitted=ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:options,fileName:source}).outputText.replace(/\r\n/g,'\n').replace(/\/\/# sourceMappingURL=.*\n?$/,'');
 const actual=fs.readFileSync(path.join(functionsRoot,'lib/modules/pagos',name+'.js'),'utf8').replace(/\r\n/g,'\n').replace(/\/\/# sourceMappingURL=.*\n?$/,'');
 assert.equal(actual,emitted,'COMPILED_RECEIPT_SOURCE_MISMATCH:'+name);matched.push({name,sourceSha256:sha(fs.readFileSync(source)),compiledSha256:sha(Buffer.from(actual))});
}
const admin=load('firebase-admin');admin.initializeApp({projectId:process.env.GCLOUD_PROJECT});const db=admin.firestore();
const calls=load('./lib/modules/pagos/receiptPdfCallables');
const {jsPDF}=require('jspdf');
function pdf(label){const doc=new jsPDF();doc.text(['BBVA','Comprobante de transferencia','Fecha: 10/09/2026','Importe de transferencia: $12.34','Concepto: '+label,'Referencia: DEMO123','Beneficiario: DEMO DESTINO','Ordenante: DEMO ORIGEN'],10,20);return Buffer.from(doc.output('arraybuffer'))}
const rootId='document-learning-root',uid='document-actor',other='document-other',foreign='document-foreign';let checks=0;
const invoke=(endpoint,actor,data)=>calls[endpoint].run({auth:actor?{uid:actor,token:{}}:null,data});
async function parse(actor,bytes){return invoke('parsePagoReceiptPdf',actor,{originalName:'sintetico.pdf',contentType:'application/pdf',sizeBytes:bytes.length,base64:bytes.toString('base64')})}
(async()=>{
 const archive=process.env.PAY0_DOCUMENT_ARCHIVE?path.resolve(process.env.PAY0_DOCUMENT_ARCHIVE):null;
 let verifyArchive=async()=>{};let archiveSha256=null;
 if(archive){assert.ok(archive.startsWith(path.join(workspace,'.firebase/modular-release')+path.sep));const bytes=fs.readFileSync(archive);archiveSha256=sha(bytes);assert.equal(archiveSha256,process.env.PAY0_DOCUMENT_ARCHIVE_SHA);const zip=await require('../../functions/node_modules/jszip').loadAsync(bytes);verifyArchive=async()=>{for(const entry of Object.values(zip.files))if(!entry.dir)assert.deepEqual(fs.readFileSync(path.join(functionsRoot,entry.name)),await entry.async('nodebuffer'),'ARTIFACT_CHANGED:'+entry.name)};await verifyArchive()}
 await Promise.all([[uid,rootId],[other,rootId],[foreign,'foreign-root']].map(([id,root])=>db.doc('users/'+id).set({rootId:root,role:'operador',active:true})));
 const bytes=pdf('DEMO ORIGINAL'),first=await parse(uid,bytes);assert.equal(first.providerCalls,0);assert.ok(first.analysisId);assert.ok(first.semanticReceipt.fields.concept.value);checks+=3;
 const request={analysisId:first.analysisId,field:'concept',correctedField:'concept',correctedValue:'DEMO CORREGIDO',expectedCorrectionVersion:first.correctionVersion};
 const corrected=await invoke('correctPagoReceiptSemanticField',uid,request);assert.equal(corrected.ok,true);assert.equal(corrected.semanticReceipt.fields.concept.value,'DEMO CORREGIDO');assert.equal(corrected.semanticReceipt.fields.concept.provenance,'HUMAN_CORRECTION');checks+=3;
 const repeat=await parse(uid,bytes);assert.equal(repeat.providerCalls,0);assert.equal(repeat.semanticReceipt.fields.concept.value,'DEMO CORREGIDO');assert.equal(repeat.correctionVersion,corrected.correctionVersion);checks+=3;
 const isolated=await parse(other,bytes);assert.notEqual(isolated.semanticReceipt.fields.concept.value,'DEMO CORREGIDO');checks++;
 await assert.rejects(invoke('correctPagoReceiptSemanticField',foreign,request),e=>e.code==='not-found');checks++;
 await assert.rejects(invoke('correctPagoReceiptSemanticField',uid,{...request,correctedValue:'STALE'}),e=>e.code==='aborted');checks++;
 await db.doc('users/'+uid).update({disabled:true});await assert.rejects(parse(uid,bytes),e=>e.code==='permission-denied');await assert.rejects(invoke('correctPagoReceiptSemanticField',uid,{...request,expectedCorrectionVersion:corrected.correctionVersion}),e=>e.code==='permission-denied');checks+=2;
 await assert.rejects(parse(null,bytes),e=>e.code==='unauthenticated');checks++;
 const different=await parse(other,pdf('OTRO DOCUMENTO'));assert.notEqual(different.semanticReceipt.fields.concept.value,'DEMO CORREGIDO');assert.equal(different.providerCalls,0);checks+=2;
 for(const collection of ['pagos','solicitudes','paymentApplications']){assert.equal((await db.collection(collection).get()).empty,true,'NO_FINANCIAL_WRITES:'+collection);checks++}
 const correction=await db.doc('pagoReceiptCorrections/'+corrected.correctionId).get();assert.equal(correction.get('rootId'),rootId);assert.equal(correction.get('humanCorrection.actorUid'),uid);checks+=2;
 // Legacy caller fixture: original four identifiers, omitted expectedCorrectionVersion.
 const legacyId=crypto.createHash('sha256').update('legacy-document-fixture').digest('hex'),legacyRef=db.doc('pagoReceiptAnalyses/'+legacyId);
 const legacyFields=Object.fromEntries(['reference','trackingKey','folio','transactionId'].map(field=>[field,{value:'DEMO-'+field,normalizedValue:'DEMO-'+field,rawValue:'DEMO-'+field,label:field,decision:'REVIEW'}]));
 await legacyRef.set({rootId,readerVersion:'SYNTHETIC_LEGACY',contentSha256:'d'.repeat(64),receipt:{},semanticReceipt:{readerVersion:'SYNTHETIC_LEGACY',fields:legacyFields}});
 const legacyInput={analysisId:legacyId,field:'reference',correctedField:'folio',correctedValue:'LEGACY-REFERENCE'};
 const legacyConcurrent=await Promise.all(Array.from({length:8},()=>invoke('correctPagoReceiptSemanticField',other,legacyInput)));
 assert.equal(new Set(legacyConcurrent.map(x=>x.correctionId)).size,1);assert.equal((await legacyRef.get()).get('correctionVersionsByActor.'+other),1);checks+=2;
 for(const field of ['trackingKey','folio','transactionId']){const result=await invoke('correctPagoReceiptSemanticField',other,{analysisId:legacyId,field,correctedField:field,correctedValue:'LEGACY-'+field});assert.equal(result.ok,true);checks++}
 assert.equal((await legacyRef.get()).get('correctionVersionsByActor.'+other),4);checks++;
 const repeated=await invoke('correctPagoReceiptSemanticField',other,legacyInput);assert.equal(repeated.correctionId,legacyConcurrent[0].correctionId);assert.equal(repeated.correctionVersion,4);checks+=2;
 await assert.rejects(invoke('correctPagoReceiptSemanticField',other,{...legacyInput,correctedValue:'NO-STALE',expectedCorrectionVersion:0}),e=>e.code==='aborted');checks++;
 await assert.rejects(invoke('correctPagoReceiptSemanticField',foreign,legacyInput),e=>e.code==='not-found');checks++;
 assert.equal((await db.collection('pagos').get()).empty,true);checks++;
 await verifyArchive();const proof={status:'PASS',archiveSha256,checks,surface:'REAL_CALLABLE_REAL_TEXT_PDF_REAL_FIRESTORE',legacyCallerFixture:'FOUR_IDENTIFIERS_OMITTED_VERSION_CONCURRENT_RETRY',providerCalls:0,financialWrites:0,compiledSource:matched};
 const output=path.resolve(process.env.PAY0_DOCUMENT_PROOF_FILE||path.join(workspace,'tmp/document-learning-emulator-proof.json'));assert.ok(output.startsWith(workspace+path.sep));fs.writeFileSync(output,JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));await admin.app().delete();
})().catch(error=>{console.error(error);process.exitCode=1});
