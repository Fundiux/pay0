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
const httpAst = ts.createSourceFile('http.ts', fs.readFileSync('functions/src/modules/iq/pagoDepositCallables.ts','utf8'), ts.ScriptTarget.Latest, true);
let httpNode;
function find(node) {if(ts.isVariableDeclaration(node) && node.name.getText(httpAst)==='getHttpAuthContextH4D50F')httpNode=node;ts.forEachChild(node,find);}
find(httpAst);assert(httpNode);
const httpCode = ts.transpileModule(`const ${httpNode.getText(httpAst)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const httpAuth = new Function('admin','db','HttpsError','cleanText','asRecord','assertAuthorized',`${httpCode};return getHttpAuthContextH4D50F;`)(
  {auth:()=>({verifyIdToken:async()=>({uid:'actor',role:'superadmin',rootId:'forged-claim'})})},
  {collection:()=>({doc:()=>({get:async()=>({exists:!!profile,data:()=>profile})})})},HttpsError,x=>String(x??'').trim(),x=>x||{},guard.assertAuthorized);
const solAst = ts.createSourceFile('sol.ts',fs.readFileSync('functions/src/modules/iq/solicitudHttpCreateA53.ts','utf8'),ts.ScriptTarget.Latest,true);
const solPost = solAst.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='postOnce');assert(solPost);
const solCode = ts.transpileModule(solPost.getText(solAst),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const postSolicitud = new Function('buildFormData','operationTiming','fetchIq','authHeaders',`${solCode};return postOnce;`)(
  async()=>{profile={...profile,trustedRestrictionV1:trusted};return new FormData();},()=>{},async()=>{posts++;return new Response('{}');},async()=>({}));
async function effect() {
  return core.createIqDepositHttpControlled({
    authorizeBeforePost: authorize, auth:{apiOrigin:'http://127.0.0.1',bearerToken:'synthetic'},
    identity:{pay0PagoId:'payment',iqAttemptId:'attempt',pay0CreatedAtIso:'2026-10-06T20:00:00Z',partnerId:1,partnerName:'Partner',clientId:2,clientName:'Client',companyId:3,companyName:'Company',operationTypeId:4,operationTypeName:'Deposit',saleType:'standard',sum:100,currency:'mxn',expectedSalePercentageId:1,expectedBasePercentage:'0',expectedSalePercentage:'0'},
    voucher:{bytes:new Uint8Array([1]),originalName:'synthetic.pdf',mimeType:'application/pdf'},
    lock:{acquire:async()=>({lockKey:'test',lockedAtIso:new Date().toISOString(),leaseExpiresAtIso:new Date(Date.now()+60000).toISOString()}),release:async()=>{}},
    journal:{transition:async row=>states.push(row.state),linkIqIdWriteOnce:async()=>{throw Error('UNEXPECTED_LINK');}},
    allowHttpPost:true,recovery:{pollingBackoffMs:[0],maxPages:1,pageSize:100},
  });
}
async function run() {
  const changes = [null,{active:false},{isActive:false},{disabled:true},{deleted:true},{isDeleted:true},{deletedAt:now},
    {rootId:'foreign'},{role:'unknown'},{modules:{pagos:{create:false,conciliate:false}}},{trustedRestrictionV1:trusted},{trustedRestrictionV1:null}];
  for (const change of changes) {
    profile = valid(); granted = true; await authorize(); // enqueue authorized
    profile = change === null ? null : {...profile,...change};
    await assert.rejects(authorize()); // execution admission
    await assert.rejects(effect()); // revoked after enqueue, checked immediately before POST
    if (change?.rootId !== 'foreign') await assert.rejects(httpAuth({headers:{authorization:'Bearer synthetic'}}));
    assert.equal(posts,0);
    assert(!states.includes('POST_IN_PROGRESS'));
  }
  profile = {...valid(),role:'superadmin',trustedRestrictionV1:trusted}; await assert.rejects(authorize());
  profile=valid();await authorize();await assert.rejects(postSolicitud({apiOrigin:'http://127.0.0.1'},{key:'sol'},{clientId:1,companyId:1},authorize));assert.equal(posts,0,'Solicitud revocation during file preparation is checked before POST');
  profile = valid();await authorize();granted=false;await assert.rejects(effect());assert.equal(posts,0);granted=true;
  const currentHttp=await httpAuth({headers:{authorization:'Bearer synthetic'}});assert.equal(currentHttp.role,'operador');assert.equal(currentHttp.rootId,'root');
  profile = valid();const user=await helpers.getMyUser('actor');assert.equal(helpers.requireRole(user,['operador']),'operador');
  await assert.rejects(async()=>helpers.requireRole({...user,uid:'actor'},['operador']),/iniciar/);
  profile=null;legacy=valid();await assert.rejects(helpers.getMyUser('actor'),/perfil PAY0/);legacy=null;
  assert.equal(await helpers.getMyUser('actor'),null);
  profile=valid();assert.equal((await effect()).state,'OUTCOME_UNKNOWN');assert.equal(posts,1);
  profile={...profile,trustedRestrictionV1:trusted};await assert.rejects(effect());assert.equal(posts,1);
  assert.equal(states.at(-1),'OUTCOME_UNKNOWN','Denial did not downgrade an uncertain external effect');
  console.log('PASS deferred authority: lifecycle/permission/root/restriction/grant changes deny admission and prePOST; zero forbidden effects; UNKNOWN preserved; canonical helper identity');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
