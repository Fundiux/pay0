const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { test } = require('node:test');
const ts = require('typescript');

function load(name, deps = {}) {
  const source = fs.readFileSync(`functions/src/modules/sentinel/${name}.ts`, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  new Function('exports', 'require', output)(exports, name => {
    assert(Object.hasOwn(deps, name), `Unapproved dependency ${name}`);
    return deps[name];
  });
  return exports;
}
const schema = load('schema', { 'node:crypto': crypto });
const policy = load('policy');
const { ObservationDetector, OBSERVATION_LIMITS } = load('detector', { './schema': schema, './policy': policy });
const { createObservationIngress } = load('ingress');
const { NamespacedObservationStore } = load('transactionalStore');
const NOW = 1800000000000;
const server = { rootId: 'r1', actorUid: 'u1', publisherId: 'pay0-backend', source: 'SERVER' };
const client = { ...server, source: 'CLIENT', publisherId: 'client-report-collector' };
const event = (patch = {}) => ({ schemaVersion: schema.SENTINEL_SCHEMA, rootId: 'r1', actorUid: 'u1', eventId: 'evt1', intentionId: 'intent1', attemptId: 'attempt1', effectId: 'effect1', origin: 'SERVER_EXECUTION', eventType: 'EXTERNAL_OUTCOME_UNKNOWN', occurredAtMs: NOW, ...patch });
const clientEvent = (patch = {}) => event({ origin: 'CLIENT_REPORTED', eventType: 'CLIENT_ROUTE_REPORTED', ...patch });

function store() {
  const data = new Map(), versions = new Map();
  return {
    data, failures: 0, calls: 0, conflicts: 0, rejectAfterWrites: false,
    async transact(root, operation) {
      this.calls++;
      if (this.failures > 0) { this.failures--; throw Error('https://provider.invalid/?token=SECRET'); }
      assert.match(root, /^[a-f0-9]{64}$/);
      for (let attempt = 0; attempt < 1000; attempt++) {
        const reads = new Map(), writes = new Map();
        const path = (kind, key) => { assert.match(key, /^[a-f0-9]{64}$/); return `${root}/${kind}/${key}`; };
        const read = async (kind, key) => { const p = path(kind, key); reads.set(p, versions.get(p) || 0); return structuredClone(data.get(p) || null); };
        const write = (kind, key, row) => writes.set(path(kind, key), structuredClone(row));
        const result = await operation({
          readQuota: key => read('quotas', key), readReceipt: key => read('receipts', key), readIncident: key => read('incidents', key),
          writeQuota: (key, row) => write('quotas', key, row), createReceipt: (key, row) => write('receipts', key, row), writeIncident: (key, row) => write('incidents', key, row),
        });
        if ([...reads].some(([p, v]) => (versions.get(p) || 0) !== v)) { this.conflicts++; continue; }
        if (this.rejectAfterWrites) throw Error('secret commit failure');
        for (const [p, row] of writes) { data.set(p, row); versions.set(p, (versions.get(p) || 0) + 1); }
        return result;
      }
      throw Error('synthetic conflict limit');
    },
    entries(kind) { return [...data].filter(([key]) => key.includes(`/${kind}/`)); },
  };
}

test('forged client origin, promotions and cross-scope events cannot restrict or persist', async () => {
  const db = store(), detector = new ObservationDetector(db, () => NOW);
  for (const [input, context, expected] of [
    [event(), client, 'INVALID_ORIGIN'], [clientEvent({ rootId: 'r2' }), client, 'INVALID_SCOPE'],
    [clientEvent({ actorUid: 'victim' }), client, 'INVALID_SCOPE'],
    [clientEvent({ decision: 'RESTRICT', verified: true }), client, 'INVALID_EVENT'],
    [event({ eventType: 'RESTRICTION_GRANTED' }), server, 'INVALID_EVENT'],
  ]) {
    const result = await detector.ingest(input, context);
    assert.equal(result.outcome, expected); assert.equal(result.decision, 'OBSERVE_ONLY'); assert.equal(result.restricted, false);
  }
  assert.equal(db.calls, 0);
  assert.equal((await detector.ingest(clientEvent(), client)).outcome, 'RECORDED');
  const incident = db.entries('incidents')[0][1];
  assert.equal(incident.reason, 'CLIENT_REPORT_UNVERIFIED'); assert.equal(incident.authority, 'NONE'); assert.equal(incident.status, 'OPEN_OBSERVATION');
});

test('bounded whitelist rejects payloads, getters and loops; hashes all incoming correlation references', async () => {
  const db = store(), detector = new ObservationDetector(db, () => NOW);
  for (const input of [event({ message: 'Bearer SECRET' }), event({ eventId: 'a'.repeat(5000) }),
    event({ intentionId: 'https://token.invalid/secret' }), Object.defineProperty(event(), 'eventId', { get: () => { throw Error('getter must not run'); } })]) {
    assert.equal((await detector.ingest(input, server)).outcome, 'INVALID_EVENT');
  }
  assert.equal((await detector.ingest(event(), { ...server, publisherId: 'pay0-sentinel' })).outcome, 'LOOP_REJECTED');
  assert.equal(db.calls, 0);
  await detector.ingest(event({ intentionId: 'SECRET_IDENTIFIER_VALUE' }), server);
  const serialized = JSON.stringify([...db.data]);
  assert(!serialized.includes('SECRET_IDENTIFIER_VALUE')); assert(!serialized.includes('evt1')); assert(!serialized.includes('attempt1'));
});

test('concurrent duplicate events write one receipt/incident and charge quota once', async () => {
  const db = store(), detector = new ObservationDetector(db, () => NOW);
  const results = await Promise.all(Array.from({ length: 20 }, () => detector.ingest(event(), server)));
  assert.equal(results.filter(r => r.outcome === 'RECORDED').length, 1);
  assert.equal(results.filter(r => r.outcome === 'DUPLICATE').length, 19);
  assert(db.conflicts > 0); assert.equal(db.entries('receipts').length, 1); assert.equal(db.entries('incidents')[0][1].eventCount, 1);
  assert(db.entries('quotas').every(([, row]) => row.accepted === 1));
});

test('out-of-order events preserve timeline and append evidence without promoting state', async () => {
  const db = store(), detector = new ObservationDetector(db, () => NOW);
  await detector.ingest(event(), server);
  const latestEvidence = db.entries('incidents')[0][1].evidence;
  await detector.ingest(event({ eventId: 'older', occurredAtMs: NOW - 1000, effectId: 'olderEffect' }), server);
  const incident = db.entries('incidents')[0][1];
  assert.equal(incident.firstOccurredAtMs, NOW - 1000); assert.equal(incident.lastOccurredAtMs, NOW);
  assert.deepEqual(incident.evidence, latestEvidence); assert.equal(incident.eventCount, 2);
  assert.equal(db.entries('receipts').length, 2); assert.equal(incident.status, 'OPEN_OBSERVATION');
  assert.equal(incident.recovery, 'HUMAN_REVIEW_ONLY'); assert.equal(incident.authority, 'NONE');
});

test('client actor/root quotas are atomic, isolate roots and cannot exhaust server budget', async () => {
  const db = store(); let now = NOW; const detector = new ObservationDetector(db, () => now);
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => detector.ingest(clientEvent({ eventId: `client${i}` }), client)));
  assert.equal(results.filter(r => r.outcome === 'RECORDED').length, OBSERVATION_LIMITS.clientPerActor);
  assert.equal(results.filter(r => r.outcome === 'QUOTA').length, 6);
  assert.equal((await detector.ingest(event(), server)).outcome, 'RECORDED');
  assert.equal((await detector.ingest(clientEvent({ rootId: 'r2' }), { ...client, rootId: 'r2' })).outcome, 'RECORDED');
  // Same publisher/eventId cannot suppress another actor's receipt.
  assert.equal((await detector.ingest(clientEvent({ actorUid: 'u2', eventId: 'client0' }), { ...client, actorUid: 'u2' })).outcome, 'RECORDED');
  now += OBSERVATION_LIMITS.windowMs;
  assert.equal((await detector.ingest(clientEvent({ eventId: 'newWindow' }), client)).outcome, 'RECORDED');
});

