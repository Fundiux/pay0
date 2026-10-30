import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc} from 'firebase/firestore';
import {ref,getBytes,uploadBytes,listAll,deleteObject} from 'firebase/storage';
import {replaceRulesPolicyBlock} from '../../scripts/lib/authorization-policy-generator.mjs';
const projectId='demo-pay0-restriction-boundaries';
assert.equal(process.env.GCLOUD_PROJECT,projectId);
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST'])assert.match(process.env[key]||'',/^127\.0\.0\.1:\d+$/);
const require=createRequire(import.meta.url);
const mode=process.env.PAY0_RESTRICTION_RULES_MODE;
assert.ok(['baseline','candidate','actual'].includes(mode),'Explicit isolated rule mode required');
const candidate=mode!=='baseline';
const baseline=Object.fromEntries(['firestore','storage'].map(name=>[name,fs.readFileSync(`qa/fixtures/remediation-restriction-baseline/${name}.rules`,'utf8')]));
const rules=mode==='candidate'?require('./remediation-restriction-rules-candidate.cjs').candidateRules(baseline):mode==='baseline'?baseline:{firestore:fs.readFileSync('firestore.rules','utf8'),storage:fs.readFileSync('storage.rules','utf8')};
if(mode==='candidate')rules.firestore=replaceRulesPolicyBlock(rules.firestore,JSON.parse(fs.readFileSync('config/authorization-policy.json','utf8')));
const env=await initializeTestEnvironment({projectId,firestore:{rules:rules.firestore},storage:{rules:rules.storage}});
const rootId='r1';let checks=0;let knownDelegatedGaps=0;let blockedDelegatedReads=0;let currentCase='setup';const failures=[];
const families=[['solicitudes','solicitudes'],['pagos','pagos'],['clientDispersions','dispersiones']];
const objectPath=kind=>`roots/${rootId}/${kind}/op/docs/PDF/file.pdf`;
const check=async(p,allowed)=>{checks++;try{await(allowed?assertSucceeds(p):assertFails(p));}catch(error){failures.push({case:currentCase,check:checks,expectedAllowed:allowed,code:error.code||'ASSERTION_FAILED',expressionLimit:String(error.message||'').includes('maximum of 1000')});}};
const record=(uid,patch={})=>({schemaVersion:1,writer:'PAY0_TRUSTED_RESTRICTION_WRITER@1',policyVersion:'PAY0-CONTAINMENT@1',restrictionId:'restriction1',rootId,subjectUid:uid,state:'ACTIVE',scope:'ACCOUNT_OPERATIONS',authority:'HUMAN_SECURITY_ADMIN',authorityUid:'independent-admin',reasonCode:'SECURITY_REVIEW',incidentId:'incident1',issuedAtMs:Date.now()-10000,expiresAtMs:Date.now()+3600000,authorizationVersion:1,...patch});
async function seed(path,data){await env.withSecurityRulesDisabled(context=>setDoc(doc(context.firestore(),path),data));}
try {
 await env.clearFirestore();
 // Upload grants are create-only; a previous local run must not turn these
 // create assertions into overwrite attempts against leftover objects.
 // rules-unit-testing clearStorage only deletes top-level items in this
 // installed SDK; these fixtures live below prefixes and need recursive clear.
 await env.withSecurityRulesDisabled(async context=>{
  const clear=async location=>{const entries=await listAll(location);for(const prefix of entries.prefixes)await clear(prefix);for(const item of entries.items)await deleteObject(item);};
  await clear(ref(context.storage()));
 });
 for(const [collection,kind] of families){await seed(`${collection}/op`,{rootId,clientId:'c1',adminId:'owner',createdBy:'owner'});await env.withSecurityRulesDisabled(c=>uploadBytes(ref(c.storage(),objectPath(kind)),new TextEncoder().encode('synthetic')));}
 await seed('clients/c1',{rootId,adminId:'owner',createdBy:'owner',active:true});
 await seed('userClientAccess/delegate/clients/c1',{rootId,targetUid:'delegate',clientId:'c1',active:true});
 const states=[
 ['none',()=>undefined,true],['active',uid=>record(uid),false],
 ['expired',uid=>record(uid,{expiresAtMs:Date.now()-1000}),true],
 ['revoked',uid=>record(uid,{state:'REVOKED',revokedAtMs:Date.now()-1000,revokedBy:'support',revocationReason:'REVIEW_CLEARED'}),true],
 ['malformed-revoked',uid=>record(uid,{state:'REVOKED'}),false],
 ['wrong-root',uid=>record(uid,{rootId:'other'}),false],
 ['fake-writer',uid=>record(uid,{writer:'CLIENT_REPORTED'}),false],
 ['null',()=>null,false],['unknown-field',uid=>record(uid,{bypass:true}),false],
 ['replaced-required-field',uid=>{const row=record(uid);delete row.incidentId;row.extra=true;return row;},false],
 ['ttl-too-long',uid=>record(uid,{issuedAtMs:Date.now()-1000,expiresAtMs:Date.now()+86400000}),false],
 ['legacy-only',()=>undefined,true],
 ];
 for(const [uid,role] of [['owner','admin'],['delegate','operador'],[rootId,'superadmin']]){
  for(const [label,build,allowed] of states){
   currentCase=`${uid} ${label}`;console.log(`CASE ${currentCase}`);
   const value=build(uid);const user={rootId,role,active:true,...(value===undefined?{}:{trustedRestrictionV1:value}),...(label==='legacy-only'?{securityLock:{active:true}}:{})};
   await seed(`users/${uid}`,user);
   const context=env.authenticatedContext(uid);
   for(const [collection,kind] of families){
    await check(getDoc(doc(context.firestore(),collection,'op')),mode==='actual'&&uid==='delegate'?false:candidate?allowed:true);
    // Current rules route delegated downloads through the authorized callable.
    // Historical baseline/candidate fixtures preserve their former gap as controls.
    const storageAllowed=mode==='actual'&&uid==='delegate'?false:candidate&&uid!=='delegate'?allowed:true;
    await check(getBytes(ref(context.storage(),objectPath(kind))),storageAllowed);
    if(mode==='actual'&&uid==='delegate')blockedDelegatedReads++;
    if(candidate&&mode!=='actual'&&uid==='delegate'&&!allowed)knownDelegatedGaps++;
   }
   // Recovery bootstrap stays self-only and read-only.
   await check(getDoc(doc(context.firestore(),'users',uid)),true);
   if(!allowed&&candidate)await check(getDoc(doc(context.firestore(),'users',uid==='owner'?'delegate':'owner')),false);
   const uploadId=`${uid}-${label}`;const uploadPath=`roots/${rootId}/solicitudes/op/docs/PDF/${uploadId}.pdf`;
   await seed(`uploads/${uploadId}`,{rootId,entityType:'solicitudes',entityId:'op',createdBy:uid,status:'PENDING',storagePath:uploadPath});
   await check(uploadBytes(ref(context.storage(),uploadPath),new TextEncoder().encode('synthetic'),{customMetadata:{uploadid:uploadId}}),candidate?allowed:true);
  }
 }
 for(const blocked of [false,true]){
  currentCase=`prepared entity/assets/SAT/canonical blocked=${blocked}`;
  for(const [uid,role] of [['owner','admin'],[rootId,'superadmin']])await seed('users/'+uid,{rootId,role,active:true,...(blocked?{trustedRestrictionV1:record(uid)}:{})});
  const allowed=candidate?!blocked:true;const suffix=blocked?'restricted':'open';
  const assetPath='roots/'+rootId+'/assets/owner/documents/a-'+suffix+'/file.pdf';
  await seed('assetDocuments/a-'+suffix,{ownerUid:'owner',rootId,status:'PENDING_UPLOAD',storagePath:assetPath});
  await check(uploadBytes(ref(env.authenticatedContext('owner').storage(),assetPath),new TextEncoder().encode('synthetic'),{contentType:'application/pdf'}),allowed);
  const entityPath='roots/'+rootId+'/entityDocuments/clients/c1/CSF/e-'+suffix+'.pdf';
  await seed('entityDocuments/e-'+suffix,{rootId,entityType:'clients',entityId:'c1',documentType:'CSF',createdBy:rootId,uploadStatus:'PENDING_UPLOAD',storagePath:entityPath});
  await check(uploadBytes(ref(env.authenticatedContext(rootId).storage(),entityPath),new TextEncoder().encode('synthetic'),{customMetadata:{documentid:'e-'+suffix}}),allowed);
  for(const [uid,path] of [['owner',assetPath],[rootId,entityPath]]){
   await env.withSecurityRulesDisabled(c=>uploadBytes(ref(c.storage(),path),new TextEncoder().encode('synthetic')));
   await check(getBytes(ref(env.authenticatedContext(uid).storage(),path)),allowed);
  }
  const satName='import-'+suffix;const satPath='roots/'+rootId+'/fiscal-catalogs/sat/'+satName;
  await seed('satCatalogImports/'+satName,{rootId,createdBy:rootId,status:'PENDING_UPLOAD',storagePath:satPath});
  await check(uploadBytes(ref(env.authenticatedContext(rootId).storage(),satPath),new TextEncoder().encode('synthetic'),{contentType:'application/x-bzip2'}),allowed);
  const session='session-'+suffix;const path='pay0-canonical-staging/'+rootId+'/'+rootId+'/'+session+'/file';
  const {Timestamp}=await import('firebase/firestore');
  await seed('pay0CanonicalUploadSessions/'+session,{rootId,uid:rootId,status:'PENDING',expiresAt:Timestamp.fromMillis(Date.now()+60000),storagePath:path,contentType:'application/pdf',sizeBytes:9});
  await check(uploadBytes(ref(env.authenticatedContext(rootId).storage(),path),new TextEncoder().encode('synthetic'),{contentType:'application/pdf'}),allowed);
 }
 currentCase='inactive own profile';
 await seed('users/owner',{rootId,role:'admin',active:false});
 await check(getDoc(doc(env.authenticatedContext('owner').firestore(),'users','owner')),false);
 console.log(JSON.stringify({mode:mode==='candidate'?'ISOLATED_CANDIDATE':mode==='actual'?'ACTUAL_LOCAL_ENFORCEMENT':'BASELINE_EXPECTED_BYPASS',checks,knownDelegatedGaps,blockedDelegatedReads,failures,deployableRulesChanged:false,securityClosure:false}));
 if(failures.length)throw Error(`${failures.length} candidate boundary assertions failed; no rules application permitted`);
} finally {await env.cleanup();}
