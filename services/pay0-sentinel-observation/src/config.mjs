const id = /^[A-Za-z0-9_-]{1,128}$/;
const project = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
export function loadConfig(env) {
  const projectId = env.OBSERVATION_PROJECT_ID;
  if (!project.test(projectId || '') || projectId === 'pay-0-system' || env.OBSERVATION_DATABASE_ID !== 'sentinel-observation') throw new Error('ISOLATION_CONFIG_REQUIRED');
  const email = env.PUSH_SERVICE_ACCOUNT;
  if (email !== `pay0-sentinel-push@${projectId}.iam.gserviceaccount.com`) throw new Error('INVALID_PUSH_IDENTITY');
  const audience = env.PUSH_AUDIENCE;
  if (!/^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)?\.run\.app$/.test(audience || '')) throw new Error('INVALID_AUDIENCE');
  const subscription = `projects/${projectId}/subscriptions/pay0-security-observe-v1`;
  let origins;
  try { origins = JSON.parse(env.ALLOWED_ORIGINS_JSON); } catch { throw new Error('INVALID_ORIGIN_CONFIG'); }
  if (!Array.isArray(origins) || !origins.length || origins.length > 8) throw new Error('INVALID_ORIGIN_CONFIG');
  for (const row of origins) {
    if (!row || Object.keys(row).sort().join(',') !== 'actors,logName,projectId,publisherId,revisions,roots,serviceName' ||
        row.projectId !== 'pay-0-system' || typeof row.publisherId !== 'string' || !id.test(row.publisherId) || /sentinel/i.test(row.publisherId) || typeof row.serviceName !== 'string' || !id.test(row.serviceName) ||
        row.logName !== 'projects/pay-0-system/logs/pay0_security_observation' ||
        !['revisions', 'roots', 'actors'].every(key => Array.isArray(row[key]) && row[key].length > 0 && row[key].length <= 100 && row[key].every(value => typeof value === 'string' && id.test(value))) || row.roots.length !== 1) {
      throw new Error('INVALID_ORIGIN_CONFIG');
    }
  }
  const port = Number(env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT');
  return Object.freeze({ projectId, databaseId: 'sentinel-observation', email, audience, subscription, origins, port,
    globalPerMinute: 60, globalPerDay: 10000, maxEnvelopeBytes: 16384, maxLogBytes: 8192 });
}
