import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { firebaseParser, planTransition, transitionLocal, sha256 } from '../../scripts/telegram-transition-env.mjs';
const parse = firebaseParser(); // Real installed Firebase parser, synthetic input only.
const nowMs = Date.parse('2026-10-09T12:00:00.000Z');
const modeKey = 'TELEGRAM_DOWNLOAD_TRANSPORT_MODE', startKey = 'TELEGRAM_DOWNLOAD_LEGACY_STARTED_AT', endKey = 'TELEGRAM_DOWNLOAD_LEGACY_DEADLINE';
const plan = (bytes, mode='bridge', state=null, now=nowMs) => planTransition(Buffer.from(bytes), {mode,state,nowMs:now}, parse);
function fixture(t, bytes) {
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'pay0-env-synthetic-'));
  fs.mkdirSync(path.join(workspace,'functions'));
  const target=path.join(workspace,'functions/.env.pay-0-system');fs.writeFileSync(target,bytes);
  t.after(()=>fs.rmSync(workspace,{recursive:true,force:true}));
  return {workspace,target,dir:path.join(workspace,'.firebase/telegram-transition'),run: options=>transitionLocal({workspace,parse,nowMs,ignored:()=>true,...options})};
}
test('CRLF BOM unrelated lines quoted comments and escapes retain original bytes and Firebase values',()=>{
 const original=Buffer.from('\uFEFF# fixture only\r\nALPHA="synthetic\\nline" # retain\r\nBETA=plain # exact\r\n');
 const p=plan(original);assert.ok(p.bytes.subarray(0,original.length).equals(original));
 assert.equal(parse(p.bytes.toString())[modeKey],'LEGACY_BRIDGE');assert.equal(p.state.deadline,'2026-10-09T13:00:00.000Z');
 const final=plan(p.bytes,'final',p.state);assert.ok(final.bytes.subarray(0,original.length).equals(original));
 assert.equal(parse(final.bytes.toString()).ALPHA,'synthetic\nline');assert.equal(parse(final.bytes.toString())[modeKey],'POST_FRAGMENT');
 assert.equal(Object.hasOwn(parse(final.bytes.toString()),startKey),false);assert.equal(Object.hasOwn(parse(final.bytes.toString()),endKey),false);
});
test('existing own lines change in place; mixed newline foreign bytes and order preserved',()=>{
 const input=`FIRST=one\r\n${modeKey}=POST_FRAGMENT\n# keep\r\nLAST='two'\n`;
 const p=plan(input);assert.ok(p.bytes.toString().startsWith(`FIRST=one\r\n${modeKey}=LEGACY_BRIDGE\n# keep\r\nLAST='two'\n`));
});
test('missing EOF newline gets only necessary append separator; empty and BOM-only files supported',()=>{
 for(const input of ['A=synthetic','# synthetic comment without newline','','\uFEFF']){const p=plan(input);assert.ok(p.bytes.subarray(0,Buffer.byteLength(input)).equals(Buffer.from(input)));assert.equal(parse(p.bytes.toString())[modeKey],'LEGACY_BRIDGE');}
});
test('duplicate keys, ambiguous quoting, multiline, invalid UTF8 and bare CR fail closed',()=>{
 for(const input of ['A=one\nA=two\n','export A=one\nA=two\n',`${modeKey}=POST_FRAGMENT\n${modeKey}=POST_FRAGMENT\n`,'A="unfinished\n','A="multi\nline"\n','A="x" junk\n','A: x\n','A=one\rB=two\r',Buffer.from([0xff,0xfe])]) assert.throws(()=>plan(input));
});
test('bridge rerun never renews; expired, future, mismatched and closed windows rejected',()=>{
 const first=plan('A=synthetic\n');
 const repeat=plan(first.bytes,'bridge',first.state,nowMs+1000);assert.ok(repeat.bytes.equals(first.bytes));assert.deepEqual(repeat.state,first.state);
 assert.throws(()=>plan(first.bytes,'bridge',first.state,nowMs+3600000));
 assert.throws(()=>plan(first.bytes,'bridge',first.state,nowMs-1));
 assert.throws(()=>plan(first.bytes,'bridge',{...first.state,deadline:'2026-10-09T12:59:00.000Z'}));
 assert.throws(()=>plan('A=synthetic\n','bridge',{...first.state,phase:'FINAL_APPLIED'}));
 assert.equal(plan(first.bytes,'final',first.state,nowMs+7200000).bytes.toString().includes(startKey),false);
});
test('existing bridge timestamp adoption preserves valid shorter deadline and refuses partial configuration',()=>{
 const bytes=`${modeKey}=LEGACY_BRIDGE\n${startKey}=2026-10-09T11:50:00.000Z\n${endKey}=2026-10-09T12:10:00.000Z\n`;
 assert.equal(plan(bytes).state.deadline,'2026-10-09T12:10:00.000Z');
 for(const input of [`${modeKey}=LEGACY_BRIDGE\n`,`${startKey}=2026-10-09T12:00:00.000Z\n`,bytes.replace('12:10','13:10')])assert.throws(()=>plan(input));
});
test('dry run never creates backups state or alters fixture',t=>{
 const f=fixture(t,'A=synthetic\n');const before=fs.readFileSync(f.target);const r=f.run({mode:'bridge'});
 assert.equal(r.mode,'DRY_RUN');assert.ok(fs.readFileSync(f.target).equals(before));assert.equal(fs.existsSync(f.dir),false);
});
test('atomic backup manifests fixed window rerun and final operate only on synthetic fixture',t=>{
 const original=Buffer.from('\uFEFFA=synthetic-only\r\n');const f=fixture(t,original);
 const first=f.run({mode:'bridge',execute:true});assert.equal(first.mode,'APPLIED_LOCAL');
 const state=JSON.parse(fs.readFileSync(path.join(f.dir,'state.json')));assert.equal(state.startedAt,'2026-10-09T12:00:00.000Z');
 const files=fs.readdirSync(f.dir);const backup=files.find(x=>x.endsWith('.env.backup'));assert.ok(fs.readFileSync(path.join(f.dir,backup)).equals(original));
 const manifest=JSON.parse(fs.readFileSync(path.join(f.dir,files.find(x=>x.endsWith('.manifest.json')))));
 assert.equal(manifest.beforeHash,sha256(original));assert.equal(manifest.phase,'APPLIED');assert.equal(JSON.stringify(manifest).includes('synthetic-only'),false);
 assert.equal(f.run({mode:'bridge',execute:true,nowMs:nowMs+1000}).mode,'NO_CHANGE');
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'state.json'))).deadline,state.deadline);
 assert.throws(()=>f.run({mode:'bridge',execute:true,nowMs:nowMs+3600000}));
 assert.equal(f.run({mode:'final',execute:true,nowMs:nowMs+3600000}).mode,'APPLIED_LOCAL');
 assert.equal(parse(fs.readFileSync(f.target,'utf8'))[modeKey],'POST_FRAGMENT');
 assert.throws(()=>f.run({mode:'bridge',execute:true,nowMs:nowMs+3600001}));assert.equal(fs.existsSync(path.join(f.dir,'transition.lock')),false);
});
test('already applied bridge with no state persists original window instead of leaving renewal gap',t=>{
 const p=plan('A=synthetic\n');const f=fixture(t,p.bytes);assert.equal(f.run({mode:'bridge',execute:true}).mode,'NO_CHANGE');
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'state.json'))).startedAt,p.state.startedAt);
});
test('missing ignore protection and concurrent lock deny before target mutation',t=>{
 const f=fixture(t,'A=synthetic\n');assert.throws(()=>f.run({mode:'bridge',execute:true,ignored:()=>false}));
 fs.mkdirSync(f.dir,{recursive:true});fs.writeFileSync(path.join(f.dir,'transition.lock'),'synthetic');
 assert.throws(()=>f.run({mode:'bridge',execute:true}));assert.equal(fs.readFileSync(f.target,'utf8'),'A=synthetic\n');
});
test('PREPARED window survives crash recovery and cannot restart deadline from original bytes',t=>{
 const f=fixture(t,'A=synthetic\n');const state=plan('A=synthetic\n').state;
 fs.mkdirSync(f.dir,{recursive:true});fs.writeFileSync(path.join(f.dir,'state.json'),JSON.stringify(state));
 f.run({mode:'bridge',execute:true,nowMs:nowMs+10000});assert.equal(parse(fs.readFileSync(f.target,'utf8'))[endKey],state.deadline);
});
test('final already configured records closed state without changing env bytes',t=>{
 const bytes=`A=synthetic\n${modeKey}=POST_FRAGMENT\n`;const f=fixture(t,bytes);
 assert.equal(f.run({mode:'final',execute:true}).mode,'NO_CHANGE');assert.equal(fs.readFileSync(f.target,'utf8'),bytes);
 assert.throws(()=>f.run({mode:'bridge',execute:true}));
});
for (const stage of ['AFTER_TARGET_REPLACE','TARGET_VERIFY','STATE_APPLY','MANIFEST_APPLY','AFTER_MANIFEST_APPLY']) {
 test(`failure at ${stage} leaves changed target diagnosable and recovery never renews`,t=>{
  const f=fixture(t,'A=synthetic-secret-marker\n');
  let caught;
  try { f.run({mode:'bridge',execute:true,checkpoint:current=>{if(current===stage)throw Error('sensitive-provider-detail-synthetic-secret-marker');}}); }
  catch(error){caught=error;}
  assert.equal(caught?.stage,stage);assert.equal(caught.message,'TELEGRAM_ENV_REJECTED');assert.equal(String(caught).includes('synthetic-secret-marker'),false);
  const applied=fs.readFileSync(f.target);const state=JSON.parse(fs.readFileSync(path.join(f.dir,'state.json')));
  assert.equal(parse(applied.toString())[modeKey],'LEGACY_BRIDGE');assert.equal(state.startedAt,'2026-10-09T12:00:00.000Z');
  const manifestName=fs.readdirSync(f.dir).find(x=>x.endsWith('.manifest.json'));
  const retry=f.run({mode:'bridge',execute:true,nowMs:nowMs+5000});
  assert.equal(retry.mode,'NO_CHANGE');assert.equal(retry.recovered,stage!=='AFTER_MANIFEST_APPLY');assert.ok(fs.readFileSync(f.target).equals(applied));
  const finalState=JSON.parse(fs.readFileSync(path.join(f.dir,'state.json')));assert.equal(finalState.deadline,state.deadline);assert.equal(finalState.phase,'BRIDGE_APPLIED');
  const journal=JSON.parse(fs.readFileSync(path.join(f.dir,manifestName)));assert.equal(journal.phase,stage==='AFTER_MANIFEST_APPLY'?'APPLIED':'RECOVERED_APPLIED');
  assert.equal(fs.existsSync(path.join(f.dir,'transition.lock')),false);
 });
}
test('failure before replacement preserves original; durable prepared window survives retry',t=>{
 const f=fixture(t,'A=synthetic\n');
 assert.throws(()=>f.run({mode:'bridge',execute:true,checkpoint:stage=>{if(stage==='TARGET_REPLACE')throw Error('synthetic');}}),{stage:'TARGET_REPLACE'});
 assert.equal(fs.readFileSync(f.target,'utf8'),'A=synthetic\n');
 f.run({mode:'bridge',execute:true,nowMs:nowMs+10000});assert.equal(parse(fs.readFileSync(f.target,'utf8'))[endKey],'2026-10-09T13:00:00.000Z');
});
test('recovery rejects corrupt backup and leaves journal PREPARED without rewriting target',t=>{
 const f=fixture(t,'A=synthetic\n');
 assert.throws(()=>f.run({mode:'bridge',execute:true,checkpoint:stage=>{if(stage==='AFTER_TARGET_REPLACE')throw Error('synthetic');}}));
 const current=fs.readFileSync(f.target);const backup=fs.readdirSync(f.dir).find(x=>x.endsWith('.env.backup'));
 fs.writeFileSync(path.join(f.dir,backup),'corrupted synthetic fixture');
 assert.throws(()=>f.run({mode:'bridge',execute:true}),{stage:'JOURNAL_RECOVERY'});assert.ok(fs.readFileSync(f.target).equals(current));
});
test('post-rename expired recovery refuses renewal; final can still close safely',t=>{
 const f=fixture(t,'A=synthetic\n');
 assert.throws(()=>f.run({mode:'bridge',execute:true,checkpoint:stage=>{if(stage==='AFTER_TARGET_REPLACE')throw Error('synthetic');}}));
 assert.throws(()=>f.run({mode:'bridge',execute:true,nowMs:nowMs+3600000}),{stage:'PLAN'});
 assert.equal(f.run({mode:'final',execute:true,nowMs:nowMs+3600000}).mode,'APPLIED_LOCAL');
 assert.equal(parse(fs.readFileSync(f.target,'utf8'))[modeKey],'POST_FRAGMENT');
});
