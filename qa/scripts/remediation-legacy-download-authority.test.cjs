// Actual TypeScript callable/resolver/authorization, synthetic SDK only; no credentials or network.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const args=process.argv.slice(2);assert.ok(args.length===0||(args.length===2&&args[0]==='--source-root'),'Usage: node script --source-root checkout');
const root=path.resolve(args[1]||'.');
const entry=path.join(root,'functions/src/modules/documents/authorizedDownload.ts');
if(!fs.existsSync(entry)){console.error('SOURCE_MISSING: explicit candidate checkout required');process.exit(2);}
global.fetch=async()=>{throw Error('NETWORK_FORBIDDEN');};
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
const rows=new Map();let signatures=[],existsHook=null;
const snapshot=key=>({exists:rows.has(key),data:()=>rows.get(key),id:key.split('/').at(-1),ref:{path:key},updateTime:{toMillis:()=>1}});
const db={doc:key=>({path:key,get:async()=>snapshot(key)}),runTransaction:fn=>fn({get:async ref=>snapshot(ref.path)})};
const admin={apps:[{}],firestore:()=>db,storage:()=>({bucket:()=>({file:storagePath=>({exists:async()=>{if(existsHook){const hook=existsHook;existsHook=null;hook();}return[true];},getSignedUrl:async options=>{signatures.push({storagePath,options,now:Date.now()});return['https://signed.invalid/synthetic'];}})})})};
const cache=new Map();
function load(file,overrides={}){file=path.resolve(file);if(cache.has(file)&&!Object.keys(overrides).length)return cache.get(file);const result={};
 const deps={'firebase-admin':admin,'firebase-admin/firestore':{Timestamp:class Timestamp{}},'firebase-functions':{https:{HttpsError}},'firebase-functions/v2/https':{HttpsError,onCall:(_opts,fn)=>fn},'node:crypto':require('node:crypto'),...overrides};
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('exports','require',code)(result,name=>{if(Object.hasOwn(deps,name))return deps[name];assert.ok(name.startsWith('.'),'Unexpected dependency: '+name);return load(path.resolve(path.dirname(file),name+'.ts'));});
 if(!Object.keys(overrides).length)cache.set(file,result);return result;
}
const api=load(entry);
function reset(){rows.clear();signatures=[];existsHook=null;
 rows.set('users/root',{rootId:'root',role:'superadmin',active:true});
 for(const uid of ['a','b'])rows.set('users/'+uid,{rootId:'root',role:'admin',active:true,modules:{pagos:{view:true},usuarios:{clientDelegations:true}}});
 rows.set('clients/client',{rootId:'root',active:true,adminId:'root'});
 rows.set('userClientAccess/a/clients/client',{active:true,grantedBy:'root',permissions:{view:true,operate:true}});
 rows.set('userClientAccess/b/clients/client',{active:true,grantedBy:'a',permissions:{view:true,operate:true}});
 rows.set('pagos/payment',{rootId:'root',clientId:'client'});
 rows.set('uploads/document',{rootId:'root',entityType:'pagos',pagoId:'payment',active:true,status:'READY',storagePath:'roots/root/pagos/payment/docs/PDF/file.pdf'});
}
const call=uid=>api.getAuthorizedDocumentDownloadUrlCore({auth:{uid:uid||'b'},data:{uploadId:'document'}});
const restriction=uid=>({schemaVersion:1,writer:'PAY0_TRUSTED_RESTRICTION_WRITER@1',policyVersion:'PAY0-CONTAINMENT@1',restrictionId:'r1',rootId:'root',subjectUid:uid,state:'ACTIVE',scope:'ACCOUNT_OPERATIONS',authority:'HUMAN_SECURITY_ADMIN',authorityUid:'independent-admin',reasonCode:'SECURITY_REVIEW',incidentId:'i1',issuedAtMs:Date.now()-1000,expiresAtMs:Date.now()+3600000,authorizationVersion:1});
const deny=async fn=>{await assert.rejects(fn(),e=>e.code==='permission-denied');assert.equal(signatures.length,0,'no signed URL may be issued');};
const checks=[];const test=(name,fn)=>checks.push([name,fn]);
test('real default signer preserves URL300s wire contract',async()=>{reset();const result=await call();assert.deepEqual(result,{ok:true,uploadId:'document',url:'https://signed.invalid/synthetic',expiresInSeconds:300});assert.equal(signatures.length,1);const signed=signatures[0];assert.equal(signed.options.action,'read');assert.ok(Math.abs(signed.options.expires-signed.now-300000)<1000);});
for(const uid of ['b','root'])test('trusted restricted actor denied: '+uid,async()=>{reset();rows.get('users/'+uid).trustedRestrictionV1=restriction(uid);await deny(()=>call(uid));});
test('malformed restriction denied',async()=>{reset();rows.get('users/b').trustedRestrictionV1={};await deny(call);});
test('revoked ancestor denied',async()=>{reset();rows.get('userClientAccess/a/clients/client').active=false;await deny(call);});
test('revoked ancestor module denied',async()=>{reset();rows.get('users/a').modules.usuarios.clientDelegations=false;await deny(call);});
for(const target of ['actor','ancestor'])test('race during object existence lookup before signature: '+target,async()=>{reset();existsHook=()=>{if(target==='actor')rows.get('users/b').trustedRestrictionV1=restriction('b');else rows.get('userClientAccess/a/clients/client').active=false;};await deny(call);});
for(const field of ['storagePath','storageGeneration','pagoId'])test('document changes during existence lookup denied: '+field,async()=>{reset();existsHook=()=>{rows.get('uploads/document')[field]=field==='storagePath'?'roots/root/pagos/payment/docs/PDF/replaced.pdf':field==='storageGeneration'?'456':'other';if(field==='pagoId')rows.set('pagos/other',{rootId:'root',clientId:'client'});};await assert.rejects(call(),e=>['permission-denied','failed-precondition'].includes(e.code));assert.equal(signatures.length,0);});
test('unchanged old callable wrapper consumes wire result',async()=>{reset();const file=path.resolve(__dirname,'fixtures/legacy-authorizedDocuments-ae21267.ts.fixture');assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n')).digest('hex'),'04ae913b5bcac350e7afb9833e56f24d451e5137fa6b6c182ad30b64b587cecd','historical wrapper provenance (LF)');const wrapper=load(file,{'firebase/functions':{httpsCallable:(_functions,name)=>{assert.equal(name,'getAuthorizedDocumentDownloadUrl');return async data=>{assert.deepEqual(data,{uploadId:'document'});return{data:await api.getAuthorizedDocumentDownloadUrlCore({auth:{uid:'b'},data})};};}},'@/lib/firebaseClient':{functions:{}}});assert.equal(await wrapper.getAuthorizedDocumentDownloadUrl('document'),'https://signed.invalid/synthetic');});
test('candidate wrapper remains POST/blob bridge contract',async()=>{const calls=[];const wrapper=load(path.join(root,'src/services/authorizedDocuments.ts'),{'@/lib/downloadPrivateDocument':{downloadPrivateDocument:async(...args)=>{calls.push(args);return'blob:synthetic';}}});assert.equal(await wrapper.getAuthorizedDocumentDownloadUrl('document'),'blob:synthetic');assert.deepEqual(calls,[['uploads','document']]);});
(async()=>{let failed=0;for(const[name,fn]of checks){try{await fn();console.log('PASS '+name);}catch(error){failed++;console.log('FAIL '+name+' ['+(error.code||'ASSERTION')+'] signerCalls='+signatures.length);}}console.log(JSON.stringify({tests:checks.length,passed:checks.length-failed,failed,externalActions:0}));if(failed)process.exitCode=1;})().catch(()=>{console.error('HARNESS_FAILURE');process.exitCode=1;});
