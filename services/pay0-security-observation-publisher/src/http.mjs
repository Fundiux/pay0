import { createServer } from 'node:http';
import { CANARY } from './config.mjs';
export function createCanaryServer(config, publisher) {
  const server = createServer({ maxHeaderSize: 8192 }, async (req, res) => {
    const reply = (status, code) => { if (!res.headersSent) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Connection: 'close' }); res.end(JSON.stringify({ code })); } };
    if (req.method === 'GET' && req.url === '/healthz') { reply(200, 'HEALTHY'); return; }
    if (req.method !== 'POST' || req.url !== '/canary') { reply(404, 'NOT_FOUND'); return; }
    if (req.headers.origin || req.headers['transfer-encoding'] || req.headers['content-encoding'] ||
        req.headers['content-length'] && req.headers['content-length'] !== '0') { reply(400, 'EMPTY_REQUEST_REQUIRED'); req.resume(); return; }
    const empty = await new Promise(resolve => {
      let settled = false; const finish = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
      const timer = setTimeout(() => finish(false), 250);
      req.on('data', () => finish(false)); req.on('end', () => finish(true)); req.on('error', () => finish(false)); req.on('aborted', () => finish(false));
    });
    if (!empty) { reply(400, 'EMPTY_REQUEST_REQUIRED'); req.resume(); return; }
    // No caller event, actor, root, URL, headers or error is passed to publisher.
    try {
      const result = await publisher.authorizationDenied({ rootId: CANARY.rootId, actorUid: CANARY.actorUid });
      if (result === 'ACCEPTED') reply(200, config.mode === 'CANARY_DRY_RUN' ? 'LOGGING_DRY_RUN_ACCEPTED' : 'LOGGING_ACCEPTED');
      else if (result === 'DISABLED') reply(503, 'PUBLISHER_DISABLED');
      else if (result === 'RATE_LIMITED') reply(429, 'CANARY_RATE_LIMITED');
      else reply(503, 'OBSERVATION_WRITE_FAILED');
    } catch { reply(503, 'OBSERVATION_WRITE_FAILED'); }
  });
  server.maxHeadersCount = 32; server.headersTimeout = 1000; server.requestTimeout = 4000;
  server.timeout = 4000; server.keepAliveTimeout = 1000; server.maxRequestsPerSocket = 1;
  return server;
}
