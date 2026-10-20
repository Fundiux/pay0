import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildInventory, parseRules, ruleKey, parseCsv, csv, ROOT } from '../../scripts/build-remediation-inventory.mjs';

test('structured rules preserve nesting, methods and stable identity across lines and placeholder renames', () => {
 const text = `rules_version = '2'; service cloud.firestore { match /databases/{database}/documents {
 // match /fake/{id} { allow read: if true; }
 function text() { return "match /not-a-rule/{id} { allow read: if true; }"; }
 match /users/{uid} { match /costos/{id} { allow read: if signedIn(); allow write: if false; } }
 match /clients/{uid} { match /costos/{id} { allow read: if true; } }
 match /pagos/{pagoId} { allow read: if owner(); allow read: if delegate(); }
 match /{rest=**} { allow read, write: if false; }
 } }`;
 const rules=parseRules(text,'firestore','fixture.rules');
 assert.equal(rules.matches.length,7);
 assert.ok(rules.clauses.some(r=>r.path==='/databases/{database}/documents/users/{uid}/costos/{id}'&&r.method==='get'));
 assert.equal(rules.clauses.filter(r=>r.path.endsWith('/pagos/{pagoId}')&&r.method==='get').length,2);
 const shifted=parseRules('\n// extra line\n'+text.replaceAll('{uid}','{actor}'),'firestore','fixture.rules');
 assert.deepEqual(rules.clauses.map(r=>ruleKey(r.service,r.path,r.method)),shifted.clauses.map(r=>ruleKey(r.service,r.path,r.method)));
 assert.notEqual(ruleKey('firestore','/{x}','get'),ruleKey('firestore','/{x=**}','get'));
});

test('CSV parser round-trips quoted commas, newlines and quotes',()=>{
 const rows=[{id:'a',value:'line 1, "quoted"\nline2'}];assert.deepEqual(parseCsv(csv(rows,['id','value'])),rows);
});

test('AST inventory resolves factories, imports and actual retry/schedule options; historical mapping is complete',()=>{
 const inventory=buildInventory(ROOT),{surface,automations,historical,oldAutomation}=inventory;
 const factories=automations.filter(r=>r.name.startsWith('queueControlCenter'));
 assert.equal(factories.length,20);
 for(const r of factories){assert.equal(r.type,'onDocumentWritten');assert.equal(r.retry_literal,true);assert.equal(r.schedule_literal,'NO_APLICA');assert.match(r.document_pattern,/\/\{documentId\}$/);assert.match(r.constructor_anchor,/controlCenter\/automation.ts:/);assert.ok(r.factory_chain.split(';').length>=2);assert.equal(r.historical_automation,false);}
 const byName=new Map(automations.map(r=>[r.name,r]));
 for(const n of ['enqueueAutomaticPaymentComplement','executeAutomaticPaymentComplement']){assert.equal(byName.get(n).schedule_literal,'NO_APLICA');assert.equal(byName.get(n).retry_literal,true);}
 assert.equal(byName.get('checkPaymentComplementsDaily').schedule_literal,'0 19 * * 1-5');assert.equal(byName.get('checkPaymentComplementsDaily').retry_count,0);
 const task=byName.get('processIqPagoDepositAutomaticTask');assert.equal(task.schedule_literal,'NO_APLICA');assert.equal(task.retry_config.maxAttempts,3);assert.equal(task.rate_limits.maxConcurrentDispatches,1);
 const callable=surface.find(r=>r.entry==='preparePagoFinancialPosting');assert.equal(callable.entry_type,'onCall');assert.match(callable.implementation,/index.ts:/);assert.notEqual(callable.implementation,callable.legacy_anchor);
 for(const p of ['/users/{uid}/costos/{costId}','/despachos/{docId}/costos/{costId}','/clients/{docId}/costos/{costId}','/solicitudes/{docId}/notas/{notaId}','/pagos/{pagoId}/notas/{notaId}','/clientDispersions/{docId}/notas/{notaId}'])assert.ok(surface.some(r=>r.entry==='/databases/{database}/documents'+p&&r.method==='get'));
 const mapped=new Set(surface.flatMap(r=>(r.legacy_ids||'').split(';')));assert.equal(historical.length,406);assert.equal(oldAutomation.length,36);assert.ok(historical.every(r=>mapped.has(r.id)));assert.ok(!surface.some(r=>r.entry_type==='HISTORICAL_UNMAPPED'));assert.ok(!surface.some(r=>r.entry_type==='UNRESOLVED_EXPORT'));
 assert.equal(surface.find(r=>r.entry==='/login').boundary,'PUBLIC_UI');assert.equal(surface.find(r=>r.entry==='/setup-superadmin').boundary,'SESSION_UI');assert.equal(surface.find(r=>r.entry==='/firma/[token]').boundary,'PUBLIC_TOKEN_UI');
 assert.equal(new Set(surface.map(r=>r.id)).size,surface.length);assert.ok(surface.every(r=>r.authorization_certification==='NOT_CERTIFIED'));assert.ok(automations.every(r=>surface.some(s=>s.id===r.id)));
 const history=fs.readFileSync(`${ROOT}/docs/audits/pay0-security-sentinel-2026-10-07/ATTACK-SURFACE.csv`,'utf8');assert.equal(parseCsv(history).length,406);
});
