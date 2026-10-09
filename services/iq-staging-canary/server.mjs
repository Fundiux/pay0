import { createServer } from 'node:http';
import { fetchIqExternal } from './externalActionsPolicy.mjs';

const project = 'pay-0-system-staging';
function validateEnvironment() {
  if (process.versions.node.split('.')[0] !== '22' || process.env.GCLOUD_PROJECT !== project ||
      process.env.PAY0_ENVIRONMENT !== 'staging' || !['disabled', 'simulated'].includes(process.env.PAY0_EXTERNAL_ACTIONS_MODE) ||
      ['GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT'].some(key => process.env[key] && process.env[key] !== project) || process.env.FIREBASE_CONFIG)
    throw Error('STAGING_RUNTIME_CONFIGURATION_REQUIRED');
}
validateEnvironment();
let transportAttempts = 0;
Object.defineProperty(globalThis, 'fetch', { configurable: false, writable: false, value: async () => {
  transportAttempts++;
  throw Error('STAGING_RUNTIME_NETWORK_BLOCKED');
} });
const families = ['login', 'client', 'deposit', 'application', 'dispersion', 'rep'];
async function smoke() {
  validateEnvironment();
  let blocked = 0;
  for (const family of families) for (const method of ['GET', 'POST']) {
    try {
      await fetchIqExternal(`https://iq.invalid/${family}`, { method });
      throw Error('STAGING_EXTERNAL_GUARD_FAILED');
    } catch (error) {
      if (error.message !== 'EXTERNAL_ACTIONS_DISABLED') throw Error('STAGING_EXTERNAL_GUARD_FAILED');
      blocked++;
    }
  }
  if (blocked !== 12 || transportAttempts !== 0) throw Error('STAGING_EXTERNAL_GUARD_FAILED');
  return { ok: true, project, mode: process.env.PAY0_EXTERNAL_ACTIONS_MODE, scope: 'external-action-guard-only', checks: 12,
    blocked, transportAttempts, families, financialEndToEnd: false };
}
await smoke();
const port = Number(process.env.PORT || 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('INVALID_PORT');
const server = createServer(async (request, response) => {
  const reply = (status, payload) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(payload));
  };
  if (Number(request.headers['content-length'] || 0) !== 0 || request.headers['transfer-encoding']) {
    request.resume(); reply(400, { ok: false, reason: 'REQUEST_BODY_NOT_SUPPORTED' }); return;
  }
  try {
    if (request.method === 'GET' && request.url === '/healthz') {
      validateEnvironment(); reply(200, { ok: true, project, transportAttempts, financialEndToEnd: false });
    } else if (request.method === 'POST' && request.url === '/smoke') reply(200, await smoke());
    else reply(404, { ok: false, reason: 'NOT_FOUND' });
  } catch { reply(503, { ok: false, reason: 'STAGING_GUARD_UNAVAILABLE' }); }
});
server.requestTimeout = 5000;
server.headersTimeout = 5000;
server.listen(port, process.env.K_SERVICE ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'staging-runtime-ready', project, port, transportAttempts, financialEndToEnd: false }));
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
