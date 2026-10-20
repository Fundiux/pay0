import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
// Exact parent/notes predicates before the dedicated actor-cache refactor.
// Provenance: candidate LF SHA256 9f41257059f8979a56e89ea96b62c534b540a1445de42d2a2d46a6a871f9445b.
// This restricted interpreter is differential evidence, never an emulator replacement.
const previousRestrictionBodies = {"restrictionRecordValid": "\n      return row is map\n        && row.keys().size() == (row.state == 'ACTIVE' ? 15 : 18)\n        && row.schemaVersion == 1\n        && row.writer == 'PAY0_TRUSTED_RESTRICTION_WRITER@1'\n        && row.policyVersion == 'PAY0-CONTAINMENT@1'\n        && restrictionId(row.restrictionId)\n        && restrictionId(rootId) && row.rootId == rootId\n        && restrictionId(subjectUid) && row.subjectUid == subjectUid\n        && row.scope == 'ACCOUNT_OPERATIONS'\n        && row.authority == 'HUMAN_SECURITY_ADMIN'\n        && restrictionId(row.authorityUid) && row.authorityUid != subjectUid\n        && restrictionId(row.incidentId)\n        && row.reasonCode in ['SECURITY_REVIEW','CREDENTIAL_COMPROMISE_CONFIRMED','SUPPORT_CONTAINMENT']\n        && row.authorizationVersion is int && row.authorizationVersion >= 1 && row.authorizationVersion <= 9007199254740991\n        && restrictionMillis(row.issuedAtMs) && restrictionMillis(row.expiresAtMs)\n        && row.issuedAtMs <= request.time.toMillis() && row.expiresAtMs > row.issuedAtMs\n        && row.expiresAtMs - row.issuedAtMs <= 86400000;\n    ", "restrictionAllowsRecord": "\n      // An unexpired ACTIVE record can never allow access, even if malformed.\n      // Avoid validating its entire schema only to deny an already denied state.\n      let unexpiredActive = row is map && row.get('state', null) == 'ACTIVE'\n        && row.get('expiresAtMs', null) is int && row.expiresAtMs > request.time.toMillis();\n      return unexpiredActive ? false : restrictionRecordValid(row, rootId, subjectUid) && (\n        (row.state == 'ACTIVE' && row.expiresAtMs <= request.time.toMillis())\n        || (row.state == 'REVOKED' && restrictionMillis(row.revokedAtMs)\n          && row.revokedAtMs >= row.issuedAtMs && row.revokedAtMs <= request.time.toMillis()\n          && restrictionId(row.revokedBy) && row.revokedBy != subjectUid\n          && row.revocationReason in ['REVIEW_CLEARED','CREDENTIALS_RECOVERED','SUPPORT_RECOVERY'])\n      );\n    "};
const previousPredicates = ["accountAllowed() ? (hasModuleAction(\"wallet\", \"dispersiones\") && userFundedDispersionScope(resource.data) && (\n        isSuperadmin()\n        || ((\"adminId\" in resource.data) && resource.data.adminId == me())\n        || ((\"operadorId\" in resource.data) && resource.data.operadorId == me())\n        || ((\"createdBy\" in resource.data) && resource.data.createdBy == me())\n        || hasWalletClientReadAccessFromData(resource.data)\n      )) : false", "accountAllowed() ? (hasModuleAction(\"wallet\", \"dispersiones\")\n          && userFundedDispersionScope(get(/databases/$(database)/documents/clientDispersions/$(docId)).data) && (\n          isSuperadmin()\n          || get(/databases/$(database)/documents/clientDispersions/$(docId)).data.adminId == me()\n          || get(/databases/$(database)/documents/clientDispersions/$(docId)).data.operadorId == me()\n          || get(/databases/$(database)/documents/clientDispersions/$(docId)).data.createdBy == me()\n          || hasWalletClientReadAccessFromData(get(/databases/$(database)/documents/clientDispersions/$(docId)).data)\n        )) : false"];
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const source=fs.readFileSync(path.join(root,'firestore.rules'),'utf8');
function extract(name){
 const start=source.indexOf(`function ${name}(`);assert(start>=0,name);
 const open=source.indexOf('{',start);let end=open+1,depth=1;
 while(depth){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++;assert(end<=source.length);}
 return {params:source.slice(start+`function ${name}(`.length,source.indexOf(')',start)).split(',').map(x=>x.trim()).filter(Boolean),body:source.slice(open+1,end-1)};
}
function map(value){
 if(value===null||typeof value!=='object'||Array.isArray(value))return value;
 const result=Object.fromEntries(Object.entries(value).map(([key,item])=>[key,map(item)]));
 Object.defineProperty(result,'get',{value:(key,fallback)=>Object.hasOwn(result,key)?result[key]:map(fallback)});
 Object.defineProperty(result,'keys',{value:()=>({size:()=>Object.keys(result).length,hasAny:keys=>keys.some(key=>Object.hasOwn(result,key))})});
 return result;
}
function translate(body){
 return body.replace(/\/\/[^\n]*/g,'')
 .replace(/\/databases\/\$\(database\)\/documents\/clients\/\$\(clientId\)/g,'clientPathFor(clientId)')
 .replace(/(row\.get\([^)]*\)) is (map|int|number|bool|string)/g,'isType($1,"$2")')
 .replace(/([\w.]+) is (map|int|number|bool|string)/g,'isType($1,"$2")')
 .replace(/(actionKey|moduleKey|row.reasonCode|row.revocationReason|role) in (\[[^\]]*\]|modules)/g,'($2).includes($1)')
 .replace(/value.matches\(([^;]*)\)/g,'matches(value,$1)')
 .replace(/(?<![=!])==(?!=)/g,'===').replace(/(?<![=!])!=(?!=)/g,'!==');
}
const names=['restrictionRoot','restrictionId','restrictionMillis','restrictionRecordValid','restrictionAllowsRecord','restrictionAllowsUserForUid','restrictionAllowsUser','userLifecycleActive','accountAllowed','myRole','isSuperadmin','myRootId','roleDefaultAllowsForRole','individualAllowsViewAndActionForUser','hasModuleAction','hasWalletClientReadAccess','hasWalletClientReadAccessFromData','userFundedDispersionScope','dispersionActorModuleAllowed','dispersionUserFundingAllowed','dispersionDocumentOwnerAllowed','dispersionWalletClientAllowed','dispersionWalletAliasesAllowed','canReadClientDispersion','restrictionAllowsMap'];
const common=names.slice(0,names.indexOf('dispersionActorModuleAllowed'));
assert.equal(createHash('sha256').update(common.map(name=>(previousRestrictionBodies[name]||extract(name).body).replace(/\r\n/g,'\n')).join('\n')).digest('hex'),'2bdf00795fa19428d34a4b0738e2d17f42e33b4dfd46ceb4cd20292653792a20','Previously shared helper bodies must stay unchanged for this differential');
const compiled=Object.fromEntries(names.map(name=>{const f=source.includes(`function ${name}(`)?extract(name):{params:['row','rootId','subjectUid'],body:previousRestrictionBodies[name]};return[name,new Function('bindings',...f.params,`with(bindings){${translate(f.body)}}`)];}));
const previousRestrictionCompiled=Object.fromEntries(Object.entries(previousRestrictionBodies).map(([name,body])=>[name,new Function('bindings','row','rootId','subjectUid',`with(bindings){${translate(body)}}`)]));
const prior=previousPredicates.map(text=>text.replaceAll('resource.data','data').replaceAll('get(/databases/$(database)/documents/clientDispersions/$(docId)).data','data')).map(text=>new Function('bindings','data',`with(bindings){return ${translate(text)};}`));
const now=1800000000000,uid='actor';
const restriction=patch=>({schemaVersion:1,writer:'PAY0_TRUSTED_RESTRICTION_WRITER@1',policyVersion:'PAY0-CONTAINMENT@1',restrictionId:'restriction',rootId:'root',subjectUid:uid,scope:'ACCOUNT_OPERATIONS',authority:'HUMAN_SECURITY_ADMIN',authorityUid:'reviewer',incidentId:'incident',reasonCode:'SECURITY_REVIEW',authorizationVersion:1,issuedAtMs:now-2000,expiresAtMs:now-1000,state:'ACTIVE',...patch});
function evaluate(profile,data,notes,newPath,delegations){
 let actorReads=0;
 const clientDocs={good:{rootId:'root',active:true,adminId:'other'},bad:{rootId:'root',active:true},own:{rootId:'root',managedByUserId:uid},cross:{rootId:'other'}};
 for(const field of ['adminId','ownerId','managedByUserId','createdBy','operadorId'])clientDocs['owner-'+field]={rootId:'root',[field]:uid};
 const bindings={
 authenticated:()=>profile!==undefined,me:()=>{if(profile===undefined)throw Error('unauthenticated');return uid;},userExists:()=>profile!=null,
 userDoc:()=>{actorReads++;if(profile==null)throw Error('missing');return map(profile);},
 request:{time:{toMillis:()=>now}},matches:(v,p)=>new RegExp('^(?:'+p+')$').test(v),
 isType:(v,type)=>type==='map'?v!==null&&typeof v==='object'&&!Array.isArray(v):type==='int'?Number.isInteger(v):typeof v===({bool:'boolean'}[type]||type),
 clientPathFor:id=>id,exists:id=>Object.hasOwn(clientDocs,id),get:id=>({data:map(clientDocs[id]||{})}),
 // Same downstream authorization oracle on both paths: it also checks that
 // cache arguments belong to the requested actual client/root, never the caller.
 clientDelegationPermissionForClient:(id,client,rootId,permission,legacy)=>{assert.equal(permission,'viewBasic');assert.equal(legacy,'view');assert.deepEqual(JSON.parse(JSON.stringify(client)),clientDocs[id]);return delegations.includes(id)&&client.rootId===rootId;},
 };
 for(const name of names)bindings[name]=(...args)=>(!newPath&&previousRestrictionCompiled[name]?previousRestrictionCompiled[name]:compiled[name])(bindings,...args);
 let allowed=false;
 try{allowed=(newPath?bindings.canReadClientDispersion(map(data),notes):prior[notes?1:0](bindings,map(data)))===true;}catch{allowed=false;}
 return {allowed,actorReads};
}
const profiles=[undefined,null,{role:'operador',rootId:'root'},...['superadmin','admin','operator','unknown',' ADMIN ',null,''].map(role=>({role,rootId:'root'}))];
for(const patch of [{active:false},{isActive:false},{disabled:true},{deleted:true},{isDeleted:true},{deletedAt:0},{deletedAt:false},{modules:null},{modules:[]},{modules:{wallet:null}},{modules:{wallet:{view:false}}},{modules:{wallet:{dispersiones:false}}},{modules:{wallet:{view:'true'}}},...[null,'',false,0,' root '].map(rootId=>({rootId})),...[restriction({}),restriction({expiresAtMs:now+1000}),restriction({subjectUid:'other'}),restriction({state:'REVOKED',revokedAtMs:now-500,revokedBy:'reviewer',revocationReason:'REVIEW_CLEARED'}),null,{}].map(trustedRestrictionV1=>({trustedRestrictionV1}))])profiles.push({role:'operador',rootId:'root',...patch});
// Explicit roots whose operational and restriction fallback contracts diverge.
for(const rootId of ['',false,0])profiles.push({role:'operador',rootId,trustedRestrictionV1:restriction({rootId:uid})});
const data=[null,{},...['adminId','operadorId','createdBy'].map(key=>({[key]:uid})),...[{clientId:'good'},{clienteId:'good'},{clientId:'good',clienteId:'good'},{clientId:'good',clienteId:'bad'},{clientId:'bad',clienteId:'good'},{clientId:null,clienteId:'good'},{clientId:'own'},{clientId:'cross'},{clientId:'absent'},{clientId:3},{clientId:false},{clientId:{}},{clientId:[]}]];
for(const field of ['adminId','ownerId','managedByUserId','createdBy','operadorId'])data.push({clientId:'owner-'+field});
const funded={rootId:'root',clientId:'good',ownerUid:uid,fundingSource:{holderType:'USER',ownerUid:uid,sourceClientId:'good'}};
data.push(funded,{...funded,rootId:'other'},{...funded,ownerUid:'other'},{...funded,fundingSource:{...funded.fundingSource,ownerUid:'other'}},{...funded,fundingSource:{...funded.fundingSource,sourceClientId:'bad'}},{...funded,adminId:uid,rootId:'other'},{...funded,fundingSource:null},{...funded,fundingSource:[]},{...funded,fundingSource:{holderType:'CLIENT'}});
let cases=0,maxOldActorReads=0,maxNewActorReads=0;
for(const profile of profiles)for(const row of data)for(const notes of [false,true])for(const delegations of [[],['good'],['bad'],['good','bad']]){
 const old=evaluate(profile,row,notes,false,delegations),current=evaluate(profile,row,notes,true,delegations);
 assert.equal(current.allowed,old.allowed,JSON.stringify({profile,row,notes,delegations}));
 assert(current.actorReads<=1,'Dedicated read must load actor at most once');
 maxOldActorReads=Math.max(maxOldActorReads,old.actorReads);maxNewActorReads=Math.max(maxNewActorReads,current.actorReads);cases++;
}
for(const notes of [false,true]){
 assert(evaluate({role:'operador',rootId:'root'},{clientId:'good',clienteId:'good'},notes,true,['good']).allowed);
 assert(evaluate({role:'operador',rootId:'root'},{clientId:null,clienteId:'good'},notes,true,['good']).allowed);
 assert(evaluate({role:'operador',rootId:'root'},{clientId:'bad',clienteId:'good'},notes,true,['good']).allowed);
 for(const record of [restriction({}),restriction({state:'REVOKED',revokedAtMs:now-500,revokedBy:'reviewer',revocationReason:'REVIEW_CLEARED'})])assert(evaluate({role:'operador',rootId:'root',trustedRestrictionV1:record},{clientId:'good'},notes,true,['good']).allowed,'Valid expired/revoked restriction must preserve positive access');
 assert(!evaluate({role:'operador',rootId:'root',active:false},{clientId:'good'},notes,true,['good']).allowed);
 assert(!evaluate({role:'superadmin',rootId:'root',trustedRestrictionV1:restriction({expiresAtMs:now+1000})},{adminId:uid},notes,true,['good']).allowed);
}
console.log(JSON.stringify({mode:'DISPERSION_CONTEXT_DIFFERENTIAL',cases,maxOldActorReads,maxNewActorReads,emulator:false,externalEffects:false}));
