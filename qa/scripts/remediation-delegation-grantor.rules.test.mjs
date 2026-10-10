import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,deleteDoc,Timestamp,collection,query,where,getDocs} from 'firebase/firestore';
const projectId='demo-pay0-delegation-grantor';
assert.equal(process.env.GCLOUD_PROJECT,projectId,'Synthetic demo project only');
assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^127\.0\.0\.1:\d+$/,'Loopback emulator required');
const root=path.resolve(process.env.PAY0_RULES_SOURCE_ROOT||path.join(path.dirname(fileURLToPath(import.meta.url)),'../..'));
const baselineControl=process.argv.includes('--baseline-control');
const compatibilityControl=process.argv.includes('--compatibility-control');
assert(!(baselineControl&&compatibilityControl),'Select one control');
const controlFixtures=baselineControl||compatibilityControl;
const source=fs.readFileSync(baselineControl?path.join(root,'.firebase/remediation-temp/grantor-guard/baseline.rules'):path.join(root,'firestore.rules'),'utf8').replace(/\r\n/g,'\n');
const hash=createHash('sha256').update(source).digest('hex');
if(baselineControl)assert.equal(hash,'7863811b85a57ff7dde6e9d3c5925253a90371dfdf4c63fc3a60bebf5ed31876','Preserved published baseline only');
else assert(source.includes('function delegationImmediateGrantorAllowed('));
const now=Date.now(), grantor='grantor', recipient='recipient';
const restriction=(patch={})=>({schemaVersion:1,writer:'PAY0_TRUSTED_RESTRICTION_WRITER@1',policyVersion:'PAY0-CONTAINMENT@1',restrictionId:'restriction',rootId:'root',subjectUid:grantor,scope:'ACCOUNT_OPERATIONS',authority:'HUMAN_SECURITY_ADMIN',authorityUid:'reviewer',incidentId:'incident',reasonCode:'SECURITY_REVIEW',authorizationVersion:1,issuedAtMs:now-7200000,expiresAtMs:now-3600000,state:'ACTIVE',...patch});
// A test-only match invokes the unchanged candidate helpers with request.time,
// so equality boundaries do not depend on client/server clock or sleep timing.
const boundaryRecord=JSON.stringify(restriction()).replace(`"issuedAtMs":${now-7200000}`,'"issuedAtMs":request.time.toMillis()-1').replace(`"expiresAtMs":${now-3600000}`,'"expiresAtMs":request.time.toMillis()');
const boundary=`
    match /__grantorProbe/{id} {
      allow read: if id == 'grantor' ? delegationImmediateGrantorAllowed(get(/databases/$(database)/documents/userClientAccess/recipient/clients/client).data, 'client', get(/databases/$(database)/documents/clients/client).data, 'root')
        : id == 'delegation' ? clientDelegationPermission('client', 'viewBasic', 'view')
        : id == 'wallet' ? hasWalletClientReadAccess('client')
        : id == 'wallet-alias' ? hasWalletClientReadAccessFromData({'clientId':'client','clienteId':'client'})
        : id == 'module' ? hasModuleAction('wallet', 'dispersiones')
        : id == 'actor' ? accountAllowed()
        : false;
    }
    match /__grantorBoundary/{id} {
      allow read: if id == 'expiry-equal' ? !validDelegationTime(request.time, true)
        : id == 'start-equal' ? validDelegationTime(request.time, false)
        : id == 'expiry-next' ? validDelegationTime(request.time.toMillis()+1, true)
        : id == 'expiry-previous' ? !validDelegationTime(request.time.toMillis()-1, true)
        : id == 'restriction-expiry-equal' ? restrictionAllowsRecord(${boundaryRecord}, 'root', 'grantor')
        : id == 'restriction-wrong-subject' ? !restrictionAllowsRecord(${boundaryRecord}, 'root', 'recipient')
        : false;
    }
`;
assert(source.endsWith('  }\n}\n')||source.endsWith('  }\n}'));
const testRules=baselineControl?source:source.replace(/  }\n}\n?$/,boundary+'  }\n}\n');
const env=await initializeTestEnvironment({projectId,firestore:{rules:testRules}});
const seed=(p,d)=>env.withSecurityRulesDisabled(c=>d===null?deleteDoc(doc(c.firestore(),p)):setDoc(doc(c.firestore(),p),d));
const collectFailures=process.argv.includes('--collect-failures');
let checks=0,attempts=0,knownGapChecks=0,budgetErrors=0;
const assertionFailures=[],budgetFailures=[];
async function check(p,allowed,label){
 const guarded=p.catch(error=>{if(/1000 expressions|maximum.*(expression|access call)|too many.*(expression|access call)/i.test(String(error?.message))){budgetErrors++;budgetFailures.push(label);console.error('GRANTOR_BUDGET_EXHAUSTED '+label);}throw error;});
 attempts++;
 try{await(allowed?assertSucceeds(guarded):assertFails(guarded));checks++;}
 catch(error){if(!collectFailures)throw error;assertionFailures.push({case:label,expected:allowed?'ALLOW':'DENY',failure:allowed?'UNEXPECTED_DENIAL':'UNEXPECTED_ALLOW'});}
}
const authority=(source,patch={})=>({version:1,source,grantorUid:grantor,parentPath:source==='DELEGATED'?'userClientAccess/grantor/clients/client':null,...patch});
const cases=[];const add=(id,patch={},allow=true)=>cases.push({id,...patch,allow});
add('legacy-current-superadmin');for(const actor of [{active:false},{isActive:false},{disabled:true},{deleted:true},{isDeleted:true},{deletedAt:0},{role:'unknown'},{role:' ADMIN '}])add('actor-lifecycle-role-'+cases.length,{actor},false);
add('actor-operator-alias',{actor:{role:'operator'}});
add('explicit-superadmin',{grant:{grantAuthority:authority('SUPERADMIN')}});
add('legacy-inactive',{grant:{active:false}},false);
for(const source of ['DIRECT','DELEGATED'])add(source.toLowerCase()+'-became-superadmin',{grant:{grantAuthority:authority(source)}});
for(const ownerField of ['adminId','ownerId','managedByUserId','createdBy','operadorId'])add('direct-'+ownerField,{user:{role:'admin'},client:{[ownerField]:grantor},grant:{grantAuthority:authority('DIRECT')}});
add('direct-owner-normalized',{user:{role:' ADMIN '},client:{ownerId:' grantor '},grant:{grantAuthority:authority('DIRECT')}});
add('direct-ownership-lost',{user:{role:'admin'},grant:{grantAuthority:authority('DIRECT')}},false);
add('superadmin-downgraded',{user:{role:'admin'},client:{adminId:grantor},grant:{grantAuthority:authority('SUPERADMIN')}},false);
add('delegated-current-parent',{user:{role:'admin'},grant:{grantAuthority:authority('DELEGATED')}});
add('delegated-now-direct',{user:{role:'admin'},client:{adminId:grantor},grant:{grantAuthority:authority('DELEGATED')}});
add('legacy-current-derived',{user:{role:'admin'}});
for(const field of ['active','isActive'])add('grantor-'+field,{user:{[field]:false}},false);
for(const field of ['disabled','deleted','isDeleted'])add('grantor-'+field,{user:{[field]:true}},false);
for(const value of [0,false,'synthetic'])add('grantor-deletedAt-'+String(value),{user:{deletedAt:value}},false);
add('missing-grantor',{missingUser:true},false);add('cross-root',{user:{rootId:'foreign'}},false);
add('empty-root-not-recipient-root',{user:{rootId:''}},false);
add('null-root-current-uid',{rootId:grantor,user:{rootId:null}});
add('zero-root-current-uid',{rootId:grantor,user:{rootId:0}});
add('empty-root-current-uid',{rootId:grantor,user:{rootId:''}});
add('trimmed-root',{user:{rootId:' root '}});
for(const role of ['operator','operador','unknown',null])add('grantor-role-'+String(role),{user:{role}},false);
add('supervisor-role-fallback',{user:{role:null,supervisorRole:'superadmin'}});
for(const key of ['view','clientDelegations'])for(const value of [false,'true',1,null])add('module-'+key+'-'+String(value),{user:{role:'admin',modules:{usuarios:{[key]:value}}}},false);
for(const modules of [null,[],false,{usuarios:null},{usuarios:[]},{usuarios:false}])add('backend-malformed-modules-default-'+cases.length,{user:{role:'admin',modules}});
add('superadmin-module-override-bypass',{user:{modules:{usuarios:{view:false,clientDelegations:false}}}});
add('grantor-active-restriction',{user:{trustedRestrictionV1:restriction({expiresAtMs:now+3600000})}},false);
add('grantor-expired-restriction',{user:{trustedRestrictionV1:restriction()}});
add('grantor-trimmed-root-expired-restriction',{user:{rootId:' root ',trustedRestrictionV1:restriction()}});
add('grantor-expired-wrong-subject',{user:{trustedRestrictionV1:restriction({subjectUid:recipient})}},false);
add('grantor-active-wrong-subject',{user:{trustedRestrictionV1:restriction({subjectUid:recipient,expiresAtMs:now+3600000})}},false);
add('grantor-expired-wrong-root',{user:{trustedRestrictionV1:restriction({rootId:'foreign'})}},false);
add('grantor-expired-self-authority',{user:{trustedRestrictionV1:restriction({authorityUid:grantor})}},false);
const revoked={state:'REVOKED',revokedAtMs:now-1000,revokedBy:'reviewer',revocationReason:'REVIEW_CLEARED'};
add('grantor-revoked-restriction',{user:{trustedRestrictionV1:restriction(revoked)}});
add('grantor-self-revoker',{user:{trustedRestrictionV1:restriction({...revoked,revokedBy:grantor})}},false);
add('grantor-recipient-revoker-valid',{user:{trustedRestrictionV1:restriction({...revoked,revokedBy:recipient})}});
// Composition: both current profiles may legitimately retain expired/revoked records.
add('both-profiles-expired-restriction',{actor:{trustedRestrictionV1:restriction({subjectUid:recipient})},user:{trustedRestrictionV1:restriction()}});
add('both-profiles-revoked-restriction',{actor:{trustedRestrictionV1:restriction({...revoked,subjectUid:recipient})},user:{trustedRestrictionV1:restriction(revoked)}});
add('direct-late-owner-expired-restriction',{user:{role:'admin',trustedRestrictionV1:restriction()},client:{operadorId:grantor},grant:{grantAuthority:authority('DIRECT')}});
for(const value of [null,[],false,{},restriction({expiresAtMs:String(now-3600000)}),restriction({extra:true})])add('grantor-restriction-invalid-'+cases.length,{user:{trustedRestrictionV1:value}},false);
for(const value of [null,[],false,{},authority('OTHER'),authority('DIRECT',{version:2}),authority('DIRECT',{version:'1'}),authority('DIRECT',{grantorUid:1}),authority('DIRECT',{grantorUid:''})])add('authority-invalid-'+cases.length,{grant:{grantAuthority:value}},false);
add('authority-trimmed-uid',{grant:{grantAuthority:authority('SUPERADMIN',{grantorUid:' grantor '})}});
add('authority-extra-field-backend-compatible',{grant:{grantAuthority:authority('SUPERADMIN',{extra:true})}});
add('self-cycle',{grant:{grantedBy:recipient}},false);
add('slash-uid',{grant:{grantedBy:'invalid/path'}},false);
for(const parentPath of [null,'userClientAccess/other/clients/client','userClientAccess/grantor/clients/other'])add('wrong-parent-'+cases.length,{user:{role:'admin'},grant:{grantAuthority:authority('DELEGATED',{parentPath})}},false);
add('grantedBy-precedes-createdBy',{grant:{createdBy:'missing'}});
add('authority-precedes-grantedBy',{grant:{grantedBy:'missing',grantAuthority:authority('SUPERADMIN')}});
add('createdBy-fallback',{grant:{grantedBy:null,createdBy:grantor}});
add('legacy-no-provenance-open',{grant:{grantedBy:null,createdBy:null},missingUser:true,gap:true});
for(const parent of [{active:false},{permissions:{operate:false}},{expiresAt:Timestamp.fromMillis(now-1)}])add('ancestor-gap-'+cases.length,{user:{role:'admin'},grant:{grantAuthority:authority('DELEGATED')},parent,gap:true});
add('child-revoked',{grant:{revokedAt:0}},false);
add('child-expired',{grant:{expiresAt:Timestamp.fromMillis(now-1)}},false);
add('child-future-start',{grant:{startsAt:Timestamp.fromMillis(now+3600000)}},false);
add('child-zero-expiry-number',{grant:{expiresAt:0}},false);
add('child-zero-start-number',{grant:{startsAt:0}},false);
add('child-zero-start-timestamp',{grant:{startsAt:Timestamp.fromMillis(0)}});
add('child-null-permissions',{grant:{permissions:null}},false);
add('child-string-permission',{grant:{permissions:{viewBasic:'true',operateSolicitudes:'true',operatePagos:'true'}}},false);
add('child-granular-deny-view',{grant:{permissions:{viewBasic:false}},vector:[false,true,true,false,true,false]});
add('child-granular-deny-operate',{grant:{permissions:{operate:false}},vector:[true,false,false,true,false,true]});
if(controlFixtures){
 const keep=new Set(['legacy-current-superadmin','actor-lifecycle-role-1','legacy-inactive','child-expired','child-revoked']);
 const selected=cases.filter(item=>keep.has(item.id));assert.equal(selected.length,5);
 cases.splice(0,cases.length,...selected);
 add('baseline-actor-restricted',{actor:{trustedRestrictionV1:restriction({subjectUid:recipient,expiresAtMs:now+3600000})}},false);
}
try{
 await env.clearFirestore();
 const db=env.authenticatedContext(recipient).firestore();
 for(const item of cases){
  const rootId=item.rootId||'root';
  await seed('users/'+recipient,{role:'operador',rootId,active:true,...item.actor});
  await seed('users/'+grantor,item.missingUser?null:{role:'superadmin',rootId,active:true,...item.user});
  await seed('users/terminal',{role:'superadmin',rootId,active:true});
  await seed('clients/client',{rootId,active:true,adminId:'other',createdBy:'other',...item.client});
  await seed('userClientAccess/'+recipient+'/clients/client',{rootId,targetUid:recipient,clientId:'client',active:true,grantedBy:grantor,...item.grant});
  await seed('userClientAccess/'+grantor+'/clients/client',{rootId,targetUid:grantor,clientId:'client',active:true,grantedBy:'terminal',...item.parent});
  const operation={rootId,clientId:'client',clienteId:'client',adminId:'other',operadorId:'other',createdBy:'other'};
  for(const family of ['solicitudes','pagos','clientDispersions']){await seed(family+'/operation',operation);await seed(family+'/operation/notas/note',{text:'synthetic'});}
  if(process.argv.includes('--budget-probe') && item===cases[0]){
   const coverageCount=async()=>{
    const response=await fetch('http://'+process.env.FIRESTORE_EMULATOR_HOST+'/emulator/v1/projects/'+projectId+':ruleCoverage');assert(response.ok);
    const json=await response.json();
    const count=node=>(node.values||[]).reduce((sum,value)=>sum+(value.count||0),0)+(node.children||[]).reduce((sum,child)=>sum+count(child),0);
    return json.report.reduce((sum,node)=>sum+count(node),0);
   };
   let previous=await coverageCount();
   for(const id of ['grantor','delegation','wallet','wallet-alias','module','actor']){
    let outcome='ALLOWED';
    try{await getDoc(doc(db,'__grantorProbe',id));}catch(error){outcome=/1000 expressions/i.test(String(error.message))?'BUDGET_EXHAUSTED':'DENIED';if(outcome==='BUDGET_EXHAUSTED')budgetErrors++;}
    const current=await coverageCount();console.log(JSON.stringify({mode:'GRANTOR_HELPER_PROBE',helper:id,outcome,observedNodeEvaluations:current-previous}));previous=current;
   }
  }
  const paths=['clients/client','solicitudes/operation','pagos/operation','clientDispersions/operation','solicitudes/operation/notas/note','clientDispersions/operation/notas/note'];
  for(const[index,p]of paths.entries())await check(getDoc(doc(db,p)),item.vector?.[index]??item.allow,item.id+':'+p);
  if(item.gap)knownGapChecks+=paths.length;
 }
 if(!controlFixtures){
 for(const id of ['expiry-equal','start-equal','expiry-next','expiry-previous','restriction-expiry-equal','restriction-wrong-subject'])await check(getDoc(doc(db,'__grantorBoundary',id)),true,'boundary:'+id);
 // Wallet alias OR is preserved; only an identical second lookup is skipped.
 await seed('users/'+recipient,{role:'operador',rootId:'root',active:true});
 await seed('users/'+grantor,{role:'superadmin',rootId:'root',active:true});
 for(const cid of ['good','bad']){
  await seed('clients/'+cid,{rootId:'root',active:true,adminId:'other'});
  await seed('userClientAccess/'+recipient+'/clients/'+cid,{active:cid==='good',grantedBy:grantor});
 }
 const aliases=[['same-good',{clientId:'good',clienteId:'good'},true],['same-bad',{clientId:'bad',clienteId:'bad'},false],['distinct-primary',{clientId:'good',clienteId:'bad'},true],['distinct-legacy',{clientId:'bad',clienteId:'good'},true],['primary-only',{clientId:'good'},true],['legacy-only',{clienteId:'good'},true],['no-id',{},false],['null-primary',{clientId:null,clienteId:'good'},true]];
 for(const [id,ids,allowed] of aliases){
  await seed('clientDispersions/operation',{rootId:'root',adminId:'other',operadorId:'other',createdBy:'other',...ids});
  await check(getDoc(doc(db,'clientDispersions/operation')),allowed,'wallet-alias:'+id);
  await check(getDoc(doc(db,'clientDispersions/operation/notas/note')),allowed,'wallet-note-alias:'+id);
 }
 // Independent wallet authority truth table; grantor failure is irrelevant to ownership.
 for(const [id,owner,delegated,allowed] of [['owner-only',true,false,true],['delegate-only',false,true,true],['both',true,true,true],['neither',false,false,false]]){
  await seed('users/'+recipient,{role:'operador',rootId:'root',active:true});
  await seed('users/'+grantor,{role:'superadmin',rootId:'root',active:delegated});
  await seed('clients/client',{rootId:'root',active:true,managedByUserId:owner?recipient:'other'});
  await seed('userClientAccess/'+recipient+'/clients/client',{active:true,grantedBy:grantor});
  await seed('clientDispersions/operation',{rootId:'root',clientId:'client',clienteId:'client',adminId:'other',operadorId:'other',createdBy:'other'});
  await check(getDoc(doc(db,'clientDispersions/operation')),allowed,'wallet-authority:'+id);
  await check(getDoc(doc(db,'clientDispersions/operation/notas/note')),allowed,'wallet-note-authority:'+id);
 }
 // Preserve the historical actor wrapper's raw-root contract.
 await seed('users/'+recipient,{role:'operador',rootId:' root ',active:true,trustedRestrictionV1:restriction({subjectUid:recipient})});
 await check(getDoc(doc(db,'solicitudes/operation')),false,'actor-raw-root-wrapper-unchanged');
 await seed('users/'+recipient,{role:'operador',rootId:'root',active:true});
 // A revoked grantor must not interfere with independent direct actor ownership.
 await seed('users/'+grantor,{role:'superadmin',rootId:'root',active:false});
 await seed('solicitudes/operation',{rootId:'root',clientId:'client',adminId:recipient,createdBy:'other'});
 await check(getDoc(doc(db,'solicitudes/operation')),true,'actor-independent-owner');
 await seed('users/'+grantor,{role:'superadmin',rootId:'root',active:true});
 await seed('userClientAccess/'+recipient+'/clients/client',{active:true,grantedBy:grantor});
 await seed('solicitudes/operation',{rootId:'root',clientId:'client',adminId:'other',createdBy:'other'});
 await check(getDocs(query(collection(db,'solicitudes'),where('rootId','==','root'),where('clientId','==','client'))),true,'client-query');
 await check(setDoc(doc(db,'solicitudes/operation/notas/new'),{text:'synthetic'}),true,'delegated-note-create');
 await seed('users/'+grantor,{role:'superadmin',rootId:'root',disabled:true});
 await check(setDoc(doc(db,'solicitudes/operation/notas/denied'),{text:'synthetic'}),false,'revoked-grantor-note-create');
 }
 assert.equal(attempts,controlFixtures?36:707,'Complete original coverage plus18 composition reads must execute');
 if(collectFailures)console.log(JSON.stringify({mode:'GRANTOR_AGGREGATE_DIAGNOSTIC',candidateSha256:hash,attempts,passedAssertions:checks,assertionFailures,budgetErrors,budgetFailures,passingGate:assertionFailures.length===0&&budgetErrors===0,externalEffects:false}));
 assert.equal(assertionFailures.length,0,'Every original access assertion must pass; aggregate collection never relaxes assertions');
 assert.equal(budgetErrors,0,'Expression/doc-access exhaustion is a failure, even for expected denies');
 console.log(JSON.stringify({mode:baselineControl?'PUBLISHED_BASELINE_CONTROL':compatibilityControl?'CANDIDATE_COMPATIBILITY_CONTROL':'IMMEDIATE_GRANTOR_RULES',candidateSha256:hash,cases:cases.length,checks,budgetErrors,knownGapChecks,ancestryClosed:false,externalEffects:false}));
}finally{
 if(process.env.PAY0_GRANTOR_COVERAGE==='1'){
  const response=await fetch('http://'+process.env.FIRESTORE_EMULATOR_HOST+'/emulator/v1/projects/'+projectId+':ruleCoverage');
  assert(response.ok,'Local rule coverage request failed');
  const target=path.join(root,'.firebase/remediation-temp/grantor-guard/coverage.json');
  fs.writeFileSync(target,JSON.stringify(await response.json()));
 }
 await env.cleanup();
}
