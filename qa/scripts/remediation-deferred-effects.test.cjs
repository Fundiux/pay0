const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const ts = require('typescript');
const fr = createRequire(path.resolve('functions/package.json'));
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText, filename);
global.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
const guard = require('../../functions/src/utils/authGuard.ts');
const restriction = require('../../functions/src/modules/users/restrictions.ts');
const {HttpsError} = fr('firebase-functions/v2/https');
function load(file, deps) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  new Function('exports', 'require', code)(exports, name => {assert(name in deps, name);return deps[name];});
  return exports;
}
let profile, legacy = null, granted = true, posts = 0, states = [];
const db = {doc: name => ({get: async () => ({exists: !!(name.startsWith('users/') ? profile : legacy), data: () => name.startsWith('users/') ? profile : legacy})})};
const authorization = load('functions/src/utils/authorizeDeferredIntent.ts', {
  'firebase-admin/firestore': {getFirestore: () => db}, 'firebase-functions/v2/https': {HttpsError}, './authGuard': guard,
  '../modules/clientDelegations/access': {requireClientOperationalAccess: async () => {if(!granted)throw new HttpsError('permission-denied','REVOKED_GRANT');}},
});
const helpers = load('functions/src/modules/sharedCallables/helpers.ts', {
  'firebase-admin/app': {getApps: () => [{}]}, 'firebase-admin/firestore': {getFirestore: () => db},
  'firebase-functions/v2/https': {HttpsError}, '../../utils/authGuard': guard, '../pagos/domain': {},
});
const core = load('functions/src/modules/iq/depositHttpCreateCore.ts', {
  'node:crypto': require('node:crypto'), './iqDateTime': require('../../functions/src/modules/iq/iqDateTime.ts'),
  '../../utils/operationTiming': {operationTiming(){}}, './iqHttpClient': {fetchIq: async (_url, options) => {
    if(options.method === 'POST'){posts++;throw Error('ETIMEDOUT_AFTER_EFFECT');}
    return new Response('[]',{status:200});
  }},
});
const valid = () => ({rootId:'root',role:'operador',active:true,modules:{pagos:{create:true,conciliate:true}}});
const now = Date.now();
const trusted = {schemaVersion:1,writer:restriction.TRUSTED_RESTRICTION_WRITER,policyVersion:restriction.TRUSTED_RESTRICTION_POLICY,
  restrictionId:'restriction',rootId:'root',subjectUid:'actor',state:'ACTIVE',scope:'ACCOUNT_OPERATIONS',authority:'HUMAN_SECURITY_ADMIN',
  authorityUid:'security',reasonCode:'SECURITY_REVIEW',incidentId:'incident',issuedAtMs:now-1000,expiresAtMs:now+3600000,authorizationVersion:1};
const authorize = () => authorization.authorizeDeferredIntent({uid:'actor',rootId:'root',module:'pagos',action:['create','conciliate'],clientId:'client',permission:'operatePagos'});

function extract(file, name, deps) {
  const ast=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  let node;function find(n){if((ts.isFunctionDeclaration(n)&&n.name?.text===name)||(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name))node=n;ts.forEachChild(n,find);}find(ast);assert(node,name);
  const text=ts.isVariableDeclaration(node)?`const ${node.getText(ast)};`:node.getText(ast).replace(/^export\s+/,'');
  const code=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return new Function(...Object.keys(deps),`${code};return ${name};`)(...Object.values(deps));
}
let job, providerPosts=0, lookups=0, nextMutation=null;
const jobRef={path:'job',get:async()=>({data:()=>job})};
const refData=ref=>ref===jobRef?job:{facturamaEnabled:true};
const fakeDb={doc:path=>({path}),collection:()=>({where:()=>({get:async()=>({docs:[{data:()=>({applicationId:'app'})}]})})}),
  runTransaction:async fn=>fn({get:async ref=>({data:()=>refData(ref)}),update:(_ref,patch)=>Object.assign(job,patch)})};
const sourceFor=async()=>({source:{rootId:'root',provider:job.provider,pagoId:'payment',solicitudId:'sol'},app:{iqApplicationStatus:'IQ_APPLIED',iqActionExecuted:true},solicitud:{clienteId:'client',companyId:'company',despachoId:'pay0'},pago:{}});
const deps={db:fakeDb,jobs:()=>({doc:()=>jobRef}),sourceFor,authorizeDeferredIntent:authorization.authorizeDeferredIntent,
  text:x=>String(x??'').trim(),FieldValue:{serverTimestamp:()=>now},Timestamp:{fromDate:x=>x,fromMillis:x=>x},
  inspectIqComplementGate:async()=>({allowed:true}),claimIqComplementGate:async()=>({allowed:true}),
  updateJob:async(_id,patch)=>Object.assign(job,patch),markIqSending:async()=>Object.assign(job,{status:'SENDING',attemptedAt:{toMillis:()=>now}}),
  markProtectedEffectIntent:async()=>{},confirmProtectedEffect:async()=>{},reportProtectedFailure:()=>{},
  classifyFailure:()=>({result:'QUARANTINED'}),errorCode:e=>e.code==='permission-denied'?'AUTH_STOPPED':e.message,
  PAY0_DISPATCH_ID:'pay0',assertPay0Issuer:async()=>{},hash:()=> 'hash',markReceived:async()=>{},
  dayMexico:()=> '2026-10-10',millis:x=>Number(x)||0,recordBlockedIqGate:async()=>{},overdue:()=>false,verifiedDocuments:async()=>{}};
