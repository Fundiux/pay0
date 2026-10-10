import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {renderRulesPolicyBlock,extractRulesPolicyBlock,identifyRulesPolicyFormat,replaceRulesPolicyBlock} from '../../scripts/lib/authorization-policy-generator.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const policy=JSON.parse(fs.readFileSync(path.join(root,'config/authorization-policy.json'),'utf8'));
const source=fs.readFileSync(path.join(root,'firestore.rules'),'utf8').replace(/\r\n/g,'\n');
const block=renderRulesPolicyBlock(policy),old=renderRulesPolicyBlock(policy,{format:'cached-selector-actor-only'});
function body(text,name){const begin=text.indexOf(`function ${name}(`);assert(begin>=0);const start=text.indexOf('{',begin);let end=start+1,depth=1;while(depth){if(text[end]==='{')depth++;if(text[end]==='}')depth--;end++;assert(end<=text.length);}return text.slice(start+1,end-1);}
assert.equal(body(block,'roleDefaultAllows'),body(old,'roleDefaultAllows'),'Existing actor selector must remain byte-identical');
assert.equal(extractRulesPolicyBlock(source),block);
assert.equal(identifyRulesPolicyFormat(old,policy),'cached-selector');
assert.equal(identifyRulesPolicyFormat(block,policy),'cached-selector');
assert.equal(replaceRulesPolicyBlock(source,policy),source);
const translate=b=>b.replace(/moduleKey in modules/g,'modules.includes(moduleKey)').replace(/(?<![=!])==(?!=)/g,'===');
const selector=new Function('role','moduleKey','actionKey',translate(body(block,'roleDefaultAllowsForRole')));
const actor=new Function('myRole','moduleKey','actionKey',translate(body(block,'roleDefaultAllows')));
const modules=[...new Set(Object.values(policy.roleDefaults).flatMap(Object.keys)),'unknown'];
const actions=[...new Set(Object.values(policy.roleDefaults).flatMap(m=>Object.values(m).flatMap(Object.keys))),'unknown'];
let checks=0;
for(const role of ['superadmin','admin','operador','operator','ADMIN','',null])for(const module of modules)for(const action of actions){
 const expected=role==='superadmin'||policy.roleDefaults[role]?.[module]?.[action]===true;
 assert.equal(selector(role,module,action),expected);
 assert.equal(actor(()=>role,module,action),expected);checks+=2;
}
const reorder=value=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reorder(v)])):value;
assert.equal(renderRulesPolicyBlock(reorder(policy)),block);
assert.throws(()=>identifyRulesPolicyFormat(block.replace('role == "superadmin" || moduleKey in modules','true || moduleKey in modules'),policy));
assert.match(source,/restrictionAllowsRecord\(user.trustedRestrictionV1, rootId, subjectUid\)/);
assert.match(source,/restrictionAllowsUserForUid\(user, me\(\), restrictionRoot\(user, me\(\)\)\)/);
assert.match(source,/row.subjectUid == subjectUid/);assert.match(body(source,'restrictionAllowsMap'),/let revokedBy = row.get\('revokedBy', null\)/);assert.match(body(source,'restrictionAllowsMap'),/revokedBy != subjectUid/);
// Fast-path string preserves the actual prior helper and backend string
// normalization, including UTF-16 edge cases, without fabricating map IDs.
const idTranslate=b=>translate(b).replace(/(?<![=!])!=(?!=)/g,'!==').replace(/value is string/g,'typeof value === "string"').replace(/value is number/g,'typeof value === "number"').replace(/value is bool/g,'typeof value === "boolean"');
const falsy=new Function('value',idTranslate(body(source,'delegationFalsy')));
const clean=new Function('delegationFalsy','string','value',idTranslate(body(source,'delegationCleanId'))).bind(null,falsy,String);
const previous=value=>falsy(value)?'':typeof value==='string'?value.trim():typeof value==='number'||typeof value==='boolean'?String(value):'';
let identityCases=0;
for(const value of [undefined,null,'',' ','  grantor  ','0','false','\\path','user/path','\ud800','\udc00','\ud83d\ude00',0,1,-1,1.5,false,true,{},[],['grantor']]){
 assert.equal(clean(value),previous(value),'Clean ID fast-path must preserve previous behavior');
 if(typeof value==='string')assert.equal(clean(value),String(value||'').trim(),'Backend string identity normalization');
 identityCases++;
}
assert.equal(identityCases,21);
// The fixed module pair is generated from JSON, independently of authority role.
// Exercise all six policy bits (including superadmin, whose selector bypass is
// intentionally independent of those bits), then exact raw-module override shapes.
const typed=b=>b.replace(/\{\}/g,'({get:(key,fallback)=>fallback})').replace(/(stored|raw) is map/g,'isMap($1)').replace(/role in (\[[^\]]*\])/g,'$1.includes(role)');
const isMap=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const wrap=value=>isMap(value)?{get:(key,fallback)=>wrap(Object.hasOwn(value,key)?value[key]:fallback)}:value;
const currentModule=new Function('roleAllowsClientDelegation','isMap','user','role',typed(translate(body(source,'delegationProfileModuleAllows'))));
const priorModule=new Function('roleDefaultAllowsForRole','isMap','user','role',typed(translate(body(source,'delegationProfileModuleAllows').replace('roleAllowsClientDelegation(role)',"roleDefaultAllowsForRole(role, 'usuarios', 'view') && roleDefaultAllowsForRole(role, 'usuarios', 'clientDelegations')"))));
const overrideProfiles=[{},...([null,false,0,'true',[],{}, {usuarios:null},{usuarios:[]},{usuarios:false},{usuarios:{view:false}},{usuarios:{clientDelegations:false}},{usuarios:{view:'true'}},{usuarios:{clientDelegations:1}},{usuarios:{view:true,clientDelegations:true}}].map(modules=>({modules})))];
let grantorPairChecks=0;
for(let bits=0;bits<64;bits++){
 const variant=structuredClone(policy);
 for(const [index,role]of ['superadmin','admin','operador'].entries())variant.roleDefaults[role].usuarios={view:!!(bits&(1<<(index*2))),clientDelegations:!!(bits&(1<<(index*2+1)))};
 const rendered=renderRulesPolicyBlock(variant);
 const general=new Function('role','moduleKey','actionKey',translate(body(rendered,'roleDefaultAllowsForRole')));
 const specialized=new Function('role',typed(translate(body(rendered,'roleAllowsClientDelegation'))));
 for(const role of ['superadmin','admin','operador','operator',' ADMIN ','unknown','',null,false,1]){
  assert.equal(specialized(role),general(role,'usuarios','view')&&general(role,'usuarios','clientDelegations'));
  for(const profile of overrideProfiles){assert.equal(currentModule(specialized,isMap,wrap(profile),role),priorModule(general,isMap,wrap(profile),role));grantorPairChecks++;}
 }
 assert.equal(renderRulesPolicyBlock(reorder(variant)),rendered);
}
// Authority-role and terminal-source gates remain independent of the JSON pair.
assert.match(body(source,'delegationGrantorProfileAllowed'),/role in \['superadmin', 'admin'\]/);
assert.match(body(source,'delegationGrantorProfileAllowed'),/source == 'SUPERADMIN' \? role == 'superadmin'/);
assert.equal((source.match(/roleAllowsClientDelegation\(role\)/g)||[]).length,2,'Exactly generated declaration and grantor-only callsite');
console.log(JSON.stringify({mode:'GRANTOR_CANONICAL_SELECTOR',checks,identityCases,grantorPairChecks,actorBodyUnchanged:true,deterministic:true,externalEffects:false}));