test('root quota limits different actors and server quota is independent of invalid inputs', async () => {
  const db = store(), detector = new ObservationDetector(db, () => NOW);
  const results = await Promise.all(Array.from({ length: 36 }, (_, i) => detector.ingest(clientEvent({ actorUid: `u${i}`, eventId: `evt${i}` }), { ...client, actorUid: `u${i}` })));
  assert.equal(results.filter(r => r.outcome === 'RECORDED').length, OBSERVATION_LIMITS.clientPerRoot);
  assert.equal(db.entries('receipts').length, OBSERVATION_LIMITS.clientPerRoot);
  assert.equal((await detector.ingest(event(), server)).outcome, 'RECORDED');
});

test('store failures never leak details or commit partial evidence; breaker recovers only after interval', async () => {
  const db = store(); let now = NOW; const detector = new ObservationDetector(db, () => now);
  db.rejectAfterWrites = true;
  for (let i = 0; i < 3; i++) assert.deepEqual(await detector.ingest(event(), server), { decision: 'OBSERVE_ONLY', restricted: false, outcome: 'STORE_UNAVAILABLE' });
  assert.equal(db.data.size, 0); const calls = db.calls;
  assert.equal((await detector.ingest(event(), server)).outcome, 'CIRCUIT_OPEN'); assert.equal(db.calls, calls);
  now += OBSERVATION_LIMITS.breakerOpenMs; db.rejectAfterWrites = false;
  const [probe, concurrent] = await Promise.all([detector.ingest(event(), server), detector.ingest(event({ eventId: 'parallelProbe' }), server)]);
  assert.equal(probe.outcome, 'RECORDED'); assert.equal(concurrent.outcome, 'CIRCUIT_OPEN');
  assert.equal((await detector.ingest(event(), server)).outcome, 'DUPLICATE');
});

