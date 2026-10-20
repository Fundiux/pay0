const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function load(file,deps={}) { const out={}; const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText; new Function('exports','require',code)(out,name=>{assert(Object.hasOwn(deps,name),'UNEXPECTED_DEPENDENCY');return deps[name];});return out; }
const domain=load('functions/src/modules/pagos/receiptIdentificationDomain.ts');
const items=[{id:'a',name:'Cliente Demo',rfc:'ABC010101AB1',clabe:'123456789012345678'},{id:'b',name:'Otro Cliente',rfc:'DEF010101AB2',clabe:'222222222222222222'}];
const select=(signals,id,party='CLIENT',catalog=items)=>domain.selectReceiptIdentity(catalog,signals,id,{party});
test('unique normalized name automatically identifies without RFC or full account',()=>{const r=select({name:'  cliEnte   Démo '});assert.equal(r.match.id,'a');assert.equal(r.match.status,'EXACT');assert.deepEqual(r.match.reasons,[]);assert.deepEqual(r.match.evidence,['NORMALIZED_NAME_EXACT']);assert.equal(r.candidates.length,2);});
test('all authorized options remain selectable after automatic match',()=>{const r=select({name:'Cliente Demo',rfc:'ABC010101AB1'},'b');assert.equal(r.match.id,'b');assert.deepEqual(r.match.evidence,['USER_SELECTED_AUTHORIZED_CATALOG_ENTRY']);});
test('third party source account does not contradict client name',()=>{assert.equal(select({name:'Cliente Demo',account:items[1].clabe}).match.id,'a');});
test('duplicate exact names do not select first; human choice resolves',()=>{const rows=[...items,{id:'c',name:'Cliente Demo'}];assert.equal(select({name:'Cliente Demo'},undefined,'CLIENT',rows).match.id,null);assert.equal(select({name:'Cliente Demo'},'c','CLIENT',rows).match.id,'c');});
test('unknown or absent name offers catalog but never auto-picks',()=>{for(const name of [undefined,'Banco Desconocido']) {const r=select({name});assert.equal(r.match.id,null);assert.equal(r.candidates.length,2);assert.equal(select({name},'b').match.id,'b');}});
test('manual authorized choice resolves external RFC/account disagreement honestly',()=>{const signals={name:'Cliente Demo',rfc:'DEF010101AB2',account:items[1].clabe};assert.equal(select(signals).match.id,null);const r=select(signals,'a');assert.equal(r.match.id,'a');assert.deepEqual(r.match.evidence,['NORMALIZED_NAME_EXACT','USER_SELECTED_AUTHORIZED_CATALOG_ENTRY']);});
test('company destination mismatch asks selection but authorized manual choice resolves',()=>{const signals={name:'Cliente Demo',account:items[1].clabe};assert.equal(select(signals,undefined,'COMPANY').match.id,null);assert.equal(select(signals,'a','COMPANY').match.id,'a');});
test('inactive and forged catalog IDs never resolve',()=>{for(const id of ['foreign','inactive']){const r=select({name:'Cliente Demo'},id,'CLIENT',[...items,{id:'inactive',name:'Disabled',active:false}]);assert.equal(r.match.id,null);assert(r.match.reasons.includes('INVALID_SELECTION'));}});
test('complete legal suffix punctuation and spacing normalize deterministically',()=>{for(const [name,catalog] of [['Comercial Demo S de RL de CV','Comercial Demo S. de R.L. de C.V.'],['Comercial Demo SA de CV','Comercial Demo S.A. de C.V.']]){assert.equal(select({name},undefined,'CLIENT',[{id:'legal',name:catalog}]).match.id,'legal');}});
test('internal contradictory OCR RFC still blocks registration despite explicit choice',()=>{assert(domain.receiptRegistrationReasons({identityConflict:true},'DEMO').includes('CONFLICTING_RFC'));});
class HttpsError extends Error {constructor(code,message){super(message);this.code=code;}}
const authCalls=[];const denied=new Set();
const operation=load('functions/src/modules/pagos/receiptOperationType.ts',{'firebase-functions/v2/https':{HttpsError}});
const api=load('functions/src/modules/pagos/receiptIdentification.ts',{'node:crypto':require('node:crypto'),'firebase-admin/firestore':{FieldValue:{serverTimestamp:()=>0,increment:()=>1}},'firebase-functions/v2/https':{HttpsError},'../clientDelegations/access':{requireClientOperationalAccess:async input=>{authCalls.push(input);if(denied.has(input.clientId))throw new HttpsError('permission-denied','DENIED');}},'./receiptLearning':{getReceiptActorCorrectionState:()=>({version:0})},'./receiptIdentificationDomain':domain,'./receiptOperationType':operation});
const snap=row=>({exists:!!row,data:()=>row,get:key=>row?.[key]});
function fakeDb(clients,companies,operations=[{id:'OP',active:true,rootId:'r',category:'OPERACION'}]){const writes=[];const records={'despachos/d':{rootId:'r',active:true},'operationTypes/OP':{active:true}};return {writes,doc:path=>({path,get:async()=>snap(records[path])}),collection:name=>{const result=()=>({get:async()=>{const rows=name==='clients'?clients:name==='companies'?companies:operations;return {size:rows.length,docs:rows.map(row=>({id:row.id,data:()=>row}))};}});return {where:()=>({limit:result}),limit:result};},runTransaction:async fn=>fn({get:async ref=>snap(records[ref.path]),set:(ref,row)=>writes.push(row)})};}
const actor={uid:'u',rootId:'r',role:'superadmin'},receipt={senderName:'Cliente Demo',beneficiaryName:'Empresa Demo',amount:100,date:'2026-10-20',dateVerified:true,reference:'DEMO123',currency:'MXN',paymentForm:'03',amountVerified:false,executionConfirmed:false};
const client={id:'a',name:'Cliente Demo',rootId:'r'},company={id:'co',name:'Empresa Demo',rootId:'r',despachoId:'d'};
async function identify(db,extra={}){return api.identifyParsedReceipt({db,actor,receipt,contentSha256:'synthetic',operationTypeKey:'OP',...extra});}
test('server filters root, inactive and revoked clients BEFORE matching and exposing choices',async()=>{denied.add('revoked');authCalls.length=0;const db=fakeDb([client,{...client,id:'revoked'},{...client,id:'foreign',rootId:'other'},{...client,id:'inactive',active:false}],[company,{...company,id:'foreignco',rootId:'other'}]);const r=await identify(db);assert.equal(r.status,'READY');assert(r.createPayload);assert.deepEqual(r.candidates.client.map(x=>x.id),['a']);assert.deepEqual(r.candidates.company.map(x=>x.id),['co']);assert(authCalls.every(x=>x.permission==='operatePagos'&&x.rootId==='r'));for(const id of ['revoked','foreign','inactive','forged']){const bad=await identify(db,{selectedClientId:id});assert.equal(bad.status,'REQUIRES_REVIEW');assert.equal(bad.createPayload,null);assert(bad.reasons.includes('CLIENT_INVALID_SELECTION'));}denied.clear();});
test('manual choice creates only canonical authorized payload, preserving pending flags',async()=>{const db=fakeDb([client,{id:'b',rootId:'r',name:'Another'}],[company]);const r=await identify(db,{selectedClientId:'b',selectedCompanyId:'co'});assert.equal(r.status,'READY');assert.equal(r.createPayload.clienteId,'b');assert(r.evidence.client.includes('USER_SELECTED_AUTHORIZED_CATALOG_ENTRY'));assert(!r.evidence.client.includes('RFC_EXACT'));assert.equal(receipt.amountVerified,false);assert.equal(receipt.executionConfirmed,false);assert.equal(db.writes[0].stage,'IDENTIFIED');});
test('catalog 501 remains incomplete and never yields createPayload',async()=>{const rows=Array.from({length:501},(_,i)=>({id:'x'+i,rootId:'r',name:'Entry '+i}));const r=await identify(fakeDb(rows,[company]),{selectedClientId:'x0'});assert(r.reasons.includes('CATALOG_REQUIRES_REVIEW'));assert.equal(r.createPayload,null);});