// Reuse the real pre-existing 169+325+24 suites without changing assertions.
// Only the reviewed candidate pin, import location and deny diagnostics change
// in ignored temporary copies. The canonical block is verified above.
if(process.argv.includes('--regressions')){
 assert.equal(process.env.GCLOUD_PROJECT,'demo-pay0-restriction-boundaries');
 for(const name of ['FIRESTORE_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST'])assert.match(process.env[name]||'',/^127\.0\.0\.1:\d+$/);
 const expected='6e5c79768f424de6619be34576fa4c99868d3698c3ac71f79c712f4a6ff1fe8e';
 assert.equal(createHash('sha256').update(source).digest('hex'),expected,'Review and pin any candidate change');
 const baseline='03cca1237bd47a9e5670c4c1411e114383788a56c7763d6e0779cd7602601dc3';
 const parent=path.join(root,'.firebase/remediation-temp');fs.mkdirSync(parent,{recursive:true});
 const temp=fs.mkdtempSync(path.join(parent,'grantor-regressions-'));let exhausted=0;
 for(const [filename,project]of [['remediation-firestore-release-queries.test.mjs','demo-pay0-firestore-release'],['remediation-restriction-boundaries.test.mjs','demo-pay0-restriction-boundaries'],['remediation-firestore-budget-aliases.test.mjs','demo-pay0-restriction-boundaries']]){
  let code=fs.readFileSync(path.join(root,'qa/scripts',filename),'utf8');
  if(filename.includes('release-queries')){assert.equal(code.split(baseline).length,2);code=code.replace(baseline,expected);}
  else code=code.replace("'../../scripts/lib/authorization-policy-generator.mjs'",JSON.stringify(pathToFileURL(path.join(root,'scripts/lib/authorization-policy-generator.mjs')).href));
  assert.equal(code.split('assertFails(p)').length,2,'Exactly one original deny assertion required');
  code=code.replace('assertFails(p)',`assertFails(p.catch(error=>{if(/maximum of 1000 expressions|maximum.*expression.*reached|too many.*(?:get|exists).*calls/i.test(String(error.message||'')))console.error('GRANTOR_REGRESSION_BUDGET_EXHAUSTED '+JSON.stringify({case:typeof currentCase==='undefined'?'query-or-alias':currentCase,check:typeof checks==='undefined'?null:checks,code:error.code}));throw error;}))`);
  const script=path.join(temp,filename);fs.writeFileSync(script,code);
  const out=spawnSync(process.execPath,[script],{cwd:root,encoding:'utf8',timeout:240000,maxBuffer:8*1024*1024,env:{...process.env,GCLOUD_PROJECT:project,PAY0_RULES_SOURCE_ROOT:root,PAY0_RESTRICTION_RULES_MODE:'actual'}});
  const output=(out.stdout||'')+(out.stderr||'');
  exhausted+=(output.match(/GRANTOR_REGRESSION_BUDGET_EXHAUSTED|maximum of 1000 expressions|maximum.*expression.*reached|too many.*(?:get|exists).*calls/gi)||[]).length;
  process.stdout.write(out.stdout||'');process.stderr.write(out.stderr||'');
  assert.equal(out.error,undefined,'Regression child must finish');assert.equal(out.status,0,'All unchanged assertions must pass');
 }
 assert.equal(exhausted,0,'Budget exhaustion is never an acceptable denial');
 console.log(JSON.stringify({mode:'GRANTOR_REGRESSIONS',checks:518,expressionExhaustionDiagnostics:exhausted,rulesHash:expected,externalEffects:false}));
}
