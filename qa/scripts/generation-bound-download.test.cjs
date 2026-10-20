const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ts = require('typescript');
const deps = createRequire(path.resolve('functions/package.json'));
const { Storage } = deps('@google-cloud/storage');
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
function load(file, dependencies) {
  const exports = {};
  const code = process.env.PAY0_GENERATION_JS_DIR
    ? fs.readFileSync(path.join(process.env.PAY0_GENERATION_JS_DIR, path.basename(file).replace(/\.ts$/, '.js')), 'utf8')
    : ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, Date, require: name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name];
  }});
  return exports;
}
const { signGenerationBoundDownload } = load('functions/src/modules/documents/generationBoundDownload.ts', {
  'firebase-functions/v2/https': { HttpsError },
});
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const storage = new Storage({ projectId: 'synthetic-project', credentials: {
  client_email: 'synthetic@synthetic-project.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
} });
// Real metadata serializer and V4 signer; no network/ADC/provider actions.
for (const protocol of ['node:http', 'node:https']) require(protocol).request = require(protocol).get = () => { throw Error('NETWORK_FORBIDDEN'); };
global.fetch = async () => { throw Error('NETWORK_FORBIDDEN'); };
const objectPath = 'roots/r/pagos/p/docs/file #?.pdf', generation = '9007199254740993';
function fixture() {
  const bucket = storage.bucket('synthetic-bucket');
  const state = { calls: [], signatures: 0, failure: null, metadata: { bucket: bucket.name, name: objectPath, generation } };
  bucket.request = (options, callback) => { state.calls.push(options.qs); callback(state.failure, state.metadata); };
  const originalFile = bucket.file.bind(bucket);
  bucket.file = (...args) => {
    assert.equal(args.length, 1, 'generation must never pass through File numeric coercion');
    const file = originalFile(...args), sign = file.getSignedUrl.bind(file);
    file.getSignedUrl = async options => { state.signatures++; return sign(options); };
    return file;
  };
  return { bucket, state };
}
function signatureValid(url) {
  const parsed = new URL(url), signature = parsed.searchParams.get('X-Goog-Signature');
  parsed.searchParams.delete('X-Goog-Signature');
  const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const query = [...parsed.searchParams].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${encode(k)}=${encode(v)}`).join('&');
  const canonical = ['GET', parsed.pathname, query, `host:${parsed.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const scope = parsed.searchParams.get('X-Goog-Credential').split('/').slice(1).join('/');
  const input = ['GOOG4-RSA-SHA256', parsed.searchParams.get('X-Goog-Date'), scope, crypto.createHash('sha256').update(canonical).digest('hex')].join('\n');
  return crypto.verify('sha256', Buffer.from(input), publicKey, Buffer.from(signature, 'hex'));
}
test('SDK and cryptographic V4 signature preserve exact generation above 2^53', async () => {
  const { bucket, state } = fixture();
  const url = await signGenerationBoundDownload(bucket, objectPath, generation);
  assert.equal(state.calls[0].generation, generation);
  assert.equal(new URL(url).searchParams.get('generation'), generation);
  assert.equal(new URL(url).searchParams.get('X-Goog-Expires'), '300');
  assert.equal(signatureValid(url), true);
  const tampered = new URL(url); tampered.searchParams.set('generation', '9007199254740992');
  assert.equal(signatureValid(tampered.href), false);
});
test('legacy pins one observed generation without fallback or metadata writes', async () => {
  const { bucket, state } = fixture();
  const url = await signGenerationBoundDownload(bucket, objectPath, null);
  assert.equal(state.calls.length, 1); assert.equal(state.calls[0].generation, undefined);
  assert.equal(new URL(url).searchParams.get('generation'), generation);
});
test('malformed declared identifiers are rejected before Storage access', async () => {
  for (const bad of [0, 9007199254740992, '', '0', '01', '-1', '1e10', '1.5', ' 123 ', '9'.repeat(21)]) {
    const { bucket, state } = fixture();
    await assert.rejects(signGenerationBoundDownload(bucket, objectPath, bad), error => error.code === 'failed-precondition');
    assert.equal(state.calls.length, 0); assert.equal(state.signatures, 0);
  }
});
test('wrong object, bucket, generation or malformed metadata never gets signed', async () => {
  for (const [field, value] of [['name', 'other'], ['bucket', 'other'], ['generation', '123'], ['generation', 9007199254740992]]) {
    const { bucket, state } = fixture(); state.metadata[field] = value;
    await assert.rejects(signGenerationBoundDownload(bucket, objectPath, generation), error => error.code === 'failed-precondition');
    assert.equal(state.signatures, 0);
  }
});
function coreFixture(bucket) {
  const rows = { 'users/u': { role: 'admin', rootId: 'r' }, 'uploads/doc': { rootId: 'r', pagoId: 'p', active: true, storagePath: objectPath, storageGeneration: generation }, 'pagos/p': { rootId: 'r', clientId: 'c' } };
  let signed = 0, selected;
  const api = load('functions/src/modules/documents/authorizedDownload.ts', {
    'firebase-admin': { apps: [{}], firestore: () => ({ doc: id => ({ get: async () => ({ exists: !!rows[id], data: () => rows[id] }) }) }), storage: () => ({ bucket: () => bucket }) },
    'firebase-functions/v2/https': { HttpsError, onCall: (_options, handler) => handler },
    '../../utils/authGuard': { normalizeRole: role => role, assertAuthorized: (_auth, user) => { if (user.blocked) throw new HttpsError('permission-denied', 'Denied'); } },
    '../clientDelegations/access': { requireClientOperationalAccess: async () => {} },
    '../financing/dispersionFunding': { assertDispersionFundingOwner: () => {} },
    './generationBoundDownload': { signGenerationBoundDownload },
  });
  const signer = async (_path, expected) => { signed++; selected = expected; return 'https://signed.invalid/fixture'; };
  return { rows, api, signer, stats: () => ({ signed, selected }) };
}
test('core derives generation from server upload, ignores caller override and keeps response contract', async () => {
  const f = coreFixture();
  const result = await f.api.getAuthorizedDocumentDownloadUrlCore({ auth: { uid: 'u' }, data: { uploadId: 'doc', storageGeneration: 'attacker' } }, f.signer);
  assert.equal(f.stats().selected, generation); assert.equal(result.expiresInSeconds, 300);
  assert.deepEqual(Object.keys(result).sort(), ['expiresInSeconds', 'ok', 'uploadId', 'url']);
});
test('core denies wrong root, parent, permissions and inactive documents before signing', async () => {
  for (const mutate of [f => { f.rows['uploads/doc'].rootId = 'foreign'; }, f => { f.rows['pagos/p'].rootId = 'foreign'; }, f => { f.rows['users/u'].blocked = true; }, f => { f.rows['uploads/doc'].active = false; }]) {
    const f = coreFixture(); mutate(f);
    await assert.rejects(f.api.getAuthorizedDocumentDownloadUrlCore({ auth: { uid: 'u' }, data: { uploadId: 'doc' } }, f.signer));
    assert.equal(f.stats().signed, 0);
  }
});
test('core keeps missing object classification and sanitizes unexpected SDK errors', async () => {
  const f = coreFixture();
  for (const [error, code] of [[Object.assign(Error('private'), { code: 404 }), 'not-found'], [Error('private'), 'internal']]) {
    await assert.rejects(f.api.getAuthorizedDocumentDownloadUrlCore({ auth: { uid: 'u' }, data: { uploadId: 'doc' } }, async () => { throw error; }), caught => caught.code === code && !caught.message.includes('private'));
  }
});
test('real default core signer issues a generation-bound URL after authorization', async () => {
  const { bucket, state } = fixture();
  const f = coreFixture(bucket);
  const result = await f.api.getAuthorizedDocumentDownloadUrlCore({ auth: { uid: 'u' }, data: { uploadId: 'doc' } });
  assert.equal(state.calls[0].generation, generation);
  assert.equal(signatureValid(result.url), true);
  assert.equal(result.expiresInSeconds, 300);
});
test('real default core signer preserves missing-generation 404 without falling back to latest', async () => {
  const { bucket, state } = fixture(); state.failure = Object.assign(Error('private-storage-message'), { code: 404 });
  const f = coreFixture(bucket);
  await assert.rejects(f.api.getAuthorizedDocumentDownloadUrlCore({ auth: { uid: 'u' }, data: { uploadId: 'doc' } }), error => error.code === 'not-found' && !error.message.includes('private-storage-message'));
  assert.equal(state.calls.length, 1); assert.equal(state.signatures, 0);
});
