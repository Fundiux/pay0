const assert = require('node:assert/strict');
const fs = require('node:fs');
const cp = require('node:child_process');
const ts = require('../../functions/node_modules/typescript');
const baseline = process.env.PAY0_TEST_BASELINE === '1';
const base = 'functions/src/modules/iq/';
const read = name => baseline && ['solicitudHttpCreateA53.ts','dispersionHttpCreateCore.ts'].includes(name)
  ? cp.execFileSync('git',['show',`HEAD:${base}${name}`],{encoding:'utf8'}) : fs.readFileSync(base+name,'utf8');
function extract(file,name,deps) {
 const src=read(file), ast=ts.createSourceFile(file,src,ts.ScriptTarget.Latest,true);
 let node; const visit=n=>{if(ts.isFunctionDeclaration(n)&&n.name?.text===name)node=n;ts.forEachChild(n,visit);};visit(ast);assert(node,name);
 const code=ts.transpileModule(node.getText(ast).replace(/^export /,''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 return new Function(...Object.keys(deps),code+`;return ${name};`)(...Object.values(deps));
}
const clean=value=>String(value??'').trim();
let posts=0,effects=0,statuses=[],recoverThrows=false,authChecks=0;
global.fetch=async()=>{throw Error('NETWORK_FORBIDDEN');};
const provider=async()=>{posts++;const status=statuses.shift()??504;if(status!==401&&status!==422)effects++;return new Response(status===201?'{}':'malformed or lost upstream response',{status});};
const postOnce=extract('solicitudHttpCreateA53.ts','postOnce',{buildFormData:async()=>new FormData(),authHeaders:async()=>({}),operationTiming:()=>0,fetchIq:provider});
const invoice=extract('solicitudHttpCreateA53.ts','runIqCreateInvoiceHttpA53',{
 clean,baseResult:extract('solicitudHttpCreateA53.ts','baseResult',{clean}),apiOrigin:()=> 'https://fake.invalid',
 isIqAccessTokenUsable:()=>true,loginIqHttpDirect:async()=>({apiOrigin:'https://fake.invalid'}),
 resolveCatalog:async()=>({partnerName:'P',clientName:'C',iqClientId:'1',companyName:'Co',clientId:1,companyId:2}),postOnce,
 recoverIqId:async()=>{if(recoverThrows)throw Error('RECOVERY_TIMEOUT');return{iqId:'100',ambiguity:false};},
});
const dispersion=extract('dispersionHttpCreateCore.ts','runIqCreateDispersionHttpH4D85A50',{
 clean,DEFAULT_IQ_API_ORIGIN:'https://fake.invalid',login:async()=> 'token',fetchJson:async()=>({json:{beneficiaries:[{id:2,name:'B'}],clients:[{id:1,name:'C'}]}}),
 buildWizardUrl:()=>new URL('https://fake.invalid/wizard'),resolvePartner:()=>({id:1,name:'P'}),positiveInt:Number,operationTypeId:()=>1,
 beneficiarySearchTerm:()=> 'B',findUniqueByNormalizedNames:rows=>rows[0],asRows:value=>value||[],rowId:row=>row.id,rowName:row=>row.name,
 resolveBeneficiaryAccount:()=>({id:4}),resolveSalePercentage:()=>({id:5,label:'1%'}),money:Number,fetchIq:provider,
 resultBase:()=>({}),normalize:value=>clean(value).toUpperCase(),recoverCreatedId:async()=>({iqId:'100'}),
});
const input={apiOrigin:'https://fake.invalid',username:'u',password:'p',associatedName:'P',clientName:'C',companyName:'Co',invoiceType:'PUE',amount:10,comments:'marker',orderFilePath:'fake',orderFileName:'fake.pdf',authorizeBeforePost:async()=>{authChecks++;},item:{associatedName:'P',clientIqId:'1',currency:'MXN',operationTypeKey:'TRANSFERENCIA',beneficiaryCandidates:['B'],clientCandidates:['C'],expectedDestinationLast4:'1234',percentageLabel:'1%',amount:10}};
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
let savedStatus='';
const db={collection:name=>({doc:id=>({kind:name,id})}),runTransaction:fn=>fn({get:async ref=>({exists:true,data:()=>ref.kind==='solicitud'?{}:ref.kind==='leg'?{iqCreationStatus:savedStatus}:{status:savedStatus}})})};
const reserveInvoice=extract('solicitudCreationCallables.ts','reserveIqCreation',{db,asRecord:x=>x||{},cleanText:clean,HttpsError});
const reserveDispersion=extract('dispersionCreationCallables.ts','reserveLeg',{db,record:x=>x||{},clean,upper:x=>clean(x).toUpperCase(),HttpsError});
// Execute the actual manual consumer's final classification block.
const consumer=fs.readFileSync(base+'solicitudCreationCallables.ts','utf8');
const start=consumer.indexOf('    if (outcome === "CREATED" && iqId) {');
const end=consumer.indexOf('    const finalizeStartedAtMs',start);
assert(start>0&&end>start);
const classify=new Function('outcome','iqId','submitClicked','executionError',`let finalStatus,event,retryBlocked;${consumer.slice(start,end)}return {finalStatus,retryBlocked};`);
async function replayGuard(kind,result){
 savedStatus=kind==='invoice'?classify(result.outcome,result.iqId,result.submitClicked,null).finalStatus:result.outcome;
 const claim=()=>kind==='invoice'?reserveInvoice({solicitudId:'s',solicitudRef:{kind:'solicitud'}}):reserveDispersion({kind:'leg'},'f',{},'profile');
 await assert.rejects(claim(),error=>error.code==='failed-precondition');
}
(async()=>{
 if(baseline){
  for(const[kind,run]of[['invoice',invoice],['dispersion',dispersion]]){posts=effects=0;statuses=[504,504];const result=await run(input);assert(['REJECTED','FAILED_SAFE'].includes(result.outcome));await run(input);assert.equal(posts,2);assert.equal(effects,2);console.log(`REPRO BASELINE ${kind}: 504 after effect allows unsafe classification; replay POST=2 effects=2`);}return;
 }
 for(const[kind,run]of[['invoice',invoice],['dispersion',dispersion]]){
  for(const status of [408,409,425,429,500,502,503,504,200,202,204,302]){
   posts=effects=0;statuses=[status];const result=await run(input);assert.equal(result.outcome,kind==='invoice'?'UNKNOWN':'OUTCOME_UNKNOWN',`${kind} ${status}`);await replayGuard(kind,result);assert.equal(posts,1);assert.equal(effects,1);
  }
  posts=effects=0;statuses=[422];const rejected=await run(input);assert.equal(rejected.outcome,kind==='invoice'?'REJECTED':'FAILED_SAFE');assert.equal(effects,0);assert.equal(posts,1);
 }
 posts=effects=authChecks=0;statuses=[401,201];assert.equal((await invoice(input)).outcome,'CREATED');assert.equal(posts,2);assert.equal(effects,1);assert.equal(authChecks,4);
 posts=effects=0;statuses=[401,504];const retried=await invoice(input);await replayGuard('invoice',retried);assert.equal(posts,2);assert.equal(effects,1);
 posts=effects=0;statuses=[201];recoverThrows=true;const recovery=await invoice(input);assert.equal(recovery.outcome,'UNKNOWN');assert.equal(recovery.postAccepted,true);await replayGuard('invoice',recovery);assert.equal(posts,1);recoverThrows=false;
 console.log('PASS IQ ambiguous outcomes: 24 status/domain cases, actual replay claims blocked at one POST, controlled 422, explicit 401 refresh, 201 recovery failure preserves UNKNOWN');
})().catch(error=>{console.error(error);process.exitCode=1;});
