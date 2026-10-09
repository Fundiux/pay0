const test=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./fixtures/dispersion-documents-harness.cjs');
global.fetch=async()=>{throw Error('NETWORK_FORBIDDEN');};
const user=s=>s.rows.get('users/u'),parent=s=>s.rows.get('clientDispersions/d');
const direct=s=>{user(s).role='admin';};
const delegated=s=>{user(s).role='operador';s.rows.get('clients/c').adminId='other';s.rows.set('userClientAccess/u/clients/c',{active:true,rootId:'r',clientId:'c',targetUid:'u',permissions:{operateDispersiones:true},expiresAt:Date.now()+60000});};
const funded=s=>{user(s).role='operador';Object.assign(parent(s),{ownerUid:'u',fundingSource:{holderType:'USER',ownerUid:'u',sourceClientId:'c'}});s.rows.delete('clients/c');};
const ready=s=>Object.assign(s.rows.get('uploads/x'),{status:'READY',active:true,version:1,storageGeneration:'123'});
const activeRestriction=()=>({schemaVersion:1,writer:'PAY0_TRUSTED_RESTRICTION_WRITER@1',policyVersion:'PAY0-CONTAINMENT@1',restrictionId:'q',rootId:'r',subjectUid:'u',state:'ACTIVE',scope:'ACCOUNT_OPERATIONS',authority:'HUMAN_SECURITY_ADMIN',authorityUid:'security',reasonCode:'SECURITY_REVIEW',incidentId:'i',issuedAtMs:Date.now()-1000,expiresAtMs:Date.now()+60000,authorizationVersion:1});
for(const action of ['init','call','deactivate']){
 for(const [name,prepare]of [['root superadmin',()=>{}],['direct admin',direct],['delegated operator',delegated],['USER owner',funded]])test(`${action}: permits ${name} with real guards`,async()=>{const s=setup();if(action==='deactivate')ready(s);prepare(s);await s[action]();assert.ok(s.writes>0);});
 for(const [name,prepare]of [
  ['active restriction',s=>user(s).trustedRestrictionV1=activeRestriction()],
  ['malformed restriction',s=>user(s).trustedRestrictionV1={}],
  ['disabled user',s=>user(s).disabled=true],
  ['unknown role',s=>user(s).role='guest'],
  ['module revoked',s=>{direct(s);user(s).modules={wallet:{dispersiones:false}};}],
  ['foreign parent',s=>parent(s).rootId='other'],
  ['missing parent root',s=>delete parent(s).rootId],
  ['deleted parent',s=>parent(s).deletedAt=123],
  ['createdBy is not client authority',s=>{direct(s);s.rows.get('clients/c').adminId='other';parent(s).createdBy='u';parent(s).adminId='u';}],
  ['expired delegation',s=>{delegated(s);s.rows.get('userClientAccess/u/clients/c').expiresAt=Date.now()-1;}],
  ['delegation permission false',s=>{delegated(s);s.rows.get('userClientAccess/u/clients/c').permissions.operateDispersiones=false;}],
  ['USER other owner despite client grant',s=>{delegated(s);Object.assign(parent(s),{ownerUid:'other',fundingSource:{holderType:'USER',ownerUid:'other',sourceClientId:'c'}});}],
  ['USER source-client mismatch',s=>{funded(s);parent(s).fundingSource.sourceClientId='other';}],
  ['USER top-level owner mismatch',s=>{funded(s);parent(s).ownerUid='other';}],
 ])test(`${action}: denies ${name}, zero writes`,async()=>{const s=setup();if(action==='deactivate')ready(s);prepare(s);await assert.rejects(s[action](),e=>['permission-denied','failed-precondition'].includes(e.code));assert.equal(s.writes,0);assert.equal(s.audits,0);});
 for(const [name,prepare,mutate]of [
  ['user revoked',()=>{},s=>user(s).active=false],
  ['restriction added',()=>{},s=>user(s).trustedRestrictionV1=activeRestriction()],
  ['root moved',()=>{},s=>user(s).rootId='other'],
  ['parent moved',()=>{},s=>parent(s).rootId='other'],
  ['parent deleted',()=>{},s=>s.rows.delete('clientDispersions/d')],
  ['delegation revoked',delegated,s=>s.rows.get('userClientAccess/u/clients/c').revokedAt=Date.now()],
  ['USER ownership moved',funded,s=>{parent(s).ownerUid='other';parent(s).fundingSource.ownerUid='other';}],
 ])test(`${action}: rechecks ${name} at transaction`,async()=>{const s=setup();if(action==='deactivate')ready(s);prepare(s);s.txRace(()=>mutate(s));await assert.rejects(s[action](),e=>['permission-denied','failed-precondition'].includes(e.code));assert.equal(s.writes,0);assert.equal(s.audits,0);});
}
for(const [field,value]of [['name','foreign'],['bucket','foreign'],['size','1048577'],['generation',''],['metageneration',''],['contentType','text/html']])test(`finalize rejects GCS ${field} mismatch`,async()=>{const s=setup();s.object[field]=value;await assert.rejects(s.call(),e=>e.code==='failed-precondition');assert.equal(s.writes,0);});
for(const [field,value]of [['sizeBytes',21],['contentType','text/plain'],['entityId','other']])test(`finalize rejects changed ${field} during metadata lookup`,async()=>{const s=setup();s.race(()=>s.rows.get('uploads/x')[field]=value);await assert.rejects(s.call(),e=>e.code==='failed-precondition');assert.equal(s.writes,0);});
test('finalize binds generation, rejects subsequent object replacement without rewriting evidence',async()=>{const s=setup();await s.call();assert.equal(s.rows.get('uploads/x').storageGeneration,'123');s.object.generation='124';await assert.rejects(s.call(),e=>e.code==='failed-precondition');assert.equal(s.audits,1);assert.equal(s.rows.get('uploads/x').storageGeneration,'123');});
test('READY replay still rechecks current actor',async()=>{const s=setup();ready(s);s.txRace(()=>user(s).trustedRestrictionV1=activeRestriction());await assert.rejects(s.call(),e=>e.code==='permission-denied');assert.equal(s.writes,0);});
test('deactivation replay is idempotent, audit once',async()=>{const s=setup();ready(s);await s.deactivate();await s.deactivate();assert.equal(s.audits,1);assert.equal(s.writes,1);});
test('deactivation cannot rewrite a replaced upload',async()=>{const s=setup();Object.assign(s.rows.get('uploads/x'),{status:'REPLACED',active:false});await assert.rejects(s.deactivate(),e=>e.code==='failed-precondition');assert.equal(s.writes,0);});
test('deactivation catches concurrent storage identity replacement',async()=>{const s=setup();ready(s);s.txRace(()=>s.rows.get('uploads/x').storageGeneration='456');await assert.rejects(s.deactivate(),e=>e.code==='failed-precondition');assert.equal(s.writes,0);});
test('init derives object identity from current parent and creates PENDING once',async()=>{const s=setup();const r=await s.init();const row=s.rows.get('uploads/'+r.uploadId);assert.equal(row.status,'PENDING');assert.equal(row.active,false);assert.equal(row.rootId,'r');assert.equal(row.createdBy,'u');assert.equal(row.storagePath,`roots/r/dispersiones/d/docs/COMPROBANTE_DISPERSION/${r.uploadId}-file.pdf`);assert.equal(s.metadataReads,0);});
