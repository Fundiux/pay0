const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const fr=createRequire(path.resolve('functions/package.json'));
const ts=fr('typescript');
const host=process.env.FIRESTORE_EMULATOR_HOST||'';
const projectId=process.env.GCLOUD_PROJECT||process.env.GOOGLE_CLOUD_PROJECT||'';
assert.match(host,/^127\.0\.0\.1:18216$/,'Dedicated local emulator only');
assert.equal(projectId,'demo-pay0-lineage','Demo project required');
global.fetch=async()=>{throw Error('EXTERNAL_HTTP_FORBIDDEN');};
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const admin=fr('firebase-admin');admin.initializeApp({projectId});const db=admin.firestore();
const service=require('../../functions/src/modules/clientDelegations/service.ts');
const access=require('../../functions/src/modules/clientDelegations/access.ts');
const prefix=`lineage-${Date.now()}`;
const uid=name=>`${prefix}-${name}`,clientId=uid('client'),rootId=uid('root');
const user=role=>({rootId,role,active:true,modules:{usuarios:{clientDelegations:true}}});
const request=(caller,target,items=[{clientId,active:true}])=>({auth:{uid:uid(caller)},data:{targetUid:uid(target),accessItems:items}});
const resolve=target=>access.resolveClientOperationalAccess({uid:uid(target),role:'admin',rootId,clientId});
(async()=>{
 await Promise.all(['root','a','b','c','outsider'].map(name=>db.doc(`users/${uid(name)}`).set(user(name==='root'?'superadmin':'admin'))));
 await db.doc(`clients/${clientId}`).set({rootId,active:true,adminId:uid('a')});
 await service.setUserClientAccessService(request('a','b'));
 await service.setUserClientAccessService(request('b','c'));
 assert.equal((await resolve('c')).allowed,true);
 await db.doc(`userClientAccess/${uid('b')}/clients/${clientId}`).update({'permissions.operatePagos':false});
 assert.equal((await resolve('c')).permissions.operatePagos,false);
 assert.equal((await resolve('c')).permissions.operateSolicitudes,true);
 // Concurrent grant and revoke: either serialization is valid; final authority
 // must be denied, even if the grant committed before the revocation.
 await service.setUserClientAccessService(request('a','b'));
 const parent=db.doc(`userClientAccess/${uid('b')}/clients/${clientId}`);
 const race=await Promise.allSettled([service.setUserClientAccessService(request('b','c')),parent.update({active:false,revokedAt:admin.firestore.Timestamp.now()})]);
 assert.equal(race[1].status,'fulfilled');assert.equal((await resolve('c')).allowed,false);
 await service.setUserClientAccessService(request('a','b'));await service.setUserClientAccessService(request('b','c'));
 const profileRace=await Promise.allSettled([service.setUserClientAccessService(request('b','c')),db.doc(`users/${uid('b')}`).update({disabled:true})]);
 assert.equal(profileRace[1].status,'fulfilled');assert.equal((await resolve('c')).allowed,false);
 // Existing untouched grants cannot be removed by an unrelated administrator.
 const foreignClient=uid('other-client');
 await db.doc(`clients/${foreignClient}`).set({rootId,active:true,adminId:uid('outsider')});
 const foreignGrant=db.doc(`userClientAccess/${uid('c')}/clients/${foreignClient}`);
 await foreignGrant.set({rootId,targetUid:uid('c'),clientId:foreignClient,active:true,grantedBy:uid('outsider')});
 await assert.rejects(service.setUserClientAccessService(request('a','c')),error=>error.code==='permission-denied');
 assert.equal((await foreignGrant.get()).data().active,true);
 console.log('PASS emulator lineage: native transactions, transitive permission changes, simultaneous grant/revoke and actor-disable, unauthorized removal denied');
 await admin.app().delete();
})().catch(async error=>{console.error(error);try{await admin.app().delete();}catch{}process.exitCode=1;});
