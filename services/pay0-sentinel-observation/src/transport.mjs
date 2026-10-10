import { parseStrictJson } from './strictJson.mjs';
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const keys = (value, allowed, required = allowed) => plain(value) && Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key));
const fixedError = () => { throw new Error('INVALID_ENVELOPE'); };
// Wrapped Pub/Sub push documents both JSON spellings, often together.
// Never silently prefer one if duplicate fields disagree.
function aliasedString(value, camel, snake) {
  const hasCamel = Object.hasOwn(value, camel), hasSnake = Object.hasOwn(value, snake);
  if ((!hasCamel && !hasSnake) || (hasCamel && typeof value[camel] !== 'string') ||
      (hasSnake && typeof value[snake] !== 'string') || (hasCamel && hasSnake && value[camel] !== value[snake])) fixedError();
  return hasCamel ? value[camel] : value[snake];
}

export function createOidcVerifier(authClient, config, now = () => Date.now()) {
  return async authorization => {
    if (typeof authorization !== 'string' || authorization.length > 8192 || !/^Bearer [A-Za-z0-9_.-]+$/.test(authorization)) throw new Error('UNAUTHENTICATED');
    const ticket = await authClient.verifyIdToken({ idToken: authorization.slice(7), audience: config.audience });
    const claims = ticket.getPayload();
    if (!claims || claims.aud !== config.audience || claims.email !== config.email || claims.email_verified !== true ||
        !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) ||
        !Number.isSafeInteger(claims.exp) || claims.exp * 1000 <= now() || !Number.isSafeInteger(claims.iat) || claims.iat * 1000 > now() + 60000) throw new Error('UNAUTHENTICATED');
  };
}

/** Only called after verified push identity. Log fields remain backend assertions,
 * not cryptographic proof of actor identity; allowlist bounds the canary scope. */
export function decodeEnvelope(body, config, now = () => Date.now()) {
  if (!keys(body, ['message', 'subscription', 'deliveryAttempt'], ['message', 'subscription']) || body.subscription !== config.subscription) fixedError();
  const m = body.message;
  if (!keys(m, ['data', 'messageId', 'message_id', 'publishTime', 'publish_time', 'attributes', 'orderingKey'], ['data'])) fixedError();
  const messageId = aliasedString(m, 'messageId', 'message_id');
  const publishTimeText = aliasedString(m, 'publishTime', 'publish_time');
  if (!/^\d{1,128}$/.test(messageId) || typeof m.data !== 'string' || m.data.length > Math.ceil(config.maxLogBytes / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(m.data)) fixedError();
  const publishTime = Date.parse(publishTimeText);
  if (!Number.isFinite(publishTime) || publishTime > now() + 60000 || publishTime < now() - 86400000) fixedError();
  const data = Buffer.from(m.data, 'base64');
  if (data.length > config.maxLogBytes || data.toString('base64') !== m.data) fixedError();
  const log = parseStrictJson(data, { maxBytes: config.maxLogBytes });
  if (!keys(log, ['logName', 'resource', 'timestamp', 'receiveTimestamp', 'insertId', 'severity', 'labels', 'jsonPayload', 'trace', 'spanId', 'traceSampled'], ['logName', 'resource', 'timestamp', 'jsonPayload']) ||
      !plain(log.resource) || log.resource.type !== 'cloud_run_revision' || !plain(log.resource.labels)) fixedError();
  const labels = log.resource.labels;
  const stamp = Date.parse(log.timestamp);
  if (!Number.isFinite(stamp) || stamp > now() + 60000 || stamp < now() - 86400000) fixedError();
  const payload = log.jsonPayload;
  if (!keys(payload, ['schemaVersion', 'context', 'event']) || payload.schemaVersion !== 'PAY0-SECURITY-ENVELOPE@1' ||
      !keys(payload.context, ['rootId', 'actorUid'])) fixedError();
  const origin = config.origins.find(row => row.logName === log.logName && row.projectId === labels.project_id && row.serviceName === labels.service_name && row.revisions.includes(labels.revision_name) && row.roots.includes(payload.context.rootId) && row.actors.includes(payload.context.actorUid));
  if (!origin || labels.location !== 'us-central1') fixedError();
  return { event: payload.event, ingress: { rootId: payload.context.rootId, actorUid: payload.context.actorUid, publisherId: origin.publisherId, source: 'SERVER' } };
}