test('corrupt storage cannot promote authority; stale replays remain denied after receipt retention', async () => {
  const db = store(); let now = NOW; const detector = new ObservationDetector(db, () => now);
  await detector.ingest(event(), server);
  const [key, row] = db.entries('incidents')[0]; db.data.set(key, { ...row, status: 'RESTRICTED', authority: 'AUTOMATIC' });
  assert.equal((await detector.ingest(event({ eventId: 'next' }), server)).outcome, 'STORE_UNAVAILABLE');
  assert.equal(db.entries('receipts').length, 1);
  now += OBSERVATION_LIMITS.receiptRetentionMs + 1;
  assert.equal((await detector.ingest(event(), server)).outcome, 'STALE_EVENT');
  assert.equal((await detector.ingest(event({ occurredAtMs: now + schema.MAX_FUTURE_SKEW_MS + 1 }), server)).outcome, 'STALE_EVENT');
});

test('ingress authenticates transport before reading event and never trusts body verification', async () => {
  const db = store(), detector = new ObservationDetector(db, () => NOW); let reads = 0;
  const handle = createObservationIngress({ detector, verifyEnvelope: async envelope => {
    if (envelope.transport !== 'trusted') throw Error('secret auth error'); return client;
  }, readEvent: envelope => { reads++; return envelope.body; } });
  assert.equal((await handle({ transport: 'forged', body: event(), context: server })).outcome, 'INVALID_ORIGIN');
  assert.equal(reads, 0); assert.equal(db.calls, 0);
  assert.equal((await handle({ transport: 'trusted', body: event(), context: server })).outcome, 'INVALID_ORIGIN');
  assert.equal((await handle({ transport: 'trusted', body: clientEvent() })).outcome, 'RECORDED');
});

test('persistence adapter confines every read/write to fixed incident namespace and rejects traversal', async () => {
  const paths = [], data = new Map();
  const adapter = new NamespacedObservationStore({ runTransaction: async operation => operation({
    read: async path => { paths.push(path); return data.get(path) || null; },
    create: (path, value) => { assert(!data.has(path)); paths.push(path); data.set(path, value); },
    replace: (path, value) => { paths.push(path); data.set(path, value); },
  }) });
  const detector = new ObservationDetector(adapter, () => NOW);
  assert.equal((await detector.ingest(event(), server)).outcome, 'RECORDED');
  assert(paths.every(path => /^sentinelObservationRoots\/[a-f0-9]{64}\/(quotas|receipts|incidents)\/[a-f0-9]{64}$/.test(path)));
  assert.throws(() => adapter.transact('../users', async () => {}), /INVALID_OBSERVATION_NAMESPACE/);
  await assert.rejects(adapter.transact(schema.digest('r1'), async tx => tx.readIncident('../users/u1')), /INVALID_OBSERVATION_KEY/);
  assert(paths.every(path => !path.includes('/users/')));
});
