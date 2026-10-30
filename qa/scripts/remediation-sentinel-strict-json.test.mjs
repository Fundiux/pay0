import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { parseStrictJson } from '../../services/pay0-sentinel-observation/src/strictJson.mjs';
import { decodeEnvelope } from '../../services/pay0-sentinel-observation/src/transport.mjs';
import { createObservationServer } from '../../services/pay0-sentinel-observation/src/http.mjs';
const parse = (text, opts = {}) => parseStrictJson(Buffer.from(text), { maxBytes: 16384, ...opts });
const reject = text => assert.throws(() => parse(text), { message: 'INVALID_JSON' });
test('strict JSON preserves ordinary values without prototype writes', () => {
  for (const text of ['null', 'true', 'false', '-0', '1.25e-2', '[]', '{}', ' [1,"x",null,true,{"a":2}] ', '{"x":"\\u0061\\n\\t\\\\\\\""}']) assert.deepEqual(parse(text), JSON.parse(text));
  const value = parse('{"__proto__":{"polluted":true},"constructor":3,"toString":4}');
  assert.equal(Object.getPrototypeOf(value), Object.prototype); assert.equal(Object.hasOwn(value, '__proto__'), true);
  assert.equal({}.polluted, undefined); assert.equal(value.constructor, 3);
});
test('rejects duplicates including escaped and nested keys', () => {
  for (const value of ['{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '{"__proto__":1,"__proto__":2}', '{"outer":[{"a":1,"a":1}]}', '{"a":{"b":{"c":1,"c":2}}}']) reject(value);
  assert.deepEqual(parse('{"a":{"x":1},"b":{"x":2}}'), { a: { x: 1 }, b: { x: 2 } });
});
test('rejects malformed grammar, overflow and trailing input', () => {
  for (const value of ['', ' ', '{}{}', 'null true', '[1,]', '{"x":1,}', '{x:1}', '{"x" 1}', '+1', '01', '1.', '.1', '1e', '--1', 'NaN', 'Infinity', '1e400', '9007199254740992', '-9007199254740992', '"bad\nstring"', '"\\x20"', '"\\u00xz"', '"unterminated', '[', '{', 'truex', '\uFEFF{}']) reject(value);
  assert.equal(parse('9007199254740991'), Number.MAX_SAFE_INTEGER);
});
test('byte, tree depth and node ceilings apply before expensive downstream work', () => {
  assert.throws(() => parse('"abcd"', { maxBytes: 5 }));
  assert.equal(parse('"abcd"', { maxBytes: 6 }), 'abcd');
  assert.deepEqual(parse('[[]]', { maxDepth: 2 }), [[]]);
  assert.throws(() => parse('[[[]]]', { maxDepth: 2 }));
  assert.deepEqual(parse('{"a":1}', { maxNodes: 3 }), { a: 1 });
  assert.throws(() => parse('{"a":1}', { maxNodes: 2 }));
  for (const opts of [{maxBytes:16385},{maxBytes:NaN},{maxDepth:17},{maxDepth:0},{maxNodes:2049},{maxNodes:0}]) assert.throws(() => parse('{}',opts));
  assert.throws(() => parseStrictJson('{}', {maxBytes:10}));
});
test('UTF8 errors never become replacement characters', () => {
  for (const bytes of [[0xff], [0xc0,0xaf], [0xe2,0x82], [0xed,0xa0,0x80], [0x22,0xff,0x22]]) assert.throws(() => parseStrictJson(Uint8Array.from(bytes), {maxBytes:100}), {message:'INVALID_JSON'});
  // A genuinely encoded U+FFFD remains valid JSON data; no decoder replacement.
  assert.equal(parse('"\uFFFD"'), '\uFFFD');
});
const NOW = 1791500000000;
const origin = { logName:'projects/pay-0-system/logs/pay0_security_observation',projectId:'pay-0-system',serviceName:'test-producer',revisions:['test-00001'],roots:['root-a'],actors:['actor-a'],publisherId:'test-auth' };
const config = { subscription:'projects/demo-observer/subscriptions/test',maxEnvelopeBytes:16384,maxLogBytes:8192,origins:[origin] };
const log = { logName:origin.logName,resource:{type:'cloud_run_revision',labels:{project_id:origin.projectId,service_name:origin.serviceName,revision_name:origin.revisions[0],location:'us-central1'}},timestamp:new Date(NOW).toISOString(),jsonPayload:{schemaVersion:'PAY0-SECURITY-ENVELOPE@1',context:{rootId:'root-a',actorUid:'actor-a'},event:{synthetic:true}} };
const wrap = data => ({ subscription:config.subscription,message:{messageId:'123',publishTime:new Date(NOW).toISOString(),data:Buffer.from(data).toString('base64')} });
test('LogEntry parser rejects duplicate context/resource/event keys and invalid UTF8', () => {
  assert.equal(decodeEnvelope(wrap(JSON.stringify(log)),config,()=>NOW).ingress.rootId,'root-a');
  for (const text of [JSON.stringify(log).replace('"rootId":"root-a"','"rootId":"root-a","\\u0072ootId":"root-a"'),JSON.stringify(log).replace('"project_id":"pay-0-system"','"project_id":"pay-0-system","project_id":"pay-0-system"'),JSON.stringify(log).replace('"synthetic":true','"synthetic":true,"synthetic":true')]) assert.throws(()=>decodeEnvelope(wrap(text),config,()=>NOW));
  assert.throws(()=>decodeEnvelope(wrap(Buffer.from([0xff])),config,()=>NOW));
});
test('HTTP raw PubSub duplicate keys/UTF8 failure ACK permanently without ingestion', async () => {
  let ingested=0, verified=0; const metrics=[];
  const server=createObservationServer({config,verify:async()=>{verified++;},detector:{ingest:async()=>{ingested++;return{outcome:'RECORDED'};}},metric:code=>metrics.push(code),now:()=>NOW});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const send=body=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:server.address().port,path:'/pubsub',method:'POST',headers:{'content-type':'application/json','content-length':Buffer.byteLength(body)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end(body);});
  try {
    const good=JSON.stringify(wrap(JSON.stringify(log)));
    for(const body of [good.replace('"messageId":"123"','"messageId":"123","messageId":"123"'),good.replace('"subscription":','"subscription":"wrong","subscription":'),Buffer.from([0xff])]) assert.equal(await send(body),204);
    assert.equal(ingested,0);assert.equal(verified,3);assert.deepEqual(metrics,['INVALID_ENVELOPE','INVALID_ENVELOPE','INVALID_ENVELOPE']);
    assert.equal(await send(good),200);assert.equal(ingested,1);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
