import { createPublicKey, createHash, verify, constants } from 'node:crypto';
import contract from '../.build/core/signedContract.js';
const { decodeSignedPayload, exactSignedObject, signedIdentifier } = contract;
const fail = () => { throw Error('INVALID_SIGNED_EVENT'); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
/** Pure verification capability. It cannot fetch keys, sign, or write evidence.
 * Empty trust manifest is intentionally valid and accepts no producer. */
export function createSignedVerifier(manifest, now = () => Date.now()) {
  exactSignedObject(manifest, ['schemaVersion', 'producers']);
  if (manifest.schemaVersion !== 'PAY0-SIGNED-TRUST@1' || !Array.isArray(manifest.producers) || manifest.producers.length > 8) fail();
  const keys = new Map(), publishers = new Set();
  for (const producer of manifest.producers) {
    exactSignedObject(producer, ['publisherId', 'audience', 'projectId', 'functionName', 'serviceName', 'revisions', 'roots', 'actors', 'keys']);
    if (!signedIdentifier(producer.publisherId) || /sentinel/i.test(producer.publisherId) || publishers.has(producer.publisherId) ||
        !signedIdentifier(producer.audience) || producer.projectId !== 'pay-0-system' || producer.functionName !== 'listUsers' || !signedIdentifier(producer.serviceName)) fail();
    publishers.add(producer.publisherId);
    for (const name of ['revisions', 'roots', 'actors']) {
      if (!Array.isArray(producer[name]) || !producer[name].length || producer[name].length > 100 ||
          !producer[name].every(signedIdentifier) || new Set(producer[name]).size !== producer[name].length) fail();
    }
    if (producer.roots.length !== 1 || !Array.isArray(producer.keys) || !producer.keys.length || producer.keys.length > 2) fail();
    for (const row of producer.keys) {
      exactSignedObject(row, ['keyVersion', 'algorithm', 'spkiPem', 'spkiSha256', 'status']);
      if (row.algorithm !== 'RSA_SIGN_PSS_3072_SHA256' || !['ACTIVE', 'REVOKED'].includes(row.status) ||
          typeof row.keyVersion !== 'string' || row.keyVersion.length > 512 ||
          !/^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/locations\/us-central1\/keyRings\/[A-Za-z0-9_-]{1,63}\/cryptoKeys\/[A-Za-z0-9_-]{1,63}\/cryptoKeyVersions\/[1-9][0-9]{0,9}$/.test(row.keyVersion) || keys.has(row.keyVersion) ||
          typeof row.spkiPem !== 'string' || row.spkiPem.length > 2048 || !/^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+\n-----END PUBLIC KEY-----\n?$/.test(row.spkiPem) ||
          typeof row.spkiSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.spkiSha256)) fail();
      let key;
      try { key = createPublicKey(row.spkiPem); } catch { fail(); }
      if (key.type !== 'public' || key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails?.modulusLength !== 3072 ||
          key.asymmetricKeyDetails?.publicExponent !== 65537n || hash(key.export({ type: 'spki', format: 'der' })) !== row.spkiSha256) fail();
      // Snapshot mutable configuration; callers cannot widen trust after creation.
      keys.set(row.keyVersion, { key, status: row.status, producer: structuredClone(producer) });
    }
  }
  return (payload, resource) => {
    const { tuple, bytes, signature } = decodeSignedPayload(payload, now());
    const trusted = keys.get(tuple[2]);
    if (!trusted || trusted.status !== 'ACTIVE') fail();
    const p = trusted.producer;
    exactSignedObject(resource, ['projectId', 'serviceName', 'revisionName', 'location']);
    if (tuple[1] !== p.audience || tuple[3] !== p.projectId || tuple[4] !== p.functionName || tuple[5] !== p.serviceName ||
        !p.revisions.includes(tuple[6]) || !p.roots.includes(tuple[7]) || !p.actors.includes(tuple[8]) ||
        resource.projectId !== tuple[3] || resource.serviceName !== tuple[5] || resource.revisionName !== tuple[6] || resource.location !== 'us-central1' ||
        !verify('sha256', bytes, { key: trusted.key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, signature)) fail();
    return {
      event: { schemaVersion: 'PAY0-SECURITY-EVENT@1', rootId: tuple[7], actorUid: tuple[8], eventId: tuple[9], eventType: tuple[10], origin: tuple[11], occurredAtMs: tuple[12] },
      ingress: { rootId: tuple[7], actorUid: tuple[8], publisherId: p.publisherId, source: 'SERVER' },
    };
  };
}
