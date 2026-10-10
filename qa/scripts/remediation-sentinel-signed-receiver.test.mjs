import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash, sign, constants } from 'node:crypto';
import http from 'node:http';
import { loadConfig } from '../../services/pay0-sentinel-observation/src/config.mjs';
import { decodeEnvelope } from '../../services/pay0-sentinel-observation/src/transport.mjs';
import { createSignedVerifier } from '../../services/pay0-sentinel-observation/src/signedVerifier.mjs';
import { createObservationServer } from '../../services/pay0-sentinel-observation/src/http.mjs';
import contract from '../../services/pay0-sentinel-observation/.build/core/signedContract.js';
import detectorModule from '../../services/pay0-sentinel-observation/.build/core/detector.js';

// Ephemeral synthetic RSA key, no credential provider or external request.
const pair = generateKeyPairSync('rsa', { modulusLength: 3072, publicExponent: 65537 });
const NOW = 1791500000000;
const keyVersion = 'projects/demo-observer/locations/us-central1/keyRings/observe/cryptoKeys/listusers/cryptoKeyVersions/1';
const producer = { publisherId: 'listusers-auth-v1', audience: 'pay0-observation-v1', projectId: 'pay-0-system', functionName: 'listUsers', serviceName: 'listusers', revisions: ['listusers-00001-test'], roots: ['root-a'], actors: ['actor-a'], keys: [{ keyVersion, algorithm: 'RSA_SIGN_PSS_3072_SHA256', status: 'ACTIVE', spkiPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(), spkiSha256: createHash('sha256').update(pair.publicKey.export({ type: 'spki', format: 'der' })).digest('hex') }] };
const trust = { schemaVersion: 'PAY0-SIGNED-TRUST@1', producers: [producer] };
const origin = { publisherId: 'canary-v1', projectId: 'pay-0-system', logName: 'projects/pay-0-system/logs/pay0_security_observation', serviceName: 'pay0-security-canary', revisions: ['pay0-security-canary-00001-test'], roots: ['root-canary'], actors: ['actor-canary'] };
const env = { OBSERVATION_PROJECT_ID: 'pay0-observe-test', OBSERVATION_DATABASE_ID: 'sentinel-observation', PUSH_SERVICE_ACCOUNT: 'pay0-sentinel-push@pay0-observe-test.iam.gserviceaccount.com', PUSH_AUDIENCE: 'https://observer-test.run.app', ALLOWED_ORIGINS_JSON: JSON.stringify([origin]) };
const config = loadConfig({ ...env, SIGNED_TRUST_MANIFEST_JSON: JSON.stringify(trust) });
const verify = createSignedVerifier(config.signedTrust, () => NOW);
const tuple = () => ['PAY0-SECURITY-SIGNED@1', producer.audience, keyVersion, producer.projectId, producer.functionName, producer.serviceName, producer.revisions[0], 'root-a', 'actor-a', '12345678-1234-4123-8123-123456789abc', 'AUTHORIZATION_DENIED', 'SERVER_AUTH_DECISION', NOW, NOW, NOW + 86400000];
function signedLog(t = tuple()) {
  const bytes = contract.canonicalizeSignedTuple(t);
  return { logName: origin.logName, timestamp: new Date(t[12]).toISOString(), insertId: t[9], severity: 'NOTICE', resource: { type: 'cloud_run_revision', labels: { project_id: t[3], service_name: t[5], revision_name: t[6], configuration_name: t[5], location: 'us-central1' } }, jsonPayload: { schemaVersion: t[0], context: { rootId: t[7], actorUid: t[8] }, signedBytesB64: bytes.toString('base64'), signatureB64: sign('sha256', bytes, { key: pair.privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString('base64') } };
}
function legacyLog() {
  return { logName: origin.logName, timestamp: new Date(NOW).toISOString(), resource: { type: 'cloud_run_revision', labels: { project_id: origin.projectId, service_name: origin.serviceName, revision_name: origin.revisions[0], location: 'us-central1' } }, jsonPayload: { schemaVersion: 'PAY0-SECURITY-ENVELOPE@1', context: { rootId: 'root-canary', actorUid: 'actor-canary' }, event: { schemaVersion: 'PAY0-SECURITY-EVENT@1', rootId: 'root-canary', actorUid: 'actor-canary', eventId: 'canary-event', eventType: 'AUTHORIZATION_DENIED', origin: 'SERVER_AUTH_DECISION', occurredAtMs: NOW } } };
}
function envelope(log, now = NOW) { return { subscription: config.subscription, message: { messageId: '123', message_id: '123', publishTime: new Date(now).toISOString(), publish_time: new Date(now).toISOString(), data: Buffer.from(JSON.stringify(log)).toString('base64') } }; }
const decode = (log, c = config, v = verify) => decodeEnvelope(envelope(log), c, () => NOW, v);

test('signed lane derives all event fields from verified tuple; default trust accepts none', () => {
  const good = signedLog(), decoded = decode(good);
  assert.equal(decoded.ingress.publisherId, producer.publisherId);
  assert.equal(decoded.event.eventId, tuple()[9]);
  assert.equal(decoded.event.origin, 'SERVER_AUTH_DECISION');
  const empty = loadConfig(env);
  assert.deepEqual(empty.signedTrust.producers, []);
  assert.throws(() => decode(good, empty, createSignedVerifier(empty.signedTrust, () => NOW)));
  assert.throws(() => decodeEnvelope(envelope(good), config, () => NOW));
  good.jsonPayload.event = { ...decoded.event, actorUid: 'forged' };
  assert.throws(() => decode(good));
});

test('unsigned listUsers is rejected even with a manually widened legacy allowlist', () => {
  const log = legacyLog(); log.resource.labels.service_name = 'listusers';
  const forged = { ...config, origins: [{ ...origin, serviceName: 'listusers' }] };
  assert.throws(() => decode(log, forged));
  log.resource.labels.service_name = 'listUsers';
  assert.throws(() => decode(log, { ...forged, origins: [{ ...origin, serviceName: 'listUsers' }] }));
  const alternate = 'reviewed-backend-name';
  log.resource.labels.service_name = alternate;
  assert.throws(() => decode(log, { ...config, signedTrust: { ...trust, producers: [{ ...producer, serviceName: alternate }] }, origins: [{ ...origin, serviceName: alternate }] }));
});

test('missing invalid or downgraded signature never falls back to canary', () => {
  for (const mutate of [log => delete log.jsonPayload.signatureB64, log => log.jsonPayload.signatureB64 = 'AA==', log => log.jsonPayload.schemaVersion = 'PAY0-SECURITY-ENVELOPE@1', log => log.jsonPayload.schemaVersion = 'UNKNOWN']) {
    const log = signedLog(); mutate(log); assert.throws(() => decode(log));
  }
  const log = legacyLog(); log.jsonPayload.signatureB64 = 'AA=='; assert.throws(() => decode(log));
  assert.equal(decode(legacyLog()).ingress.publisherId, origin.publisherId);
  const noOrigin = legacyLog(); noOrigin.resource.labels.service_name = 'other'; assert.throws(() => decode(noOrigin));
});

test('signed resource context and external identity must agree with signed contents', () => {
  for (const field of ['project_id', 'service_name', 'revision_name', 'configuration_name', 'location']) {
    const log = signedLog(); log.resource.labels[field] = 'other'; assert.throws(() => decode(log));
  }
  for (const field of ['rootId', 'actorUid']) { const log = signedLog(); log.jsonPayload.context[field] = 'other'; assert.throws(() => decode(log)); }
  for (const mutate of [log => log.logName = 'projects/pay-0-system/logs/other', log => log.insertId = 'other', log => log.timestamp = new Date(NOW + 1).toISOString(), log => log.resource.labels.extra = 'other', log => log.resource.type = 'global']) {
    const log = signedLog(); mutate(log); assert.throws(() => decode(log));
  }
});

test('valid signatures outside revision root actor audience cohort fail', () => {
  for (const [at, value] of [[1, 'other-audience'], [6, 'listusers-00002-other'], [7, 'root-other'], [8, 'actor-other']]) {
    const t = tuple(); t[at] = value; assert.throws(() => decode(signedLog(t)));
  }
  const revoked = structuredClone(trust); revoked.producers[0].keys[0].status = 'REVOKED';
  assert.throws(() => decode(signedLog(), config, createSignedVerifier(revoked, () => NOW)));
});

test('fresh delivery metadata cannot renew signed expiry or hide future occurrence', () => {
  const good = signedLog(); const expired = NOW + 86400000;
  assert.throws(() => decodeEnvelope(envelope(good, expired), config, () => expired, createSignedVerifier(trust, () => expired)));
  const future = tuple(); future[12] += 60001; future[13] += 60001; future[14] += 60001;
  assert.throws(() => decode(signedLog(future)));
});

test('config rejects lane overlap and malformed/duplicate-key trust without widening canary', () => {
  for (const replacement of [{ ...origin, serviceName: 'listusers' }, { ...origin, publisherId: producer.publisherId }]) {
    assert.throws(() => loadConfig({ ...env, ALLOWED_ORIGINS_JSON: JSON.stringify([replacement]), SIGNED_TRUST_MANIFEST_JSON: JSON.stringify(trust) }));
  }
  for (const value of ['', 'null', '{"schemaVersion":"PAY0-SIGNED-TRUST@1","producers":[],"producers":[]}', ' '.repeat(16385)]) assert.throws(() => loadConfig({ ...env, SIGNED_TRUST_MANIFEST_JSON: value }));
});

test('real detector records once; exact replay is duplicate and altered signed content conflicts', async () => {
  const receipts = new Map(), quotas = new Map(), incidents = new Map(); let writes = 0;
  const detector = new detectorModule.ObservationDetector({ transact: async (root, fn) => fn({ readReceipt: async k => receipts.get(root + k) || null, readQuota: async k => quotas.get(root + k) || null, readIncident: async k => incidents.get(root + k) || null, createReceipt: (k, v) => { writes++; receipts.set(root + k, v); }, writeQuota: (k, v) => { writes++; quotas.set(root + k, v); }, writeIncident: (k, v) => { writes++; incidents.set(root + k, v); } }) }, () => NOW);
  const a = decode(signedLog());
  assert.equal((await detector.ingest(a.event, a.ingress)).outcome, 'RECORDED'); const firstWrites = writes;
  const deliveredAgain = envelope(signedLog()); deliveredAgain.message.messageId = deliveredAgain.message.message_id = '456';
  const b = decodeEnvelope(deliveredAgain, config, () => NOW, verify);
  assert.equal((await detector.ingest(b.event, b.ingress)).outcome, 'DUPLICATE');
  const changed = tuple(); changed[12]--; changed[14]--;
  const c = decode(signedLog(changed)); assert.equal((await detector.ingest(c.event, c.ingress)).outcome, 'EVENT_CONTENT_CONFLICT');
  assert.equal(writes, firstWrites); assert.equal(receipts.size, 1);
  const incident = [...incidents.values()][0]; assert.equal(incident.eventCount, 1); assert.equal(incident.authority, 'NONE');
});

async function request(server, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/pubsub', method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer SYNTHETIC' } }, res => {
      let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, body: text }));
    }); req.on('error', reject); req.end(JSON.stringify(body));
  });
}
test('HTTP permanently ACKs signature failures before detector; storage failures remain retryable', async () => {
  let calls = 0; const metrics = [];
  const server = createObservationServer({ config, verify: async () => {}, verifySigned: verify, now: () => NOW,
    detector: { ingest: async () => { calls++; return { outcome: 'STORE_UNAVAILABLE' }; } }, metric: code => metrics.push(code) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const bad = signedLog(); bad.jsonPayload.signatureB64 = 'AA==';
    assert.equal((await request(server, envelope(bad))).status, 204); assert.equal(calls, 0);
    assert.equal((await request(server, envelope(signedLog()))).status, 503); assert.equal(calls, 1);
    assert.deepEqual(metrics, ['INVALID_ENVELOPE', 'STORE_UNAVAILABLE']);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
