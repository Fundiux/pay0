import { buildGrantorCases } from './helpers/grantor-cases.mjs';
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
const representativeComposition=process.argv.includes('--representative-composition');
// Current production boundary: delegated data travels through authenticated
// callables. Without this flag the original direct-SDK oracle is preserved as a
// historical control and intentionally is not the deployment gate.
const backendMediated=process.argv.includes('--backend-mediated');
assert(!(baselineControl&&compatibilityControl),'Select one control');
const controlFixtures=baselineControl||compatibilityControl;
assert(!(representativeComposition&&controlFixtures),'Representative composition requires current rules');
assert(!(backendMediated&&controlFixtures),'Backend-mediated boundary requires current rules');
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
const collectFailures=representativeComposition||process.argv.includes('--collect-failures');
let checks=0,attempts=0,knownGapChecks=0,budgetErrors=0;
const assertionFailures=[],budgetFailures=[];
async function check(p,allowed,label){
 const guarded=p.catch(error=>{if(/1000 expressions|maximum.*(expression|access call)|too many.*(expression|access call)/i.test(String(error?.message))){budgetErrors++;budgetFailures.push(label);console.error('GRANTOR_BUDGET_EXHAUSTED '+label);}throw error;});
 attempts++;
 try{await(allowed?assertSucceeds(guarded):assertFails(guarded));checks++;}
 catch(error){if(!collectFailures)throw error;assertionFailures.push({case:label,expected:allowed?'ALLOW':'DENY',failure:allowed?'UNEXPECTED_DENIAL':'UNEXPECTED_ALLOW'});}
}
const { cases, add, authority, revoked } = buildGrantorCases({ now, grantor, recipient, Timestamp, restriction });
if(controlFixtures){
 const keep=new Set(['legacy-current-superadmin','actor-lifecycle-role-1','legacy-inactive','child-expired','child-revoked']);
 const selected=cases.filter(item=>keep.has(item.id));assert.equal(selected.length,5);
 cases.splice(0,cases.length,...selected);
 add('baseline-actor-restricted',{actor:{trustedRestrictionV1:restriction({subjectUid:recipient,expiresAtMs:now+3600000})}},false);
}
if(representativeComposition){
 // Preserve the default707 oracle. This separate regression combines explicit
 // production-shaped maps with both valid revoked records, retaining all35
 // boundary/alias/ownership/query/write controls below. Expected access stays
 // ALLOW: budget denials remain failures rather than becoming accepted output.
 cases.splice(0,cases.length);
 add('representative-explicit-revoked',{
  actor:{trustedRestrictionV1:restriction({...revoked,subjectUid:recipient}),modules:{clientes:{view:true},solicitudes:{view:true,comment:true},pagos:{view:true},wallet:{view:true,dispersiones:true}}},
  user:{role:'admin',trustedRestrictionV1:restriction(revoked),modules:{usuarios:{view:true,clientDelegations:true}}},
  client:{operadorId:grantor},
  grant:{grantAuthority:authority('DIRECT'),permissions:{viewBasic:true,operateSolicitudes:true,operatePagos:true},startsAt:now-10000,expiresAt:now+3600000}
 });
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
  for(const[index,p]of paths.entries())await check(getDoc(doc(db,p)),backendMediated?false:item.vector?.[index]??item.allow,item.id+':'+p);
  if(item.gap&&!backendMediated)knownGapChecks+=paths.length;
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
  await check(getDoc(doc(db,'clientDispersions/operation')),backendMediated?false:allowed,'wallet-alias:'+id);
  await check(getDoc(doc(db,'clientDispersions/operation/notas/note')),backendMediated?false:allowed,'wallet-note-alias:'+id);
 }
 // Independent wallet authority truth table; grantor failure is irrelevant to ownership.
 for(const [id,owner,delegated,allowed] of [['owner-only',true,false,true],['delegate-only',false,true,true],['both',true,true,true],['neither',false,false,false]]){
  await seed('users/'+recipient,{role:'operador',rootId:'root',active:true});
  await seed('users/'+grantor,{role:'superadmin',rootId:'root',active:delegated});
  await seed('clients/client',{rootId:'root',active:true,managedByUserId:owner?recipient:'other'});
  await seed('userClientAccess/'+recipient+'/clients/client',{active:true,grantedBy:grantor});
  await seed('clientDispersions/operation',{rootId:'root',clientId:'client',clienteId:'client',adminId:'other',operadorId:'other',createdBy:'other'});
  await check(getDoc(doc(db,'clientDispersions/operation')),backendMediated?owner:allowed,'wallet-authority:'+id);
  await check(getDoc(doc(db,'clientDispersions/operation/notas/note')),backendMediated?owner:allowed,'wallet-note-authority:'+id);
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
 await check(getDocs(query(collection(db,'solicitudes'),where('rootId','==','root'),where('clientId','==','client'))),!backendMediated,'client-query');
 await check(setDoc(doc(db,'solicitudes/operation/notas/new'),{text:'synthetic'}),!backendMediated,'delegated-note-create');
 await seed('users/'+grantor,{role:'superadmin',rootId:'root',disabled:true});
 await check(setDoc(doc(db,'solicitudes/operation/notas/denied'),{text:'synthetic'}),false,'revoked-grantor-note-create');
 }
 assert.equal(attempts,controlFixtures?36:representativeComposition?41:707,'Complete selected coverage must execute: original707 or representative41');
 if(collectFailures)console.log(JSON.stringify({mode:representativeComposition?'GRANTOR_REPRESENTATIVE_COMPOSITION':'GRANTOR_AGGREGATE_DIAGNOSTIC',candidateSha256:hash,attempts,passedAssertions:checks,assertionFailures,budgetErrors,budgetFailures,passingGate:assertionFailures.length===0&&budgetErrors===0,externalEffects:false}));
 assert.equal(assertionFailures.length,0,'Every original access assertion must pass; aggregate collection never relaxes assertions');
 assert.equal(budgetErrors,0,'Expression/doc-access exhaustion is a failure, even for expected denies');
 console.log(JSON.stringify({mode:backendMediated?'FIRESTORE_BACKEND_MEDIATED_BOUNDARY':baselineControl?'PUBLISHED_BASELINE_CONTROL':compatibilityControl?'CANDIDATE_COMPATIBILITY_CONTROL':'IMMEDIATE_GRANTOR_RULES',candidateSha256:hash,cases:cases.length,checks,budgetErrors,knownGapChecks,ancestryClosed:backendMediated,backendPositiveGate:backendMediated?'security-operational-readflow.emulator.test.cjs':null,externalEffects:false}));
}finally{
 if(process.env.PAY0_GRANTOR_COVERAGE==='1'){
  const response=await fetch('http://'+process.env.FIRESTORE_EMULATOR_HOST+'/emulator/v1/projects/'+projectId+':ruleCoverage');
  assert(response.ok,'Local rule coverage request failed');
  const target=path.join(root,'.firebase/remediation-temp/grantor-guard/coverage.json');
  fs.writeFileSync(target,JSON.stringify(await response.json()));
 }
 await env.cleanup();
}
