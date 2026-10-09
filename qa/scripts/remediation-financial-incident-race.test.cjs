const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module'),fr=createRequire(path.resolve('functions/package.json')),ts=fr('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {assertAuthorized}=require('../../functions/src/utils/authGuard.ts');
const {assertDispersionFundingOwner}=require('../../functions/src/modules/financing/dispersionFunding.ts');
const {HttpsError}=fr('firebase-functions/v2/https');
global.fetch=async()=>{throw Error('EXTERNAL_NETWORK_FORBIDDEN');};
const file='functions/src/modules/financing/callables.ts',baseline=process.env.PAY0_EXPECT_VULNERABLE==='1';
const source=baseline?require('node:child_process').execFileSync('git',['show',`deed00a:${file}`],{encoding:'utf8'}):fs.readFileSync(file,'utf8');
const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);let callback;
function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='requestClientDispersionIncident')callback=n.initializer.arguments[1].getText(ast);ts.forEachChild(n,visit);}visit(ast);assert(callback);
const code=ts.transpileModule('const handler='+callback+';',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
let rows,versions,writes,audits,attempts,interleave,accessChecks;
const clone=value=>value===undefined?undefined:structuredClone(value);
function mutate(p,patch){rows.set(p,{...rows.get(p),...patch});versions.set(p,(versions.get(p)||0)+1);}
function snapshot(ref){const data=clone(rows.get(ref.path));return{exists:!!data,data:()=>clone(data),ref};}
const db={doc:p=>({path:p,get:async()=>snapshot({path:p}),set:async data=>{mutate(p,data);writes++;}}),runTransaction:async fn=>{
 for(let retry=0;retry<5;retry++){
  attempts++;const reads=new Map(),pending=[];let localAudits=0;
  const tx={get:async ref=>{assert.equal(pending.length,0,'reads must precede writes');reads.set(ref.path,versions.get(ref.path)||0);return snapshot(ref);},set:(ref,data)=>pending.push([ref.path,data]),audit:()=>{localAudits++;}};
  await fn(tx);
  if([...reads].some(([p,v])=>(versions.get(p)||0)!==v))continue;
  for(const[p,data]of pending){mutate(p,data);writes++;}audits+=localAudits;return;
 }throw Error('Retry exhausted');
}};
const access=async input=>{accessChecks++;if(!baseline)assert(input.transaction,'client authority must share transaction');if(interleave){const action=interleave;interleave=null;action();}return{allowed:true};};
const handler=new Function('db','assertAuthorized','assertDispersionFundingOwner','HttpsError','FieldValue','requireClientOperationalAccess','logActivity','logActivityTx',code+'return handler;')(db,assertAuthorized,assertDispersionFundingOwner,HttpsError,{serverTimestamp:()=>1},access,async()=>{audits++;},tx=>tx.audit());
const request={auth:{uid:'root',token:{}},data:{dispersionId:'disp',incidentType:'CANCELACION'}};
function reset(){writes=audits=attempts=accessChecks=0;interleave=null;versions=new Map();rows=new Map([['users/root',{active:true,role:'superadmin',rootId:'root'}],['clientDispersions/disp',{rootId:'root',clientId:'client',fundingSource:{holderType:'CLIENT'},status:'REGISTRADA',incidentStatus:null,amount:100}]]);}
(async()=>{
 reset();interleave=()=>mutate('clientDispersions/disp',{status:'CANCELADA',incidentStatus:'RESUELTA'});
 if(baseline){await handler(request);assert.equal(rows.get('clientDispersions/disp').status,'CANCELADA');assert.equal(rows.get('clientDispersions/disp').incidentStatus,'SOLICITADA');assert.equal(writes,1);console.log(JSON.stringify({reproduced:true,lateIncidentWrites:writes,terminalStatus:'CANCELADA',incidentStatus:'SOLICITADA',externalEffects:0}));return;}
 await assert.rejects(handler(request),e=>e.code==='failed-precondition');assert.equal(attempts,2);assert.equal(writes,0);assert.equal(audits,0);assert.equal(rows.get('clientDispersions/disp').incidentStatus,'RESUELTA');
 for(const [patch,expected]of [[{status:'DEVUELTA'},'failed-precondition'],[{incidentStatus:'SOLICITADA',incidentType:'DEVOLUCION'},'failed-precondition'],[{rootId:'foreign'},'permission-denied']]){reset();interleave=()=>mutate('clientDispersions/disp',patch);await assert.rejects(handler(request),e=>e.code===expected);assert.equal(writes,0);assert.equal(audits,0);assert.equal(attempts,2);}
 reset();interleave=()=>mutate('users/root',{disabled:true});await assert.rejects(handler(request),e=>e.code==='permission-denied');assert.equal(writes,0);assert.equal(audits,0);
 reset();const result=await handler(request);assert.equal(result.incidentStatus,'SOLICITADA');assert.equal(writes,1);assert.equal(audits,1);await assert.rejects(handler(request),e=>e.code==='failed-precondition');assert.equal(writes,1);assert.equal(audits,1);
 reset();delete rows.get('clientDispersions/disp').rootId;await handler(request);assert.equal(writes,1,'legacy root policy intentionally unchanged');
 console.log(JSON.stringify({ok:true,terminalRaceDenied:true,competingIncidentPreserved:true,rootChangeDenied:true,actorDisabledDenied:true,successfulWriteAndAudit:1,replayWrites:0,legacyRootUnchanged:true,externalEffects:0}));
})().catch(error=>{console.error(error);process.exitCode=1;});
