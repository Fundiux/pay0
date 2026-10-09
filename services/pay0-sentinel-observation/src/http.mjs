import { createServer } from 'node:http';
import { decodeEnvelope } from './transport.mjs';

async function readBody(req, maximum) {
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw new Error('INVALID_BODY');
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')) throw new Error('INVALID_BODY');
  const declared = req.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw new Error('INVALID_BODY');
  return new Promise((resolve, reject) => {
    let size = 0; let settled = false; const chunks = [];
    const fail = () => { if (!settled) { settled = true; reject(new Error('INVALID_BODY')); } };
    req.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > maximum) { req.pause(); fail(); return; }
      chunks.push(chunk);
    });
    req.once('aborted', fail);
    req.once('error', fail);
    req.once('end', () => {
      if (settled) return;
      try { const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); settled = true; resolve(body); }
      catch { fail(); }
    });
  });
}

export function createObservationServer({ config, verify, detector, metric = () => {}, now = () => Date.now() }) {
  let inFlight = 0;
  let windowStart = now();
  let attempts = 0;
  const server = createServer({ maxHeaderSize: 16384, requestTimeout: 8000, headersTimeout: 8000 }, async (req, res) => {
    const reply = (status, code) => {
      metric(code);
      if (!res.destroyed) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'connection': 'close' }); res.end(JSON.stringify({ outcome: code, decision: 'OBSERVE_ONLY', restricted: false })); }
    };
    if (req.method === 'GET' && req.url === '/healthz') return reply(200, 'HEALTHY');
    if (req.method !== 'POST' || req.url !== '/pubsub') return reply(404, 'NOT_FOUND');
    // Local load shed protects CPU/store; not a cross-instance financial cap.
    if (now() - windowStart >= 60000) { windowStart = now(); attempts = 0; }
    if (inFlight >= 4 || ++attempts > 120) return reply(503, 'BUSY');
    inFlight++;
    let expired = false;
    const timer = setTimeout(() => { expired = true; reply(503, 'TIMEOUT'); }, 7000);
    try {
      try { await verify(req.headers.authorization); } catch { if (!expired) reply(401, 'UNAUTHENTICATED'); return; }
      if (expired) return;
      let decoded;
      try { decoded = decodeEnvelope(await readBody(req, config.maxEnvelopeBytes), config, now); }
      catch { if (!expired) reply(204, 'INVALID_ENVELOPE'); return; }
      if (expired) return;
      const result = await detector.ingest(decoded.event, decoded.ingress);
      if (!expired) reply(['STORE_UNAVAILABLE', 'CIRCUIT_OPEN'].includes(result.outcome) ? 503 : 200, result.outcome);
    } catch { if (!expired) reply(503, 'UNAVAILABLE'); }
    finally { clearTimeout(timer); inFlight--; }
  });
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  return server;
}
