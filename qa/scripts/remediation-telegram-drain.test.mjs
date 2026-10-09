import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {queryFor,aggregateDrain,collectDrain,CUTOFF} from '../../scripts/telegram-drain-evidence.mjs';
const NOW=Date.parse('2026-10-09T21:40:00Z');
const readTime='2026-10-09T21:40:00Z';
const row=(id='synthetic-capability-do-not-print',extra={})=>({readTime,document:{name:'projects/pay-0-system/databases/(default)/documents/telegramActionTokens/'+id,fields:{createdAt:{timestampValue:CUTOFF},expiresAt:{timestampValue:'2026-10-09T21:35:00Z'},...extra}}});
test('query fixes project collection cutoff projection and limit+1; no secret fields',()=>{
 const q=queryFor(2).structuredQuery;assert.equal(q.limit,3);assert.equal(q.where.fieldFilter.value.timestampValue,CUTOFF);
 assert.deepEqual(q.select.fields.map(x=>x.fieldPath),['createdAt','expiresAt','transportVersion','storageGeneration']);assert.equal(q.from[0].allDescendants,false);
 assert.throws(()=>queryFor(5001));
});
test('aggregate versions generations maximum expiry without returning capabilities',()=>{
 const result=aggregateDrain([row(),row('b',{transportVersion:{integerValue:'1'},storageGeneration:{stringValue:'123'}}),row('c',{transportVersion:{integerValue:'2'},storageGeneration:{stringValue:'456'}})],{nowMs:NOW});
 assert.equal(result.window,'WINDOW_CLEAR_CONDITIONAL');assert.deepEqual(result.version,{absent:1,v1:1,v2:1,invalid:0});assert.equal(result.maxExpiresAtLegacyWithoutGeneration,'2026-10-09T21:35:00.000Z');
 assert.equal(result.oldRevisionInstances,'NOT_MEASURED');assert.equal(result.drainGate,'NOT_CERTIFIED');assert.equal(JSON.stringify(result).includes('synthetic-capability'),false);assert.equal(JSON.stringify(result).includes('telegramActionTokens/'),false);
});
test('empty window requires server readTime; absence never means instances zero',()=>{
 const r=aggregateDrain([{readTime}],{nowMs:NOW});assert.equal(r.documents,0);assert.equal(r.olderOrMissingCreatedAtNotCovered,true);assert.throws(()=>aggregateDrain([],{nowMs:NOW}));
 assert.throws(()=>aggregateDrain([{readTime:'2026-10-09T21:20:00Z'}],{nowMs:NOW}));
});
test('limit+1 is incomplete, never a clear gate',()=>{const r=aggregateDrain([row('a'),row('b')],{limit:1,nowMs:NOW});assert.equal(r.complete,false);assert.equal(r.window,'TRUNCATED');});
test('unexpired legacy blocks; nanosecond expiry rounds conservatively upwards',()=>{
 const r=aggregateDrain([row('a',{createdAt:{timestampValue:'2026-10-09T21:30:00Z'},expiresAt:{timestampValue:'2026-10-09T21:40:00.000000001Z'}})],{nowMs:NOW});
 assert.equal(r.window,'LEGACY_NOT_EXPIRED');assert.equal(r.unexpiredLegacyWithoutValidGeneration,1);assert.equal(r.maxExpiresAtLegacyWithoutGeneration,'2026-10-09T21:40:00.001Z');
});
test('malformed or inconsistent timestamps block without exposing source value',()=>{
 for(const fields of [{expiresAt:{stringValue:'private-synthetic'}},{createdAt:{timestampValue:'2026-02-30T21:20:00Z'}},{expiresAt:{timestampValue:'2026-10-09T22:00:00Z'}}]){
 const r=aggregateDrain([row('a',fields)],{nowMs:NOW});assert.equal(r.window,'INVALID_DATA');assert.equal(JSON.stringify(r).includes('private-synthetic'),false);
 }
});
test('invalid version/generation and duplicate/outside documents fail closed',()=>{
 assert.equal(aggregateDrain([row('a',{transportVersion:{stringValue:'1'}})],{nowMs:NOW}).window,'INVALID_DATA');
 assert.equal(aggregateDrain([row('a',{storageGeneration:{stringValue:''}})],{nowMs:NOW}).window,'INVALID_DATA');
 assert.throws(()=>aggregateDrain([row(),row()],{nowMs:NOW}));
 const wrong=row();wrong.document.name=wrong.document.name.replace('telegramActionTokens','users');assert.throws(()=>aggregateDrain([wrong],{nowMs:NOW}));
 const extra=row();extra.document.fields.token={stringValue:'synthetic'};assert.throws(()=>aggregateDrain([extra],{nowMs:NOW}));
});
test('REST adapter uses token only header fixed read query and discards error payload',async()=>{
 let calls=0;
 const result=await collectDrain({token:'synthetic-oauth-token-abcdefgh',now:()=>NOW,fetchImpl:async(url,opts)=>{
 calls++;assert.equal(url,'https://firestore.googleapis.com/v1/projects/pay-0-system/databases/(default)/documents:runQuery');assert.equal(opts.method,'POST');assert.equal(opts.redirect,'error');assert.equal(opts.headers.Authorization,'Bearer synthetic-oauth-token-abcdefgh');assert.equal(JSON.parse(opts.body).structuredQuery.limit,1001);
 return new Response(JSON.stringify([row()]),{status:200});}});
 assert.equal(calls,1);assert.equal(result.window,'WINDOW_CLEAR_CONDITIONAL');
 const denied=await collectDrain({token:'synthetic-oauth-token-abcdefgh',fetchImpl:async()=>new Response('sensitive-response',{status:403})});assert.equal(denied.httpStatus,403);assert.equal(JSON.stringify(denied).includes('sensitive'),false);
});
test('bounded response and malformed JSON never become empty clear query',async()=>{
 for(const body of ['[]','{bad','x'.repeat(8*1024*1024+1)]){const result=await collectDrain({token:'synthetic-oauth-token-abcdefgh',now:()=>NOW,fetchImpl:async()=>new Response(body,{status:200})});assert.equal(result.window,'READ_OR_SCHEMA_ERROR');}
});
test('default CLI offline and invalid arguments do not reveal env OAuth token',()=>{
 const env={...process.env,PAY0_DRAIN_OAUTH_TOKEN:'synthetic-oauth-secret-marker'};
 const dry=spawnSync(process.execPath,['scripts/telegram-drain-evidence.mjs'],{encoding:'utf8',env});assert.equal(dry.status,0);assert.equal(JSON.parse(dry.stdout).mode,'DRY_RUN_NO_REMOTE_CALLS');assert.equal(dry.stdout.includes('secret-marker'),false);
 const bad=spawnSync(process.execPath,['scripts/telegram-drain-evidence.mjs','--token','synthetic-oauth-secret-marker'],{encoding:'utf8',env});assert.equal(bad.status,2);assert.equal((bad.stdout+bad.stderr).includes('secret-marker'),false);
});
