// Loads the unmodified compiled notification helper from a captured production ZIP.
// All database, storage, logging and Telegram boundaries are synthetic; no SDK or network is loaded.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const capture=JSON.parse(fs.readFileSync(process.argv[2])),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(sha(fs.readFileSync(capture.archive)),capture.archiveSha256);
const compiled=fs.readFileSync(process.argv[4]||path.join(capture.directory,'lib/modules/telegram/clientNotifications.js'),'utf8');
function fixture(options={}){
 const rows=options.rows||new Map(),effects=[],writes=[];let failed=false;
 const put=(c,id,data)=>rows.set(c+'/'+id,{...data});
 for(const [id,type] of [['pdf','FACTURA_PDF'],['xml','FACTURA_XML']])put('uploads',id,{rootId:'root-a',solicitudId:'sol-a',active:true,documentType:type,storagePath:'synthetic/'+id,originalName:id,contentType:type==='FACTURA_PDF'?'application/pdf':'application/xml'});
 put('solicitudes','sol-a',{rootId:options.foreignSolicitud?'root-b':'root-a',clientId:'client-a',folio:'fixture',total:1});
 put('clients','client-a',{rootId:options.foreignClient?'root-b':'root-a'});
 put('clientTelegramUsers','local',{rootId:'root-a',clientId:'client-a',active:true,chatId:'chat-local'});
 if(options.foreignRecipient){rows.delete('clientTelegramUsers/local');put('clientTelegramUsers','foreign',{rootId:'root-b',clientId:'client-a',active:true,chatId:'chat-foreign'});}
 const snap=(id,data)=>({id,exists:data!==undefined,data:()=>data&&({...data})});
 const collection=c=>{
  const query=filters=>({where:(k,op,v)=>{assert.equal(op,'==');return query([...filters,[k,v]])},limit:()=>query(filters),get:async()=>{const docs=[...rows].filter(([k,v])=>k.startsWith(c+'/')&&filters.every(([f,e])=>v[f]===e)).map(([k,v])=>snap(k.slice(c.length+1),v));return{docs,forEach:fn=>docs.forEach(fn)}}});
  return {...query([]),doc:id=>({get:async()=>{const result=snap(id,rows.get(c+'/'+id));if(c==='telegramClientNotificationEvents'&&options.beforeReceiptReturn)await options.beforeReceiptReturn();return result},create:async data=>{if(options.claimFailure)throw Error('synthetic database failure');if(rows.has(c+'/'+id)){const error=Error('exists');error.code=6;throw error}writes.push(c);put(c,id,data)},set:async(data,opt)=>{writes.push(c);put(c,id,opt?.merge?{...rows.get(c+'/'+id),...data}:data)}})};
 };
 const admin={apps:[{}],firestore:Object.assign(()=>({collection}),{FieldValue:{serverTimestamp:()=>1}}),storage:()=>({bucket:()=>({file:()=>({exists:async()=>[true],download:async()=>[Buffer.from('synthetic document')]})})})};
 const provider=async(kind,token,chat)=>{effects.push({kind,chat});if(options.uncertain&&kind==='document'&&!failed){failed=true;throw Error('synthetic uncertain delivery');}return{ok:true}};
 const allowed={'firebase-admin':admin,'../../utils/logActivity':{logActivity:async()=>{}},'firebase-functions':{logger:{error:()=>{}}},'firebase-functions/params':{defineSecret:()=>({value:()=> 'synthetic-token'})},'./commands':{buildClientFacturaDeliveryMessage:()=> 'synthetic message'},'./service':{sendTelegramMessage:(...a)=>provider('text',...a),sendTelegramDocumentBuffer:(...a)=>provider('document',...a)}};
 const exports={};vm.runInNewContext(options.compiled||compiled,{exports,Buffer,require:name=>{assert(Object.hasOwn(allowed,name),'UNEXPECTED_IMPORT');return allowed[name]}},{filename:'captured-clientNotifications.js',timeout:3000});
 return {run:()=>exports.notifyClientFacturaDisponibleFromUploadId('pdf'),effects,writes,rows};
}
(async()=>{
 const results=[];
 const sequential=fixture();await sequential.run();await sequential.run();results.push({scenario:'sequential duplicate after successful delivery',expectedProviderAttempts:3,actualProviderAttempts:sequential.effects.length,pass:sequential.effects.length===3});
 const concurrent=fixture();await Promise.all(Array.from({length:8},()=>concurrent.run()));results.push({scenario:'eight simultaneous requests',maximumProviderAttempts:3,actualProviderAttempts:concurrent.effects.length,pass:concurrent.effects.length<=3});
 const uncertain=fixture({uncertain:true});await uncertain.run();const first=uncertain.effects.length;await uncertain.run();results.push({scenario:'replay after uncertain partial delivery',expectedAdditionalProviderAttempts:0,actualAdditionalProviderAttempts:uncertain.effects.length-first,pass:uncertain.effects.length===first});
 const foreign=fixture({foreignRecipient:true});await foreign.run();results.push({scenario:'foreign-root linked recipient fixture',expectedProviderAttempts:0,actualProviderAttempts:foreign.effects.length,pass:foreign.effects.length===0});
 const foreignSolicitud=fixture({foreignSolicitud:true});await foreignSolicitud.run().catch(()=>{});results.push({scenario:'foreign-root solicitud fixture at notification boundary',expectedProviderAttempts:0,actualProviderAttempts:foreignSolicitud.effects.length,pass:foreignSolicitud.effects.length===0});
 if(process.argv[4]){
  const foreignClient=fixture({foreignClient:true});await foreignClient.run();results.push({scenario:'foreign-root client rejected',pass:foreignClient.effects.length===0});
  const claimFailure=fixture({claimFailure:true});await claimFailure.run().catch(()=>{});results.push({scenario:'claim failure prevents all sends',pass:claimFailure.effects.length===0});
  for(const status of ['PENDING','SENT','FAILED','UNCERTAIN','SKIPPED']){const legacy=fixture();legacy.rows.set('telegramClientNotificationEvents/FACTURA_CLIENTE_client-a_sol-a_pdf_xml',{status});await legacy.run();results.push({scenario:'legacy '+status+' receipt is not repeated',pass:legacy.effects.length===0});}
  const restarted=fixture({rows:uncertain.rows});await restarted.run();results.push({scenario:'new module instance retains uncertain receipt',pass:restarted.effects.length===0});
  const old=fixture({rows:uncertain.rows,compiled:fs.readFileSync(path.join(capture.directory,'lib/modules/telegram/clientNotifications.js'),'utf8')});await old.run();results.push({scenario:'old-code rollback preserves uncertain receipt',actualProviderAttempts:old.effects.length,pass:old.effects.length===0,releaseGate:true});
  let enter,release;const entered=new Promise(r=>enter=r),held=new Promise(r=>release=r),mixed=fixture(),legacyInFlight=fixture({rows:mixed.rows,compiled:fs.readFileSync(path.join(capture.directory,'lib/modules/telegram/clientNotifications.js'),'utf8'),beforeReceiptReturn:async()=>{enter();await held}});const oldRequest=legacyInFlight.run();await entered;await mixed.run();release();await oldRequest;results.push({scenario:'legacy request held after stale receipt read overlaps candidate',maximumProviderAttempts:3,actualProviderAttempts:mixed.effects.length+legacyInFlight.effects.length,pass:mixed.effects.length+legacyInFlight.effects.length<=3,releaseGate:true});
 }
 const financialCollections=['pagos','solicitudes','wallets','dispersiones'];const financialWrites=[sequential,concurrent,uncertain,foreign,foreignSolicitud].flatMap(x=>x.writes).filter(c=>financialCollections.includes(c));assert.equal(financialWrites.length,0);
 const report={status:results.every(r=>r.pass)?'PASS_BOUNDARY_ONLY':'NO_PUBLISH',artifactKind:process.argv[4]?'ISOLATED_COMPILED_CANDIDATE':'EXACT_PRODUCTION_MODULE',archiveSha256:capture.archiveSha256,revision:capture.revision,compiledModuleSha256:sha(Buffer.from(compiled)),results,financialWrites:0,realProviderCalls:0,productionWrites:0,limits:'Synthetic dependency-boundary reproduction on a captured production helper or explicitly identified compiled candidate; not a full callable/emulator certification or proof of an externally exploitable authorization bypass.',realAudio:'PENDING'};
 fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(report.status==='NO_PUBLISH')process.exitCode=2;
})().catch(e=>{console.error(e.name);process.exitCode=1});
