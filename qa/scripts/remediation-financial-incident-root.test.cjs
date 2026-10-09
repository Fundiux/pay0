const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module'),fr=createRequire(path.resolve('functions/package.json')),ts=fr('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {assertAuthorized}=require('../../functions/src/utils/authGuard.ts');
const {assertDispersionFundingOwner}=require('../../functions/src/modules/financing/dispersionFunding.ts');
const {HttpsError}=fr('firebase-functions/v2/https');
const file='functions/src/modules/financing/callables.ts';
global.fetch=async()=>{throw Error('EXTERNAL_NETWORK_FORBIDDEN');};
const source=process.env.PAY0_EXPECT_VULNERABLE==='1' ? require('node:child_process').execFileSync('git',['show',`6b8d2f7:${file}`],{encoding:'utf8'}) : fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
let callback;
function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='resolveClientDispersionIncident')callback=n.initializer.arguments[1].getText(ast);ts.forEachChild(n,visit);}visit(ast);assert(callback);
const code=ts.transpileModule('const handler='+callback+';',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
let rows,writes,reversals,audits;
function snapshot(ref){const data=structuredClone(rows.get(ref.path));return{exists:!!data,data:()=>data,ref};}
const db={doc:p=>({path:p,get:async()=>snapshot({path:p})}),runTransaction:async fn=>{const pending=[];const tx={get:async ref=>snapshot(ref),set:(ref,data)=>pending.push([ref.path,data])};await fn(tx);for(const[p,data]of pending){rows.set(p,{...rows.get(p),...data});writes++;}}};
const reverse=async input=>{reversals++;input.tx.set(db.doc('syntheticLedger/reintegration'),{rootId:input.dispersion.rootId,amount:100});return{reintegrated:true,reintegrationMovementId:'synthetic',beforeBalance:0,afterBalance:100,reintegrationAmount:100,reversedEarningsAmount:0,reversalMovementIds:{}};};
const handler=new Function('db','assertAuthorized','assertDispersionFundingOwner','HttpsError','FieldValue','reverseCanonicalDispersionFinancialsTx','logActivityTx',code+'return handler;')(db,assertAuthorized,assertDispersionFundingOwner,HttpsError,{serverTimestamp:()=>1},reverse,async()=>{audits++;});
function reset(root='root-a',fundingSource={holderType:'CLIENT'}){writes=reversals=audits=0;rows=new Map([['users/root-a',{active:true,role:'superadmin',rootId:'root-a'}],['clientDispersions/disp',{rootId:root,ownerUid:'owner',clientId:'client',clienteId:'client',fundingSource,status:'REGISTRADA',incidentStatus:'SOLICITADA',incidentType:'CANCELACION',amount:100,folio:'SYNTHETIC'}]]);}
const request={auth:{uid:'root-a',token:{}},data:{dispersionId:'disp',decision:'CANCELACION_APLICADA'}};
(async()=>{
 reset('root-b');
 if(process.env.PAY0_EXPECT_VULNERABLE==='1'){
  const result=await handler(request);assert.equal(result.reintegrated,true);assert.equal(reversals,1);assert.equal(rows.get('clientDispersions/disp').status,'CANCELADA');
  console.log(JSON.stringify({reproduced:true,foreignRootReversals:reversals,foreignRootWrites:writes,externalEffects:0}));return;
 }
 for(const root of ['root-b','',undefined]){reset(root);if(root===undefined)delete rows.get('clientDispersions/disp').rootId;await assert.rejects(handler(request),e=>e.code==='permission-denied');assert.equal(reversals,0);assert.equal(writes,0);}
 reset();const result=await handler(request);assert.equal(result.reintegrated,true);assert.equal(reversals,1);assert.equal(rows.get('clientDispersions/disp').status,'CANCELADA');
 await assert.rejects(handler(request),e=>e.code==='failed-precondition');assert.equal(reversals,1,'replay must not reintegrate twice');
 reset('root-a',{holderType:'USER',ownerUid:'owner',sourceClientId:'client'});await assert.rejects(handler(request),e=>e.code==='failed-precondition');assert.equal(reversals,0);assert.equal(writes,0);
 reset();const rejected=await handler({...request,data:{...request.data,decision:'RECHAZADA'}});assert.equal(rejected.reintegrated,false);assert.equal(reversals,0);assert.equal(rows.get('clientDispersions/disp').incidentStatus,'RESUELTA');
 console.log(JSON.stringify({ok:true,foreignOrMissingRootDenied:3,ownRootReversal:1,replayReversalCount:1,userFundingDenied:true,rejectedIncidentNoReversal:true,externalEffects:0}));
})().catch(error=>{console.error(error);process.exitCode=1;});
