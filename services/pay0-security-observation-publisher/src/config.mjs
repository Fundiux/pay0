import { createHash, randomUUID } from 'node:crypto';
export const CANARY = Object.freeze({ projectId: 'pay-0-system', serviceName: 'pay0-security-canary',
  email: 'pay0-observation-canary@pay-0-system.iam.gserviceaccount.com',
  rootId: 'canary-observation-root', actorUid: 'canary-observation-actor', publisherId: 'pay0-observation-canary-v1' });
export function loadConfig(env) {
  const mode = env.OBSERVATION_PUBLISHER_MODE || 'DISABLED';
  if (!['DISABLED', 'CANARY_DRY_RUN', 'CANARY'].includes(mode) || env.PAY0_SOURCE_PROJECT_ID !== CANARY.projectId ||
      env.K_SERVICE !== CANARY.serviceName || env.K_CONFIGURATION !== CANARY.serviceName ||
      typeof env.K_REVISION !== 'string' || !new RegExp(`^${CANARY.serviceName}-[a-z0-9-]{1,90}$`).test(env.K_REVISION) ||
      env.GOOGLE_APPLICATION_CREDENTIALS || env.FIRESTORE_EMULATOR_HOST) throw Error('INVALID_PUBLISHER_CONFIG');
  const epoch = env.CANARY_OCCURRED_AT_MS;
  const occurredAtMs = epoch === undefined || epoch === '' ? null : Number(epoch);
  if ((occurredAtMs !== null && (!/^[1-9][0-9]{12}$/.test(epoch) || !Number.isSafeInteger(occurredAtMs))) ||
      (mode !== 'DISABLED' && occurredAtMs === null)) throw Error('INVALID_CANARY_EPOCH');
  const port = Number(env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('INVALID_PUBLISHER_CONFIG');
  return Object.freeze({ mode, port, occurredAtMs, resource: { projectId: CANARY.projectId, serviceName: CANARY.serviceName,
    configurationName: CANARY.serviceName, revisionName: env.K_REVISION } });
}

/** Revision configuration, never caller data or process-start time, fixes the
 * semantic event. The pure publisher still uses a live clock for rate limits. */
export function createImmutableCanaryPublisher(config, createPublisher, write, now = Date.now) {
  const id = 'canary_' + createHash('sha256').update(`PAY0-CANARY@2:${config.resource.revisionName}:${config.occurredAtMs}`).digest('hex');
  return createPublisher({ enabled: config.mode !== 'DISABLED', resource: config.resource, now, eventId: () => id,
    write: async entry => {
      const clock = now();
      if (!Number.isSafeInteger(config.occurredAtMs) || !Number.isSafeInteger(clock) ||
          clock < config.occurredAtMs || clock + 3000 >= config.occurredAtMs + 3600000) throw Error('CANARY_WINDOW_CLOSED');
      // Delivery metadata may change; admitted event bytes never change for this
      // revision+epoch. Unique insertId prevents Logging dedup from hiding replay.
      await write({ ...entry, insertId: randomUUID(), jsonPayload: { ...entry.jsonPayload,
        event: { ...entry.jsonPayload.event, occurredAtMs: config.occurredAtMs } } });
    },
  });
}
