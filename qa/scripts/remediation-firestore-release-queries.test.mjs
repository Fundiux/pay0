import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,collection,query,where,orderBy,getDocs,getDoc,setDoc,onSnapshot,Timestamp} from 'firebase/firestore';
const projectId='demo-pay0-firestore-release';
assert.equal(process.env.GCLOUD_PROJECT,projectId);
assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^127\.0\.0\.1:\d+$/);
const sourceRoot=path.resolve(process.env.PAY0_RULES_SOURCE_ROOT||'.worktrees/pay0-remediation-integration-20261009');
const rules=fs.readFileSync(path.join(sourceRoot,'firestore.rules'),'utf8');
const hash=createHash('sha256').update(rules.replace(/\r\n/g,'\n')).digest('hex');
assert.equal(hash,'03cca1237bd47a9e5670c4c1411e114383788a56c7763d6e0779cd7602601dc3','Pin reviewed integration rules; re-review changed candidate');
// Keep executable query shapes tied to their actual UI sources.
for(const[file,needles]of [
 ['src/app/solicitudes/page.tsx',['where("rootId", "==", rootId)','where("adminId", "==", uid)','where("createdBy", "==", uid)','solicitudes/${commentFor.id}/notas','orderBy("createdAt", "asc")']],
 ['src/app/pagos/page.tsx',['where("adminId", "==", myUid)','where("createdBy", "==", myUid)','pagos/${notesFor.id}/notas']],
 ['src/services/beneficiaries.ts',['where("rootId", "==", rootId)','where("clientId", "==", clientId)']],
 ['src/components/DocsModal.tsx',['where("rootId", "==", solicitudRootId)','where("solicitudId", "==", solicitudId)']]
]){const source=fs.readFileSync(path.join(sourceRoot,file),'utf8');for(const needle of needles)assert.ok(source.includes(needle),'UI query contract changed');}
const env=await initializeTestEnvironment({projectId,firestore:{rules}}),rootId='root',now=Date.now();let checks=0;
const record=(uid,state)=>({schemaVersion:1,writer:'PAY0_TRUSTED_RESTRICTION_WRITER@1',policyVersion:'PAY0-CONTAINMENT@1',restrictionId:'restriction',rootId,subjectUid:uid,state:state==='revoked'?'REVOKED':'ACTIVE',scope:'ACCOUNT_OPERATIONS',authority:'HUMAN_SECURITY_ADMIN',authorityUid:'support',reasonCode:'SECURITY_REVIEW',incidentId:'incident',issuedAtMs:now-3600000,expiresAtMs:state==='expired'?now-1000:now+3600000,authorizationVersion:1,...(state==='revoked'?{revokedAtMs:now-1000,revokedBy:'support',revocationReason:'REVIEW_CLEARED'}:{})});
const seed=(p,data)=>env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),p),data));
const profile=(uid,role,state='none')=>({rootId,role,active:true,...(state==='none'?{}:{trustedRestrictionV1:record(uid,state)})});
async function check(p,allowed){await(allowed?assertSucceeds(p):assertFails(p));checks++;}
function firstServerSnapshot(q){return new Promise((resolve,reject)=>{let stop=()=>{};const timer=setTimeout(()=>{stop();reject(Error('LISTENER_TIMEOUT'));},15000);stop=onSnapshot(q,{includeMetadataChanges:true},snap=>{if(snap.metadata.fromCache)return;clearTimeout(timer);stop();resolve(snap);},error=>{clearTimeout(timer);stop();reject(error);});});}
try{
 await env.clearFirestore();
 for(const[uid,role]of [['owner','admin'],['creator','operador'],['delegate','operador'],['root','superadmin']])await seed('users/'+uid,profile(uid,role));
 await seed('clients/client',{rootId,active:true,adminId:'owner',createdBy:'owner',managedByUserId:'creator'});
 const op={rootId,clientId:'client',clienteId:'client',adminId:'owner',createdBy:'creator',operadorId:'creator'};
 for(const family of ['solicitudes','pagos','clientDispersions']){await seed(family+'/op',op);await seed(family+'/op/notas/seed',{createdAt:Timestamp.fromMillis(now),text:'synthetic'});}
 await seed('uploads/upload',{...op,solicitudId:'op',pagoId:'op'});
 await seed('pagoAplicaciones/application',{...op,solicitudId:'op',pagoId:'op'});
 for(const c of ['clientBeneficiaries','clientBeneficiaryMethods'])await seed(c+'/beneficiary',op);
 for(const[uid,role]of [['owner','admin'],['creator','operador'],['root','superadmin']])for(const state of ['none','active','expired','revoked']){
  await seed('users/'+uid,profile(uid,role,state));const db=env.authenticatedContext(uid).firestore(),allowed=state!=='active';
  const filter=uid==='root'?where('rootId','==',rootId):uid==='owner'?where('adminId','==',uid):where('createdBy','==',uid);
  for(const family of ['solicitudes','pagos','clientDispersions'])await check(getDocs(query(collection(db,family),filter)),allowed);
  const appFilters=uid==='root'?[where('rootId','==',rootId)]:[where('rootId','==',rootId),filter];
  await check(getDocs(query(collection(db,'pagoAplicaciones'),...appFilters)),allowed);
  await check(getDocs(query(collection(db,'uploads'),where('rootId','==',rootId),where('solicitudId','==','op'))),allowed);
  for(const family of ['solicitudes','pagos'])await check(firstServerSnapshot(query(collection(db,family+'/op/notas'),orderBy('createdAt','asc'))),allowed);
  for(const c of ['clientBeneficiaries','clientBeneficiaryMethods'])await check(firstServerSnapshot(query(collection(db,c),where('rootId','==',rootId),where('clientId','==','client'))),allowed);
  await check(getDoc(doc(db,'users',uid)),true);
  // UI addSolicitudNota uses a callable: direct create below tests rule boundary only.
  await check(setDoc(doc(db,'solicitudes/op/notas/'+uid+'-'+state),{createdAt:Timestamp.fromMillis(now),text:'synthetic'}),allowed);
  await check(setDoc(doc(db,'pagos/op/notas/forbidden-'+uid+'-'+state),{text:'synthetic'}),false);
 }
 await seed('users/delegate',profile('delegate','operador'));
 for(const[status,grant,allowed]of [['current',{active:true},true],['expired',{active:true,expiresAt:Timestamp.fromMillis(now-1)},false],['future',{active:true,startsAt:Timestamp.fromMillis(now+3600000)},false],['revoked',{active:true,revokedAt:Timestamp.fromMillis(now-1)},false],['inactive',{active:false},false]]){
  await seed('userClientAccess/delegate/clients/client',{rootId,targetUid:'delegate',clientId:'client',...grant});const db=env.authenticatedContext('delegate').firestore();
  for(const family of ['solicitudes','pagos']){await check(getDocs(query(collection(db,family),where('rootId','==',rootId),where('clientId','==','client'))),allowed);await check(firstServerSnapshot(query(collection(db,family+'/op/notas'),orderBy('createdAt','asc'))),allowed);}
  await check(setDoc(doc(db,'solicitudes/op/notas/delegate-'+status),{text:'synthetic'}),allowed);
 }
 console.log(JSON.stringify({mode:'FIRESTORE_RELEASE_QUERY_GATE',checks,failures:0,rulesHash:hash,projectId,productionWrites:false,lineageClosure:false}));
}finally{await env.cleanup();}
