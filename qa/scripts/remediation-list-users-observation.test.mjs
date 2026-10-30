import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(file, dependencies = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL('../../functions/src/' + file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === 'node:crypto') return require(name);
    throw Error('UNEXPECTED_DEPENDENCY');
  }, module, module.exports);
  return module.exports;
}
const adapter = load('modules/securityObservation/authorizationDenied.ts');
const { createAuthorizationObservationPublisher } = load('modules/securityObservation/publisher.ts');
const { createObservationLoggingWriter } = load('modules/securityObservation/loggingWriter.ts');
const profile = { uid: 'actor', rootId: 'root', exists: true };
const resource = { projectId: 'pay-0-system', serviceName: 'listusers', configurationName: 'listusers', revisionName: 'listusers-00001-test' };
const denial = () => Object.assign(new Error('original-denial'), { code: 'permission-denied', details: { reason: 'ACCOUNT_RESTRICTED', recovery: 'CONTACT_SUPPORT' } });
const sameRejection = async (promise, original) => assert.rejects(promise, error => error === original);

test('default stays disabled regardless of environment; allowed result remains identical', async () => {
  const before = process.env.OBSERVATION_PUBLISHER_MODE;
  process.env.OBSERVATION_PUBLISHER_MODE = 'ENFORCE';
  try {
    const result = {}; assert.equal(await adapter.authorizeListUsersObserved(() => result, profile), result);
    const original = denial(); await sameRejection(adapter.authorizeListUsersObserved(() => { throw original; }, profile), original);
  } finally { if (before === undefined) delete process.env.OBSERVATION_PUBLISHER_MODE; else process.env.OBSERVATION_PUBLISHER_MODE = before; }
});

test('real pure publisher receives only server scope; allowed authorization emits nothing', async () => {
  const entries = [];
  const publisher = createAuthorizationObservationPublisher({ enabled: true, resource, write: async entry => entries.push(entry), eventId: () => 'server-event' });
  const authorize = adapter.createObservedAuthorization(publisher);
  assert.equal(await authorize(() => 'admin', profile), 'admin'); assert.equal(entries.length, 0);
  const original = denial(); await sameRejection(authorize(() => { throw original; }, profile), original);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].jsonPayload.context, { rootId: 'root', actorUid: 'actor' });
  assert.equal(entries[0].jsonPayload.event.origin, 'SERVER_AUTH_DECISION');
  assert.equal(entries[0].jsonPayload.event.eventType, 'AUTHORIZATION_DENIED');
  assert.doesNotMatch(JSON.stringify(entries), /original-denial|ACCOUNT_RESTRICTED|CONTACT_SUPPORT/);
});

test('missing, invalid root/actor and non-permission errors never emit or invent root', async () => {
  let calls = 0; const authorize = adapter.createObservedAuthorization({ authorizationDenied: async () => { calls++; } });
  for (const invalid of [{ ...profile, exists: false }, { ...profile, rootId: undefined }, { ...profile, rootId: '../root' }, { ...profile, uid: '' }]) {
    const original = denial(); await sameRejection(authorize(() => { throw original; }, invalid), original);
  }
  for (const original of [new Error('provider'), Object.assign(new Error('auth'), { code: 'unauthenticated' })]) await sameRejection(authorize(() => { throw original; }, profile), original);
  assert.equal(calls, 0);
});

test('throw, rejection and stuck observation preserve exact original error and bounded latency', async () => {
  for (const observe of [() => { throw Error('secret-provider'); }, async () => { throw Error('secret-provider'); }, () => new Promise(() => {})]) {
    const original = denial(), start = performance.now();
    await sameRejection(adapter.createObservedAuthorization({ authorizationDenied: observe }, 20)(() => { throw original; }, profile), original);
    assert.ok(performance.now() - start < 500);
  }
});

test('publisher exhaustion/concurrency never changes authorization or retries observation', async () => {
  let writes = 0;
  const publisher = createAuthorizationObservationPublisher({ enabled: true, resource, write: async () => { writes++; throw Error('provider'); } });
  const authorize = adapter.createObservedAuthorization(publisher);
  for (let i = 0; i < 10; i++) { const original = denial(); await sameRejection(authorize(() => { throw original; }, profile), original); }
  assert.equal(writes, 6);
});