test('drop without selected IDs registers only unique authorized names and leaves ambiguity manual',async()=>{
  const db=fakeDb([client],[company]);const proposed=await identify(db);
  assert.equal(proposed.status,'READY');assert(proposed.createPayload);
  assert.equal(proposed.verifiedMatches.client.id,'a');assert.equal(proposed.verifiedMatches.company.id,'co');
  const ambiguous=await identify(fakeDb([client,{...client,id:'duplicate'}],[company]));
  assert.equal(ambiguous.status,'REQUIRES_REVIEW');assert.equal(ambiguous.createPayload,null);assert(ambiguous.reasons.includes('CLIENT_MULTIPLE_CANDIDATES'));
  const confirmed=await identify(fakeDb([client,{...client,id:'duplicate'}],[company]),{selectedClientId:'a'});
  assert.equal(confirmed.status,'READY');assert.equal(confirmed.createPayload.clienteId,'a');
});
test('strong RFC evidence preserves old client READY contract without selected IDs',async()=>{
  const db=fakeDb([{...client,rfc:'ABC010101AB1'}],[{...company,rfc:'DEF010101AB2'}]);
  const r=await identify(db,{receipt:{...receipt,payerRfc:'ABC010101AB1',beneficiaryRfc:'DEF010101AB2'}});
  assert.equal(r.status,'READY');assert(r.createPayload);assert(!r.reasons.length);
});

