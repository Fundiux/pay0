import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash, sign, constants } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSignedVerifier } from '../../services/pay0-sentinel-observation/src/signedVerifier.mjs';
import contract from '../../services/pay0-sentinel-observation/.build/core/signedContract.js';
import schema from '../../services/pay0-sentinel-observation/.build/core/schema.js';
import detectorModule from '../../services/pay0-sentinel-observation/.build/core/detector.js';
const { canonicalizeSignedTuple, decodeSignedPayload } = contract;
const NOW = 1791500000000, hash = b => createHash('sha256').update(b).digest('hex');
const resource = { projectId: 'pay-0-system', serviceName: 'listusers', revisionName: 'listusers-00001-test', location: 'us-central1' };
let checks = 0;
function rejects(fn) { assert.throws(fn); checks++; }
const pairs = [1, 2].map(() => generateKeyPairSync('rsa', { modulusLength: 3072, publicExponent: 65537 }));
const keyName = n => `projects/demo-observer/locations/us-central1/keyRings/observe/cryptoKeys/listusers/cryptoKeyVersions/${n}`;
const keys = pairs.map((pair, i) => ({ keyVersion: keyName(i + 1), algorithm: 'RSA_SIGN_PSS_3072_SHA256', status: 'ACTIVE', spkiPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(), spkiSha256: hash(pair.publicKey.export({ type: 'spki', format: 'der' })) }));
const manifest = { schemaVersion: 'PAY0-SIGNED-TRUST@1', producers: [{ publisherId: 'listusers-auth-v1', audience: 'pay0-observation-v1', projectId: 'pay-0-system', functionName: 'listUsers', serviceName: resource.serviceName, revisions: [resource.revisionName], roots: ['root-a'], actors: ['actor-a'], keys }] };
const tuple = n => ['PAY0-SECURITY-SIGNED@1', 'pay0-observation-v1', keyName(n), 'pay-0-system', 'listUsers', resource.serviceName, resource.revisionName, 'root-a', 'actor-a', '12345678-1234-4123-8123-123456789abc', 'AUTHORIZATION_DENIED', 'SERVER_AUTH_DECISION', NOW, NOW, NOW + 86400000];
function envelope(t = tuple(1), index = 0, options = {}) {
  const bytes = options.bytes || canonicalizeSignedTuple(t);
  return { schemaVersion: t[0], context: { rootId: t[7], actorUid: t[8] }, signedBytesB64: bytes.toString('base64'), signatureB64: sign('sha256', bytes, { key: pairs[index].privateKey, padding: options.padding ?? constants.RSA_PKCS1_PSS_PADDING, saltLength: options.saltLength ?? 32 }).toString('base64') };
}
const verifier = createSignedVerifier(manifest, () => NOW);
const good = envelope(); const decoded = verifier(good, resource);
assert.equal(decoded.ingress.publisherId, 'listusers-auth-v1'); assert.equal(decoded.event.eventType, 'AUTHORIZATION_DENIED'); checks += 2;
const empty = JSON.parse(readFileSync('services/pay0-sentinel-observation/src/trusted-producers.json', 'utf8'));
rejects(() => createSignedVerifier(empty, () => NOW)(good, resource));
for (const field of Object.keys(good)) { const bad = structuredClone(good); delete bad[field]; rejects(() => verifier(bad, resource)); }
for (const index of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
  const t = tuple(1); t[index] = typeof t[index] === 'number' ? t[index] + 1 : 'altered';
  const bad = structuredClone(good); bad.signedBytesB64 = Buffer.from(JSON.stringify(t)).toString('base64');
  rejects(() => verifier(bad, resource));
}
for (const field of ['projectId', 'serviceName', 'revisionName', 'location']) rejects(() => verifier(good, { ...resource, [field]: 'other' }));
for (const [index, value] of [[7, 'outside-root'], [8, 'outside-actor'], [6, 'listusers-00002-unreviewed'], [1, 'other-audience']]) { const t = tuple(1); t[index] = value; rejects(() => verifier(envelope(t), resource)); }
rejects(() => verifier(envelope(tuple(1), 1), resource));
rejects(() => verifier(envelope(tuple(1), 0, { saltLength: 20 }), resource));
rejects(() => verifier(envelope(tuple(1), 0, { padding: constants.RSA_PKCS1_PADDING }), resource));
rejects(() => verifier({ ...good, signatureB64: 'AA==' }, resource));
rejects(() => verifier({ ...good, signedBytesB64: good.signedBytesB64 + '=' }, resource));
rejects(() => verifier({ ...good, signedBytesB64: Buffer.alloc(4097).toString('base64') }, resource));
rejects(() => verifier({ ...good, signedBytesB64: Buffer.from([0xff]).toString('base64') }, resource));
rejects(() => verifier({ ...good, extra: true }, resource));
rejects(() => verifier({ ...good, context: { ...good.context, extra: true } }, resource));
rejects(() => verifier({ ...good, context: { ...good.context, actorUid: 'other' } }, resource));
for (const bytes of [Buffer.from(' ' + JSON.stringify(tuple(1))), Buffer.from(JSON.stringify(tuple(1)).replace('listUsers', '\\u006cistUsers'))]) rejects(() => verifier(envelope(tuple(1), 0, { bytes }), resource));
for (const t of [tuple(1).slice(1), [...tuple(1), 'extra'], Object.assign(tuple(1), { extra: 1 }), tuple(1).map((v, i) => i === 12 ? 1.5 : v)]) rejects(() => canonicalizeSignedTuple(t));
const sparse = tuple(1); delete sparse[2]; rejects(() => canonicalizeSignedTuple(sparse));
const getter = tuple(1); Object.defineProperty(getter, '2', { get() { throw Error('MUST_NOT_INVOKE'); } }); rejects(() => canonicalizeSignedTuple(getter));
const payloadGetter = { ...good }; Object.defineProperty(payloadGetter, 'signatureB64', { get() { throw Error('MUST_NOT_INVOKE'); } }); rejects(() => verifier(payloadGetter, resource));
rejects(() => createSignedVerifier(manifest, () => NOW + 86400000)(good, resource));
assert(createSignedVerifier(manifest, () => NOW + 86400000 - 1)(good, resource)); checks++;
rejects(() => createSignedVerifier(manifest, () => NOW - 60001)(good, resource));
assert(createSignedVerifier(manifest, () => NOW - 60000)(good, resource)); checks++;
for (const [index, value] of [[13, NOW - 1], [13, NOW + 60001], [14, NOW + 86400001], [12, Number.MAX_SAFE_INTEGER]]) { const t = tuple(1); t[index] = value; rejects(() => canonicalizeSignedTuple(t)); }
for (const change of [m => m.producers[0].keys[0].spkiSha256 = '0'.repeat(64), m => m.producers[0].keys[0].algorithm = 'none', m => m.producers[0].keys[0].spkiPem = pairs[0].privateKey.export({type:'pkcs8',format:'pem'}).toString(), m => m.producers[0].publisherId = 'sentinel-loop', m => m.producers.push(structuredClone(m.producers[0])), m => m.producers[0].roots.push('root-b')]) { const m = structuredClone(manifest); change(m); rejects(() => createSignedVerifier(m)); }
const small = generateKeyPairSync('rsa', { modulusLength: 2048 });
const badSize = structuredClone(manifest); badSize.producers[0].keys[0].spkiPem = small.publicKey.export({type:'spki',format:'pem'}).toString(); badSize.producers[0].keys[0].spkiSha256 = hash(small.publicKey.export({type:'spki',format:'der'})); rejects(() => createSignedVerifier(badSize));
const revoked = structuredClone(manifest); revoked.producers[0].keys[0].status = 'REVOKED'; rejects(() => createSignedVerifier(revoked, () => NOW)(good, resource));
const mutable = structuredClone(manifest); const snapVerifier = createSignedVerifier(mutable, () => NOW); mutable.producers[0].roots[0] = 'outside-root'; const outside = tuple(1); outside[7] = 'outside-root'; rejects(() => snapVerifier(envelope(outside), resource));
// Rotation affects transport, not ab30 semantic binding or publisher namespace.
const rotatedTuple = tuple(2); rotatedTuple[13] += 1;
const rotated = verifier(envelope(rotatedTuple, 1), resource);
const firstSanitized = schema.sanitizeSecurityEvent(decoded.event, decoded.ingress, NOW);
const secondSanitized = schema.sanitizeSecurityEvent(rotated.event, rotated.ingress, NOW);
assert.equal(schema.securityEventContentDigest(firstSanitized), schema.securityEventContentDigest(secondSanitized)); checks++;
const receipts = new Map(), quotas = new Map(), incidents = new Map();
const detector = new detectorModule.ObservationDetector({ transact: async (root, fn) => fn({ readReceipt: async k => receipts.get(root+k) || null, readQuota: async k => quotas.get(root+k) || null, readIncident: async k => incidents.get(root+k) || null, createReceipt: (k,v) => receipts.set(root+k,v), writeQuota: (k,v) => quotas.set(root+k,v), writeIncident: (k,v) => incidents.set(root+k,v) }) }, () => NOW);
assert.equal((await detector.ingest(decoded.event, decoded.ingress)).outcome, 'RECORDED');
const replay = await detector.ingest(rotated.event, rotated.ingress); assert.equal(replay.outcome, 'DUPLICATE'); assert.equal(replay.restricted, false); assert.equal(replay.decision, 'OBSERVE_ONLY'); checks += 4;
const conflictTuple = tuple(2); conflictTuple[12] -= 1; conflictTuple[14] -= 1; const conflict = verifier(envelope(conflictTuple,1),resource);
assert.equal((await detector.ingest(conflict.event, conflict.ingress)).outcome, 'EVENT_CONTENT_CONFLICT'); assert.equal(receipts.size, 1); assert.equal([...incidents.values()][0].authority, 'NONE'); checks += 3;
// Reviewed build manifest must cover the canonicalizer as well as all ab30 modules.
const base = 'services/pay0-sentinel-observation/';
const buildManifest = JSON.parse(readFileSync(base + 'core-manifest.json', 'utf8'));
for (const [name, expected] of Object.entries(buildManifest.files)) {
  assert.equal(hash(readFileSync('functions/src/modules/sentinel/' + name, 'utf8').replace(/\r\n/g, '\n')), expected); checks++;
}
assert.equal(hash(readFileSync('functions/src/modules/securityObservation/signedContract.ts', 'utf8').replace(/\r\n/g, '\n')), buildManifest.signedContractSha256); checks++;
assert(readFileSync(base + 'Dockerfile', 'utf8').includes('COPY functions/src/modules/securityObservation/signedContract.ts /app/functions/src/modules/securityObservation/signedContract.ts')); checks++;
for (const allowed of ['!functions/src/modules/securityObservation/signedContract.ts', '!services/pay0-sentinel-observation/src/trusted-producers.json']) { assert(readFileSync(base + 'Dockerfile.dockerignore', 'utf8').includes(allowed)); checks++; }
console.log(`SENTINEL_SIGNED_PASS checks=${checks} keys=ephemeral network=0 activation=0`);
