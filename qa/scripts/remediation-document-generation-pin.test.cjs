// Real Storage SDK metadata serialization and V4 signer; ephemeral synthetic RSA only.
// No ADC, IAM, production reads, network, or private-key/URL output.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const ts = require('typescript');
const root = path.resolve(process.argv[2] || '.');
const sdkRequire = createRequire(path.join(process.env.PAY0_FUNCTIONS_DEPS_ROOT || root, 'functions/package.json'));
const { Storage } = sdkRequire('@google-cloud/storage');
for (const protocol of ['node:http', 'node:https']) {
  const mod = require(protocol);
  mod.request = mod.get = () => { throw Error('NETWORK_FORBIDDEN'); };
}
global.fetch = async () => { throw Error('NETWORK_FORBIDDEN'); };
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const storage = new Storage({ projectId: 'synthetic-project', credentials: {
  client_email: 'synthetic@synthetic-project.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
} });
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const storagePath = 'roots/root/pagos/payment/docs/PDF/file.pdf';
const declared = '9007199254740993';
let current, calls, metadata, metadataFailure, hook, signatureCalls;
const bucket = storage.bucket('synthetic-bucket');
// Intercept the SDK's actual metadata transport after query serialization setup.
bucket.request = (options, callback) => {
  calls.push({ ...options.qs });
  if (hook) hook();
  callback(metadataFailure, metadata);
};
const originalFile = bucket.file.bind(bucket);
bucket.file = (...args) => {
  assert.equal(args.length, 1, 'never create File with numeric generation coercion');
  const file = originalFile(...args);
  const originalSign = file.getSignedUrl.bind(file);
  file.getSignedUrl = async options => { signatureCalls++; return originalSign(options); };
  return file;
};
const code = ts.transpileModule(fs.readFileSync(path.join(root,
  'functions/src/modules/documents/authorizedDownload.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const api = {};
new Function('exports', 'require', code)(api, name => {
  if (name === 'firebase-admin') return { apps: [{}], storage: () => ({ bucket: () => bucket }) };
  if (name === 'firebase-functions/v2/https') return { HttpsError, onCall: (_options, fn) => fn };
  if (name === './downloadAccess') return { resolveAuthorizedDocumentObject: async () => {
    if (current.denied) throw new HttpsError('permission-denied', 'denied');
    return { ...current };
  } };
  throw Error('UNEXPECTED_DEPENDENCY');
});
function reset(expectedGeneration = declared) {
  current = { storagePath, revision: 'r1', expectedGeneration };
  metadata = { name: storagePath, bucket: bucket.name, generation: declared };
  calls = []; metadataFailure = null; hook = null; signatureCalls = 0;
}
const call = () => api.getAuthorizedDocumentDownloadUrlCore({ auth: { uid: 'synthetic' }, data: { uploadId: 'document' } });
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
function verifies(url) {
  const parsed = new URL(url);
  const signature = parsed.searchParams.get('X-Goog-Signature');
  parsed.searchParams.delete('X-Goog-Signature');
  const query = [...parsed.searchParams].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => encode(k) + '=' + encode(v)).join('&');
  const canonical = ['GET', parsed.pathname, query, 'host:' + parsed.host + '\n', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const scope = parsed.searchParams.get('X-Goog-Credential').split('/').slice(1).join('/');
  const input = ['GOOG4-RSA-SHA256', parsed.searchParams.get('X-Goog-Date'), scope,
    crypto.createHash('sha256').update(canonical).digest('hex')].join('\n');
  return crypto.verify('sha256', Buffer.from(input), publicKey, Buffer.from(signature, 'hex'));
}
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
test('exact >2^53 metadata query and generation cryptographically bound by real V4 signer', async () => {
  reset(); const result = await call(); const url = new URL(result.url);
  assert.deepEqual(calls, [{ generation: declared }]);
  assert.equal(url.searchParams.get('generation'), declared);
  assert.equal(url.searchParams.get('X-Goog-Expires'), '300');
  assert.deepEqual(Object.keys(result).sort(), ['expiresInSeconds', 'ok', 'uploadId', 'url']);
  assert.equal(result.expiresInSeconds, 300); assert.equal(result.ok, true); assert.equal(result.uploadId, 'document');
  assert.equal(verifies(result.url), true);
  url.searchParams.set('generation', '9007199254740992'); assert.equal(verifies(url.href), false);
  url.searchParams.delete('generation'); assert.equal(verifies(url.href), false);
});
test('legacy observes latest once and pins without backfill', async () => {
  reset(null); const result = await call(); assert.deepEqual(calls, [{}]);
  assert.equal(new URL(result.url).searchParams.get('generation'), declared);
  assert.equal(current.expectedGeneration, null); assert.equal(verifies(result.url), true);
});
test('declared retained generation remains selected instead of latest', async () => {
  reset('123'); metadata.generation = '123'; const result = await call();
  assert.deepEqual(calls, [{ generation: '123' }]); assert.equal(new URL(result.url).searchParams.get('generation'), '123');
});
test('missing declared generation returns not-found with no fallback', async () => {
  reset(); metadataFailure = { code: 404 };
  await assert.rejects(call(), e => e.code === 'not-found'); assert.equal(calls.length, 1); assert.equal(signatureCalls, 0);
});
for (const [field, value] of [['name', 'other'], ['bucket', 'other'], ['generation', '123'],
  ['generation', 9007199254740992], ['generation', ''], ['generation', '01']]) {
  test('metadata mismatch or malformed field ' + field + '/' + typeof value, async () => {
    reset(); metadata[field] = value; await assert.rejects(call(), e => e.code === 'failed-precondition');
    assert.equal(signatureCalls, 0);
  });
}
for (const invalid of ['0', '01', '-1', '1e15', '1.5', ' 123 ', '9'.repeat(21)]) {
  test('malformed declared generation rejected before metadata ' + invalid.length, async () => {
    reset(invalid); await assert.rejects(call(), e => e.code === 'failed-precondition');
    assert.equal(calls.length, 0); assert.equal(signatureCalls, 0);
  });
}
for (const change of ['denied', 'revision', 'storagePath', 'expectedGeneration']) {
  test('current authority/object rechecked after metadata ' + change, async () => {
    reset(); hook = () => { current[change] = change === 'denied' ? true : 'changed'; };
    await assert.rejects(call(), e => ['permission-denied', 'failed-precondition'].includes(e.code));
    assert.equal(signatureCalls, 0);
  });
}
test('unexpected Storage error is sanitized', async () => {
  reset(); metadataFailure = Error('PRIVATE_DIAGNOSTIC');
  await assert.rejects(call(), e => e.code === 'internal' && !e.message.includes('PRIVATE_DIAGNOSTIC'));
  assert.equal(signatureCalls, 0);
});
(async () => {
  let failed = 0;
  for (const [name, run] of tests) {
    try { await run(); console.log('PASS ' + name); }
    catch { failed++; console.log('FAIL ' + name); }
  }
  console.log(JSON.stringify({ tests: tests.length, passed: tests.length - failed, failed, externalActions: 0 }));
  if (failed) process.exitCode = 1;
})().catch(() => { console.error('HARNESS_FAILURE'); process.exitCode = 1; });
