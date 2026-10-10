import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc} from 'firebase/firestore';
const projectId='demo-pay0-restriction-boundaries';assert.equal(process.env.GCLOUD_PROJECT,projectId);assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^127\.0\.0\.1:\d+$/);
const env=await initializeTestEnvironment({projectId,firestore:{rules:fs.readFileSync(path.join(process.env.PAY0_RULES_SOURCE_ROOT,'firestore.rules'),'utf8')}});
let checks=0;const check=async(p,allowed)=>{await(allowed?assertSucceeds(p):assertFails(p));checks++;};const seed=(p,d)=>env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),p),d));
try{
 await env.clearFirestore();await seed('users/delegate',{rootId:'root',active:true,role:'operador'});
 for(const c of ['good','bad']){await seed('clients/'+c,{rootId:'root',active:true});await seed('userClientAccess/delegate/clients/'+c,{rootId:'root',targetUid:'delegate',clientId:c,active:c==='good'});}
 const db=env.authenticatedContext('delegate').firestore();
 const cases=[['same-good',{clientId:'good',clienteId:'good'},true],['same-bad',{clientId:'bad',clienteId:'bad'},false],['distinct-primary',{clientId:'good',clienteId:'bad'},true],['distinct-legacy',{clientId:'bad',clienteId:'good'},true],['primary-only',{clientId:'good'},true],['legacy-only',{clienteId:'good'},true],['no-id',{},false],['null-primary',{clientId:null,clienteId:'good'},true]];
 for(const[name,ids,allowed]of cases){
  for(const family of ['solicitudes','pagos']){await seed(family+'/'+name,{rootId:'root',adminId:'other',createdBy:'other',...ids});await check(getDoc(doc(db,family,name)),allowed);}
  const write=setDoc(doc(db,'solicitudes/'+name+'/notas/note'),{text:'synthetic'});await check(write,allowed);
 }
 console.log(JSON.stringify({mode:'FIRESTORE_ALIAS_COMPATIBILITY',checks,failures:0,cloudEffects:false}));
}finally{await env.cleanup();}