test('canonical clienteNombre legacy field participates in exact matching',()=>{assert.equal(select({name:'Cliente Legacy'},undefined,'CLIENT',[{id:'legacy',clienteNombre:'Cliente Legacy'}]).match.id,'legacy');});
test('legal suffix collision stays manual, and no suffix or substring is silently discarded',()=>{
 const rows=[{id:'a',name:'Comercial Demo S. de R.L. de C.V.'},{id:'b',name:'Comercial Demo S de RL de CV'}];
 assert.equal(select({name:'Comercial Demo S DE RL DE CV'},undefined,'CLIENT',rows).match.id,null);
 for(const name of ['Comercial Demo','Comercial Demo SA DE CV','Demo S DE RL DE CV','Comercial Demos S DE RL DE CV'])assert.equal(select({name},undefined,'CLIENT',[rows[0]]).match.id,null);
});

test('empty operation auto-resolves one canonical permitted catalog key even when identities need review',async()=>{
 const r=await identify(fakeDb([client],[company]),{operationTypeKey:''});assert.equal(r.status,'READY');assert.equal(r.resolvedOperationTypeKey,'OP');assert.equal(r.createPayload.operationTypeKey,'OP');
 const ambiguous=await identify(fakeDb([client,{...client,id:'second'}],[company]),{operationTypeKey:''});assert.equal(ambiguous.status,'REQUIRES_REVIEW');assert.equal(ambiguous.createPayload,null);assert.equal(ambiguous.resolvedOperationTypeKey,'OP');
});
test('multiple, missing or foreign operation catalogs never choose first',async()=>{
 for(const operations of [[],[{id:'FOREIGN',active:true,rootId:'other'}],[{id:'OP',active:true,rootId:'r'},{id:'OTHER',active:true,rootId:'r'}]]){
 const r=await identify(fakeDb([client],[company],operations),{operationTypeKey:''});assert.equal(r.status,'REQUIRES_REVIEW');assert.equal(r.createPayload,null);assert.equal(r.resolvedOperationTypeKey,undefined);assert(r.reasons.includes('MISSING_OPERATION_TYPE'));
 }
});