function listHarness(authorize, authGuard, stored = { rootId: 'root', role: 'admin' }) {
  let queries = 0, reads = 0;
  const db = { doc: path => { assert.equal(path, 'users/actor'); return { get: async () => { reads++; return { exists: true, data: () => stored }; } }; },
    collection: name => { assert.equal(name, 'users'); queries++; const query = { where: () => query, orderBy: () => query, limit: () => query, get: async () => ({ docs: [] }) }; return query; } };
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; this.httpErrorCode = { status: 403 }; } }
  const { listUsers } = load('modules/users/list.ts', {
    'firebase-functions/v2/https': { onCall: (_options, handler) => handler, HttpsError },
    'firebase-admin/firestore': { getFirestore: () => db, FieldPath: { documentId: () => '__name__' } },
    '../../utils/authGuard': { assertAuthorized: authGuard },
    '../securityObservation/authorizationDenied': { authorizeListUsersObserved: authorize },
  });
  return { invoke: data => listUsers({ auth: { uid: 'actor' }, data }), counts: () => ({ queries, reads }) };
}
test('actual listUsers denial performs one profile read, zero queries and zero writes; request scope cannot replace profile', async () => {
  let context;
  const original = Object.assign(denial(), { httpErrorCode: { status: 403 } });
  const authorize = adapter.createObservedAuthorization({ authorizationDenied: async value => { context = value; } });
  const harness = listHarness(authorize, () => { throw original; });
  await sameRejection(harness.invoke({ rootId: 'victim', actorUid: 'victim', path: 'secret', event: {} }), original);
  assert.deepEqual(harness.counts(), { queries: 0, reads: 1 });
  assert.deepEqual(context, { actorUid: 'actor', rootId: 'root' });
  // Fake deliberately offers no write methods: accidental financial/restriction writes fail this test.
});
test('actual listUsers allowed response is preserved and observer never runs', async () => {
  let calls = 0;
  const harness = listHarness(adapter.createObservedAuthorization({ authorizationDenied: async () => { calls++; } }), () => 'admin');
  assert.deepEqual(await harness.invoke({}), { ok: true, users: [], hasMore: false, nextCursor: null });
  assert.equal(calls, 0); assert.deepEqual(harness.counts(), { reads: 1, queries: 1 });
});

const email = 'pay0-test-publisher@pay-0-system.iam.gserviceaccount.com';
const metadata = value => new Response(value, { headers: { 'Metadata-Flavor': 'Google' } });
function fakeFetch(calls, override) {
  return async (url, options) => {
    calls.push({ url, options });
    const special = await override?.(url, options); if (special) return special;
    if (url.endsWith('/email')) return metadata(email);
    if (url.endsWith('/project-id')) return metadata('pay-0-system');
    if (url.endsWith('/token')) return metadata(JSON.stringify({ token_type: 'Bearer', access_token: 'synthetic-token-never-output-12345', expires_in: 3600 }));
    assert.equal(url, 'https://logging.googleapis.com/v2/entries:write'); return new Response('{}');
  };
}
test('future writer uses pure publisher contract, exact identity, one bounded signal and no retries', async () => {
  const calls = [];
  const write = createObservationLoggingWriter({ expectedServiceAccount: email, fetchImpl: fakeFetch(calls) });
  const publisher = createAuthorizationObservationPublisher({ enabled: true, resource, write });
  assert.equal(await publisher.authorizationDenied({ rootId: 'root', actorUid: 'actor' }), 'ACCEPTED');
  assert.equal(calls.length, 4); assert.equal(new Set(calls.map(call => call.options.signal)).size, 1);
  assert.ok(calls.every(call => call.options.redirect === 'error'));
  assert.equal(calls[3].options.signal.aborted, true);
  assert.doesNotMatch(calls[3].options.body, /synthetic-token-never-output/);
});
test('wrong identity, oversized metadata, provider failure and deadline return fixed failure', async () => {
  for (const override of [
    async url => url.endsWith('/email') ? metadata('wrong') : undefined,
    async url => url.endsWith('/email') ? metadata('x'.repeat(257)) : undefined,
    async url => url.startsWith('https:') ? new Response('SECRET', { status: 403 }) : undefined,
    async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('SECRET')), { once: true })),
  ]) {
    const calls = [], writer = createObservationLoggingWriter({ expectedServiceAccount: email, fetchImpl: fakeFetch(calls, override), timeoutMs: 20 });
    let entry; await createAuthorizationObservationPublisher({ enabled: true, resource, write: async value => { entry = value; } }).authorizationDenied({ actorUid: 'actor', rootId: 'root' });
    await assert.rejects(writer(entry), { message: 'OBSERVATION_WRITE_FAILED' });
    assert.ok(calls.filter(call => call.url.startsWith('https:')).length <= 1);
  }
});

test('concurrent denials share publisher inflight ceiling and preserve both original errors', async () => {
  let release, writes = 0;
  const publisher = createAuthorizationObservationPublisher({ enabled: true, resource, write: () => { writes++; return new Promise(resolve => { release = resolve; }); } });
  const authorize = adapter.createObservedAuthorization(publisher, 100);
  const firstError = denial(), secondError = denial();
  const first = sameRejection(authorize(() => { throw firstError; }, profile), firstError);
  await new Promise(resolve => setImmediate(resolve));
  await sameRejection(authorize(() => { throw secondError; }, profile), secondError);
  assert.equal(writes, 1); release(); await first;
});
