import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { request } from 'node:http';
import ts from 'typescript';
import { CANARY, loadConfig } from '../../services/pay0-security-observation-publisher/src/config.mjs';
import { createLoggingWriter } from '../../services/pay0-security-observation-publisher/src/logging.mjs';
import { createCanaryServer } from '../../services/pay0-security-observation-publisher/src/http.mjs';
import { decodeEnvelope } from '../../services/pay0-sentinel-observation/src/transport.mjs';
const require = createRequire(import.meta.url);
function load(file) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', code)(name => { assert.equal(name, 'node:crypto'); return require(name); }, module, module.exports);
  return module.exports;
}
const { createAuthorizationObservationPublisher: createPublisher } = load('../../functions/src/modules/securityObservation/publisher.ts');
const { sanitizeSecurityEvent } = load('../../functions/src/modules/sentinel/schema.ts');
const env = { PAY0_SOURCE_PROJECT_ID: CANARY.projectId, K_SERVICE: CANARY.serviceName, K_CONFIGURATION: CANARY.serviceName,
  K_REVISION: CANARY.serviceName + '-00001-test', OBSERVATION_PUBLISHER_MODE: 'CANARY_DRY_RUN' };
const config = loadConfig(env), now = Date.now(), context = { rootId: CANARY.rootId, actorUid: CANARY.actorUid };
const metadataResponse = value => new Response(value, { headers: { 'Metadata-Flavor': 'Google' } });
function fakeFetch(calls, override) {
  return async (url, options) => {
    calls.push({ url, options });
    if (override) { const response = await override(url, options); if (response) return response; }
    if (url.endsWith('/email')) return metadataResponse(CANARY.email);
    if (url.endsWith('/project-id')) return metadataResponse(CANARY.projectId);
    if (url.endsWith('/token')) return metadataResponse(JSON.stringify({ token_type: 'Bearer', access_token: 'synthetic-test-token-abcdefghijklmn', expires_in: 3600 }));
    assert.equal(url, 'https://logging.googleapis.com/v2/entries:write'); return new Response('{}');
  };
}
test('configuration pins source, service and credentialless runtime; disabled is default', () => {
  assert.equal(loadConfig({ ...env, OBSERVATION_PUBLISHER_MODE: undefined }).mode, 'DISABLED');
  for (const override of [{ PAY0_SOURCE_PROJECT_ID: 'other-project' }, { K_SERVICE: 'other' }, { GOOGLE_APPLICATION_CREDENTIALS: '/never/read' }, { OBSERVATION_PUBLISHER_MODE: 'ENFORCE' }]) assert.throws(() => loadConfig({ ...env, ...override }), /INVALID_PUBLISHER_CONFIG/);
});
test('disabled or invalid context never emits and getters/client fields never enter event', async () => {
  let writes = 0, reads = 0;
  const base = { resource: config.resource, write: async () => writes++, now: () => now };
  assert.equal(await createPublisher({ ...base, enabled: false }).authorizationDenied(context), 'DISABLED');
  const publisher = createPublisher({ ...base, enabled: true });
  for (const invalid of [{ ...context, token: 'DO_NOT_LOG' }, { ...context, event: {} }, { rootId: 'a', get actorUid() { reads++; return 'b'; } }, { rootId: '../../other', actorUid: 'b' }]) assert.equal(await publisher.authorizationDenied(invalid), 'INVALID_CONTEXT');
  assert.equal(writes, 0); assert.equal(reads, 0);
});
test('fixed sanitized event round trips actual Sentinel transport and sanitizer with matching allowlist', async () => {
  let entry;
  const publisher = createPublisher({ enabled: true, resource: config.resource, now: () => now, eventId: () => 'fixed-server-event', write: async e => { entry = e; } });
  assert.equal(await publisher.authorizationDenied(context), 'ACCEPTED');
  const subscription = 'projects/isolated-observation/subscriptions/pay0-security-observe-v1';
  const origin = { projectId: CANARY.projectId, publisherId: CANARY.publisherId, logName: entry.logName, serviceName: CANARY.serviceName,
    revisions: [config.resource.revisionName], roots: [CANARY.rootId], actors: [CANARY.actorUid] };
  const envelope = { subscription, message: { messageId: '10001', publishTime: new Date(now).toISOString(), data: Buffer.from(JSON.stringify(entry)).toString('base64') } };
  const decoded = decodeEnvelope(envelope, { subscription, maxLogBytes: 8192, origins: [origin] }, () => now);
  assert.equal(decoded.ingress.source, 'SERVER');
  const sanitized = sanitizeSecurityEvent(decoded.event, decoded.ingress, now);
  assert.equal(sanitized.origin, 'SERVER_AUTH_DECISION'); assert.equal(sanitized.eventType, 'AUTHORIZATION_DENIED');
  assert.throws(() => decodeEnvelope(envelope, { subscription, maxLogBytes: 8192, origins: [{ ...origin, revisions: ['unapproved-revision'] }] }, () => now));
  assert.deepEqual(Object.keys(entry.jsonPayload.event).sort(), ['actorUid', 'eventId', 'eventType', 'occurredAtMs', 'origin', 'rootId', 'schemaVersion']);
});
test('Logging REST uses verified runtime identity, same deadline signal and one bounded dry-run entry', async () => {
  const calls = [], writer = createLoggingWriter(config, { fetchImpl: fakeFetch(calls) });
  const publisher = createPublisher({ enabled: true, resource: config.resource, now: () => now, write: writer });
  assert.equal(await publisher.authorizationDenied(context), 'ACCEPTED'); assert.equal(calls.length, 4);
  assert.equal(new Set(calls.map(c => c.options.signal)).size, 1);
  assert.ok(calls.every(c => c.options.redirect === 'error'));
  const body = JSON.parse(calls[3].options.body); assert.equal(body.dryRun, true); assert.equal(body.partialSuccess, false); assert.equal(body.entries.length, 1);
  assert.doesNotMatch(calls[3].options.body, /synthetic-test-token|Authorization|request/);
});
test('wrong metadata identity denies before obtaining token; errors never expose provider body', async () => {
  const calls = [];
  const writer = createLoggingWriter(config, { fetchImpl: fakeFetch(calls, url => url.endsWith('/email') ? metadataResponse('shared-editor@other.iam.gserviceaccount.com') : null) });
  await assert.rejects(writer({}), /^Error: OBSERVATION_WRITE_FAILED$/);
  assert.equal(calls.length, 2);
  const denied = createLoggingWriter(config, { fetchImpl: fakeFetch([], url => url.startsWith('https:') ? new Response('SECRET_PROVIDER_BODY', { status: 403 }) : null) });
  await assert.rejects(denied({}), /^Error: OBSERVATION_WRITE_FAILED$/);
});
test('oversized metadata/token responses and missing metadata provenance are rejected without Logging call', async () => {
  for (const override of [url => url.endsWith('/token') ? metadataResponse('x'.repeat(8193)) : null,
    url => url.endsWith('/project-id') ? new Response(CANARY.projectId) : null,
    url => url.endsWith('/email') ? metadataResponse('x'.repeat(257)) : null]) {
    const calls = [], writer = createLoggingWriter(config, { fetchImpl: fakeFetch(calls, override) });
    await assert.rejects(writer({}), /^Error: OBSERVATION_WRITE_FAILED$/);
    assert.ok(calls.every(call => call.url.startsWith('http://metadata.google.internal/')));
  }
});
test('metadata plus logging consumes one three-second deadline with no retry', async () => {
  let calls = 0;
  const writer = createLoggingWriter(config, { fetchImpl: async (_url, { signal }) => {
    calls++;
    return new Promise((_, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
  } });
  // Keep the process alive while AbortSignal.timeout's unref timer expires.
  const keepAlive = setInterval(() => {}, 1000);
  try { await assert.rejects(writer({}), /^Error: OBSERVATION_WRITE_FAILED$/); assert.equal(calls, 2); }
  finally { clearInterval(keepAlive); }
});
test('publisher contains failures, bounds concurrent/minute/lifetime attempts and does not retry', async () => {
  let clock = now, writes = 0, release;
  const publisher = createPublisher({ enabled: true, resource: config.resource, now: () => clock, write: async () => { writes++; if (writes === 1) await new Promise(resolve => { release = resolve; }); throw Error('SECRET'); } });
  const first = publisher.authorizationDenied(context);
  assert.equal(await publisher.authorizationDenied(context), 'RATE_LIMITED'); release(); assert.equal(await first, 'WRITE_FAILED');
  for (let i = 1; i < 6; i++) assert.equal(await publisher.authorizationDenied(context), 'WRITE_FAILED');
  assert.equal(await publisher.authorizationDenied(context), 'RATE_LIMITED');
  while (writes < 20) { clock += 60_000; assert.equal(await publisher.authorizationDenied(context), 'WRITE_FAILED'); }
  clock += 60_000; assert.equal(await publisher.authorizationDenied(context), 'RATE_LIMITED'); assert.equal(writes, 20);
});
test('private canary HTTP accepts only empty POST and always supplies fixed synthetic context', async () => {
  const observations = [];
  const server = createCanaryServer(config, { async authorizationDenied(value) { observations.push(value); return 'ACCEPTED'; } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  async function call(path, body = '', method = 'POST', extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: server.address().port, path, method, headers: { 'Content-Length': Buffer.byteLength(body), ...extraHeaders } }, res => {
        let data = ''; res.on('data', chunk => data += chunk); res.on('end', () => resolve({ status: res.statusCode, data }));
      }); req.on('error', reject); req.end(body);
    });
  }
  try {
    assert.equal((await call('/canary', JSON.stringify({ rootId: 'foreign', actorUid: 'foreign' }))).status, 400);
    assert.equal((await call('/canary?token=NEVER_PERSIST')).status, 404);
    assert.equal((await call('/canary', '', 'POST', { Origin: 'https://example.invalid' })).status, 400);
    assert.equal((await call('/healthz', '', 'GET')).status, 200);
    assert.equal((await call('/canary')).status, 200);
    assert.deepEqual(observations, [context]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
