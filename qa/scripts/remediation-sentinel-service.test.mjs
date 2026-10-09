import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { loadConfig } from '../../services/pay0-sentinel-observation/src/config.mjs';
import { decodeEnvelope, createOidcVerifier } from '../../services/pay0-sentinel-observation/src/transport.mjs';
import { FirestoreIncidentPersistence, GlobalAdmissionStore, GLOBAL_PATH } from '../../services/pay0-sentinel-observation/src/persistence.mjs';
import { createObservationServer } from '../../services/pay0-sentinel-observation/src/http.mjs';
const require = createRequire(import.meta.url);
const ts = require('../../functions/node_modules/typescript');
const core = new Map();
function load(name) {
  if (core.has(name)) return core.get(name);
  const source = readFileSync(`functions/src/modules/sentinel/${name}.ts`, 'utf8');
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText}\n})`)(
    id => id.startsWith('./') ? load(id.slice(2)) : require(id), module, module.exports);
  core.set(name, module.exports); return module.exports;
}
const NOW = 1791500000000;
const origin = { projectId: 'pay-0-system', logName: 'projects/pay-0-system/logs/pay0_security_observation', publisherId: 'payment-auth-v1', serviceName: 'payment-auth', revisions: ['payment-auth-00001'], roots: ['root-a'], actors: ['actor-a'] };
const env = { OBSERVATION_PROJECT_ID: 'pay0-observe-test', OBSERVATION_DATABASE_ID: 'sentinel-observation', PUSH_SERVICE_ACCOUNT: 'pay0-sentinel-push@pay0-observe-test.iam.gserviceaccount.com', PUSH_AUDIENCE: 'https://observer-test.run.app', ALLOWED_ORIGINS_JSON: JSON.stringify([origin]) };
const config = loadConfig(env);
const event = (id = 'event-a') => ({ schemaVersion: 'PAY0-SECURITY-EVENT@1', rootId: 'root-a', actorUid: 'actor-a', eventId: id, origin: 'SERVER_AUTH_DECISION', eventType: 'AUTHORIZATION_DENIED', occurredAtMs: NOW });
function envelope(id = 'event-a', transform = () => {}) {
  const log = { logName: origin.logName, timestamp: new Date(NOW).toISOString(), resource: { type: 'cloud_run_revision', labels: { project_id: 'pay-0-system', service_name: origin.serviceName, revision_name: origin.revisions[0], location: 'us-central1' } }, jsonPayload: { schemaVersion: 'PAY0-SECURITY-ENVELOPE@1', context: { rootId: 'root-a', actorUid: 'actor-a' }, event: event(id) } };
  transform(log);
  return { subscription: config.subscription, message: { messageId: '123', publishTime: new Date(NOW).toISOString(), data: Buffer.from(JSON.stringify(log)).toString('base64') } };
}
class FakeDb {
  rows = new Map(); revision = 0; fail = false; attempts = 0;
  doc(path) { return path; }
  async runTransaction(fn, options) {
    assert.equal(options.maxAttempts, 3);
    for (let attempt = 0; attempt < 100; attempt++) {
      this.attempts++;
      if (this.fail) throw new Error('PRIVATE_PROVIDER_ERROR');
      const revision = this.revision; const writes = []; let writing = false;
      const result = await fn({
        get: async path => { assert.equal(writing, false); const data = structuredClone(this.rows.get(path)); return { exists: data !== undefined, data: () => data }; },
        set: (path, data) => { writing = true; writes.push({ path, data }); },
        create: (path, data) => { writing = true; writes.push({ path, data, create: true }); },
      });
      if (revision !== this.revision) continue;
      for (const row of writes) { if (row.create && this.rows.has(row.path)) throw new Error('EXISTS'); }
      if (writes.length) this.revision++;
      for (const row of writes) this.rows.set(row.path, structuredClone(row.data));
      return result;
    }
    throw new Error('CONTENTION');
  }
}
function fixture(overrides = {}) {
  const db = new FakeDb();
  const persistence = new FirestoreIncidentPersistence(db, milliseconds => ({ timestamp: milliseconds }), { ...config, ...overrides }, () => NOW);
  const store = new GlobalAdmissionStore(new (load('transactionalStore').NamespacedObservationStore)(persistence));
  return { db, persistence, detector: new (load('detector').ObservationDetector)(store, () => NOW) };
}
test('server root/actor limit remains enforced when global admission is larger', async () => {
  const { db, detector } = fixture({ globalPerMinute: 1000, globalPerDay: 1000 });
  const ingress = { rootId: 'root-a', actorUid: 'actor-a', publisherId: 'p', source: 'SERVER' };
  for (let n = 0; n < 180; n++) assert.equal((await detector.ingest(event(`limit-${n}`), ingress)).outcome, 'RECORDED');
  assert.equal((await detector.ingest(event('limit-over'), ingress)).outcome, 'QUOTA');
  assert.equal(db.rows.get(GLOBAL_PATH).day.count, 180);
  assert.equal((await detector.ingest({ ...event('other'), rootId: 'root-b' }, { ...ingress, rootId: 'root-b' })).outcome, 'RECORDED');
});
test('configuration fails closed for production/default DB and unbounded origin scopes', () => {
  for (const change of [{ OBSERVATION_PROJECT_ID: 'pay-0-system' }, { OBSERVATION_DATABASE_ID: '(default)' }, { PUSH_SERVICE_ACCOUNT: 'other@example.com' }, { ALLOWED_ORIGINS_JSON: '[]' }, { ALLOWED_ORIGINS_JSON: JSON.stringify([{ ...origin, roots: ['*'] }]) }, { ALLOWED_ORIGINS_JSON: JSON.stringify([{ ...origin, publisherId: 'sentinel-self' }]) }]) assert.throws(() => loadConfig({ ...env, ...change }));
});
test('allowlist binds actors to one root and preflight stays offline/redacted by default', () => {
  assert.throws(() => loadConfig({ ...env, ALLOWED_ORIGINS_JSON: JSON.stringify([{ ...origin, roots: ['root-a', 'root-b'] }]) }));
  const scoped = loadConfig({ ...env, ALLOWED_ORIGINS_JSON: JSON.stringify([origin, { ...origin, roots: ['root-b'], actors: ['actor-b'] }]) });
  assert.throws(() => decodeEnvelope(envelope('e', log => log.jsonPayload.context.rootId = 'root-b'), scoped, () => NOW));
  assert.equal(decodeEnvelope(envelope('e', log => { log.jsonPayload.context.rootId = 'root-b'; log.jsonPayload.context.actorUid = 'actor-b'; }), scoped, () => NOW).ingress.actorUid, 'actor-b');
  const result = spawnSync(process.execPath, ['services/pay0-sentinel-observation/scripts/preflight.mjs'], { env: { ...process.env, ...env }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.mode, 'DRY_RUN_READ_ONLY'); assert.equal(report.deploy, false); assert.equal(report.configValid, true);
  assert.equal(report.sourceBillingReadable, undefined); assert.equal(result.stdout.includes('root-a'), false);
});
test('OIDC requires signed verifier plus exact email audience issuer expiry and verified email', async () => {
  const claims = { aud: config.audience, email: config.email, email_verified: true, iss: 'https://accounts.google.com', exp: Math.floor(NOW / 1000) + 60, iat: Math.floor(NOW / 1000) };
  const auth = (change = {}) => ({ verifyIdToken: async request => { assert.equal(request.audience, config.audience); return { getPayload: () => ({ ...claims, ...change }) }; } });
  await createOidcVerifier(auth(), config, () => NOW)('Bearer synthetic.token.signature');
  for (const change of [{ aud: 'other' }, { email: 'other' }, { email_verified: false }, { iss: 'evil' }, { exp: NOW / 1000 - 1 }, { iat: NOW / 1000 + 61 }]) await assert.rejects(createOidcVerifier(auth(change), config, () => NOW)('Bearer synthetic.token.signature'));
  await assert.rejects(createOidcVerifier({ verifyIdToken: async () => { throw new Error('signature'); } }, config)('Bearer synthetic.token.signature'));
});
test('envelope rejects wrong subscription producer revision root actor and free-form payload', () => {
  assert.equal(decodeEnvelope(envelope(), config, () => NOW).ingress.publisherId, origin.publisherId);
  for (const transform of [log => log.resource.labels.service_name = 'evil', log => log.resource.labels.revision_name = 'old', log => log.jsonPayload.context.rootId = 'other', log => log.jsonPayload.context.actorUid = 'other', log => log.jsonPayload.extra = 'token', log => log.textPayload = 'sensitive']) assert.throws(() => decodeEnvelope(envelope('e', transform), config, () => NOW));
  assert.throws(() => decodeEnvelope({ ...envelope(), subscription: 'other' }, config, () => NOW));
  const large = envelope(); large.message.data = 'A'.repeat(12000); assert.throws(() => decodeEnvelope(large, config, () => NOW));
});
test('real core and transactional adapter atomically dedupe with TTL and one global debit', async () => {
  const { db, detector } = fixture(); const decoded = decodeEnvelope(envelope(), config, () => NOW);
  const results = await Promise.all(Array.from({ length: 12 }, () => detector.ingest(decoded.event, decoded.ingress)));
  assert.equal(results.filter(row => row.outcome === 'RECORDED').length, 1);
  assert.equal(results.filter(row => row.outcome === 'DUPLICATE').length, 11);
  assert.equal(db.rows.get(GLOBAL_PATH).day.count, 1);
  assert.equal(db.rows.size, 5);
  for (const row of db.rows.values()) assert.ok(row.expiresAt.timestamp > NOW);
});
test('global quota across roots is atomic and neither partial writes nor retries debit twice', async () => {
  const { db, detector } = fixture({ globalPerMinute: 2, globalPerDay: 2 });
  const results = await Promise.all(Array.from({ length: 8 }, (_, n) => detector.ingest({ ...event(`event-${n}`), rootId: `root-${n}` }, { rootId: `root-${n}`, actorUid: 'actor-a', publisherId: 'p', source: 'SERVER' })));
  assert.equal(results.filter(row => row.outcome === 'RECORDED').length, 2);
  assert.equal(results.filter(row => row.outcome === 'QUOTA').length, 6);
  assert.equal(db.rows.get(GLOBAL_PATH).day.count, 2);
  assert.equal(db.rows.size, 9);
  const before = db.rows.size; db.fail = true;
  assert.equal((await detector.ingest(event('next'), { rootId: 'root-a', actorUid: 'actor-a', publisherId: 'p', source: 'SERVER' })).outcome, 'STORE_UNAVAILABLE');
  assert.equal(db.rows.size, before);
});
test('adapter denies arbitrary paths and corrupted global admission rolls back', async () => {
  const { persistence, db, detector } = fixture();
  await assert.rejects(persistence.runTransaction(tx => tx.read('pagos/private')));
  db.rows.set(GLOBAL_PATH, { minute: { start: NOW, count: -1 } });
  const decoded = decodeEnvelope(envelope(), config, () => NOW);
  assert.equal((await detector.ingest(decoded.event, decoded.ingress)).outcome, 'STORE_UNAVAILABLE');
  assert.equal(db.rows.size, 1);
});
async function request(server, body, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, method: 'POST', path: '/pubsub', headers: { authorization: 'Bearer allowed', 'content-type': 'application/json' }, ...options }, res => { let data = ''; res.on('data', chunk => data += chunk); res.on('end', () => resolve({ status: res.statusCode, data })); });
    req.on('error', reject); req.end(body);
  });
}
test('native HTTP verifies before body, ACKs poison and retries store failures without leaking', async t => {
  const { detector, db } = fixture(); let verified = 0; const metrics = [];
  const server = createObservationServer({ config, detector, now: () => NOW, metric: code => metrics.push(code), verify: async header => { verified++; if (header !== 'Bearer allowed') throw new Error('secret'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  assert.equal((await request(server, 'malformed', { headers: { authorization: 'Bearer bad' } })).status, 401);
  assert.equal((await request(server, '{}')).status, 204);
  assert.equal((await request(server, 'x'.repeat(20000), { headers: { authorization: 'Bearer allowed', 'content-type': 'application/json', 'transfer-encoding': 'chunked' } })).status, 204);
  assert.equal((await request(server, JSON.stringify(envelope()))).status, 200);
  db.fail = true;
  const result = await request(server, JSON.stringify(envelope('new')));
  assert.equal(result.status, 503); assert.ok(!result.data.includes('PRIVATE'));
  assert.equal(verified, 5); assert.deepEqual(metrics, ['UNAUTHENTICATED', 'INVALID_ENVELOPE', 'INVALID_ENVELOPE', 'RECORDED', 'STORE_UNAVAILABLE']);
  assert.equal((await request(server, '', { method: 'GET', path: '/healthz' })).status, 200);
});
