import { createRequire } from 'node:module';
import { Firestore, Timestamp } from '@google-cloud/firestore';
import { OAuth2Client } from 'google-auth-library';
import { loadConfig } from './config.mjs';
import { createOidcVerifier } from './transport.mjs';
import { FirestoreIncidentPersistence, GlobalAdmissionStore } from './persistence.mjs';
import { createObservationServer } from './http.mjs';
const require = createRequire(import.meta.url);
const { ObservationDetector } = require('../.build/core/detector.js');
const { NamespacedObservationStore } = require('../.build/core/transactionalStore.js');
try {
  const config = loadConfig(process.env);
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIRESTORE_EMULATOR_HOST) throw new Error('AMBIENT_CREDENTIAL_OVERRIDE_FORBIDDEN');
  const identityResponse = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email', {
    headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3000),
  });
  if (!identityResponse.ok || identityResponse.headers.get('metadata-flavor') !== 'Google' ||
      (await identityResponse.text()).trim() !== `pay0-sentinel-observer@${config.projectId}.iam.gserviceaccount.com`) throw new Error('RUNTIME_IDENTITY_MISMATCH');
  const db = new Firestore({ projectId: config.projectId, databaseId: config.databaseId });
  const persistence = new FirestoreIncidentPersistence(db, value => Timestamp.fromMillis(value), config);
  const detector = new ObservationDetector(new GlobalAdmissionStore(new NamespacedObservationStore(persistence)));
  const counters = new Map();
  // One aggregate fixed-code log/minute, never individual event/body/identity.
  const interval = setInterval(() => {
    if (counters.size) { console.log(JSON.stringify({ component: 'sentinel_observation_metrics', counts: Object.fromEntries(counters) })); counters.clear(); }
  }, 60000).unref();
  const server = createObservationServer({ config, verify: createOidcVerifier(new OAuth2Client(), config), detector,
    metric: code => counters.set(code, (counters.get(code) || 0) + 1) });
  server.listen(config.port, '0.0.0.0');
  process.on('SIGTERM', () => { clearInterval(interval); server.close(() => db.terminate().catch(() => {}).finally(() => process.exit(0))); setTimeout(() => process.exit(0), 8000).unref(); });
} catch { console.error('SENTINEL_STARTUP_FAILED'); process.exitCode = 1; }