const execute=extract('functions/src/modules/paymentApplications/complementAutomation.ts','executeComplement',deps);
const daily=extract('functions/src/modules/paymentApplications/complementAutomation.ts','checkComplementDaily',deps);
const provider={iqSession:async(_job,action)=>{if(action==='REQUEST'&&nextMutation)nextMutation();return{};},preflightIqComplement:async()=> 'REQUEST',
  requestIqComplement:async()=>{providerPosts++;throw Error('ETIMEDOUT_AFTER_EFFECT');},availableIqComplement:async()=>{lookups++;return null;},
  prepareFacturamaComplement:async()=>{if(nextMutation)nextMutation();return{};},emitFacturamaComplement:async()=>{providerPosts++;throw Error('ETIMEDOUT_AFTER_EFFECT');}};
const freshJob=provider=>({rootId:'root',provider,clientId:'client',actorUid:'actor',applicationId:'app',status:'QUEUED',originIqProfileId:'historical-profile'});
async function run() {
  for(const providerName of ['IQ','FACTURAMA'])for(const change of [{disabled:true},{active:false},{rootId:'other'},{trustedRestrictionV1:trusted},{modules:{pagos:{create:false,conciliate:false}}}]) {
    job=freshJob(providerName);profile=valid();granted=true;
    nextMutation=()=>{profile={...profile,...change};};const before=providerPosts;
    await execute('job',provider);assert.equal(providerPosts,before);assert.equal(job.status,'BLOCKED');assert.equal(job.error,'AUTH_STOPPED');
    assert.equal(job.originIqProfileId,'historical-profile');
  }
  job=freshJob('IQ');profile=valid();nextMutation=null;await execute('job',provider);assert.equal(job.status,'UNKNOWN');assert.equal(providerPosts,1);
  profile={...profile,trustedRestrictionV1:trusted};await execute('job',provider);assert.equal(providerPosts,1);
  await daily('job',new Date(now+86400000),provider);assert.equal(lookups,1);assert.equal(job.status,'UNKNOWN');assert.equal(providerPosts,1);

  const gateCode=fs.readFileSync('functions/src/modules/paymentApplications/complementGates.ts','utf8');
  const ast=ts.createSourceFile('gate.ts',gateCode,ts.ScriptTarget.Latest,true);
  const wanted=['decide','clamp','isDurableReconciliation','effectiveProfileId','isIqRepRequestHardEnabled','REP_REQUEST_HARD_DISABLED'];
  const blocks=[];for(const n of ast.statements){if(ts.isFunctionDeclaration(n)&&wanted.includes(n.name?.text))blocks.push(n.getText(ast));if(ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>wanted.includes(d.name.getText(ast))))blocks.push(n.getText(ast).replace(/^export\s+/,''));}
  const code=ts.transpileModule(blocks.join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const decide=new Function('getUserRole','assertAuthorized',`${code};return decide;`)(guard.getUserRole,guard.assertAuthorized);
  const legacy={...freshJob('IQ'),originIqProfileId:null,profileId:'legacy-profile',status:'UNKNOWN',attemptedAt:{toMillis:()=>now}};
  const cfg={rootId:'root',iqRequestEnabled:true,iqEnabled:true},master={enabled:true,automation:{aplicacionPagos:true}},iqProfile={rootId:'root',active:true,hasPassword:true,username:'synthetic'};
  assert.equal(decide(legacy,'LOOKUP',cfg,master,null,null,iqProfile).allowed,true);
  assert.equal(decide(legacy,'REQUEST',cfg,master,null,null,iqProfile).allowed,false);
  assert.equal(decide({...legacy,attemptedAt:null},'LOOKUP',cfg,master,null,null,iqProfile).allowed,false);
  assert.equal(decide(legacy,'LOOKUP',cfg,master,null,null,{...iqProfile,rootId:'foreign'}).allowed,false);

  let dispersion={rootId:'root',clientId:'client',fundingSource:{holderType:'CLIENT'}};
  const fundingGuard=require('../../functions/src/modules/financing/dispersionFunding.ts');
  const input={allowCommissionExecution:true};
  const auth={uid:'actor',rootId:'root',role:'operador'};
  const dispersionGuard=extract('functions/src/modules/iq/dispersionCreationCallables.ts','authorizeBeforePost',{
    principalRef:{get:async()=>({data:()=>dispersion})},record:x=>x||{},clean:x=>String(x??'').trim(),auth,input,assertDispersionFundingOwner:fundingGuard.assertDispersionFundingOwner,HttpsError,authorizeDeferredIntent:authorization.authorizeDeferredIntent});
  profile={...valid(),modules:{wallet:{dispersiones:true}}};granted=true;await dispersionGuard();
  profile={...profile,trustedRestrictionV1:trusted};await assert.rejects(dispersionGuard());
  profile={...valid(),modules:{wallet:{dispersiones:true}}};granted=false;await assert.rejects(dispersionGuard());
  dispersion={...dispersion,ownerUid:'actor',fundingSource:{holderType:'USER',ownerUid:'actor',sourceClientId:'client'}};await dispersionGuard();
  dispersion.fundingSource.ownerUid='other';await assert.rejects(dispersionGuard());
  console.log('PASS deferred effects: IQ/Facturama profile changes before request=0 effects; UNKNOWN lookup=1/replayPOST=0; legacy durable lookup bounded; USER funding owner preserved');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
