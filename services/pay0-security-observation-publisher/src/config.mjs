export const CANARY = Object.freeze({ projectId: 'pay-0-system', serviceName: 'pay0-security-canary',
  email: 'pay0-observation-canary@pay-0-system.iam.gserviceaccount.com',
  rootId: 'canary-observation-root', actorUid: 'canary-observation-actor', publisherId: 'pay0-observation-canary-v1' });
export function loadConfig(env) {
  const mode = env.OBSERVATION_PUBLISHER_MODE || 'DISABLED';
  if (!['DISABLED', 'CANARY_DRY_RUN', 'CANARY'].includes(mode) || env.PAY0_SOURCE_PROJECT_ID !== CANARY.projectId ||
      env.K_SERVICE !== CANARY.serviceName || env.K_CONFIGURATION !== CANARY.serviceName ||
      typeof env.K_REVISION !== 'string' || !new RegExp(`^${CANARY.serviceName}-[a-z0-9-]{1,90}$`).test(env.K_REVISION) ||
      env.GOOGLE_APPLICATION_CREDENTIALS || env.FIRESTORE_EMULATOR_HOST) throw Error('INVALID_PUBLISHER_CONFIG');
  const port = Number(env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('INVALID_PUBLISHER_CONFIG');
  return Object.freeze({ mode, port, resource: { projectId: CANARY.projectId, serviceName: CANARY.serviceName,
    configurationName: CANARY.serviceName, revisionName: env.K_REVISION } });
}
