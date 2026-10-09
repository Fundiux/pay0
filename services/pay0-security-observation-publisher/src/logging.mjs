import { CANARY } from './config.mjs';
const METADATA = 'http://metadata.google.internal/computeMetadata/v1/';
const fail = () => { throw Error('OBSERVATION_WRITE_FAILED'); };
async function boundedText(response, max) {
  if (!response.ok || !response.body) { await response.body?.cancel(); fail(); }
  const reader = response.body.getReader(); const chunks = []; let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength; if (total > max) fail(); chunks.push(Buffer.from(value));
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total));
  } finally { await reader.cancel().catch(() => {}); }
}
/** One shared 3s signal for identity, token and write. No retry; an interrupted
 * request may already have been accepted by Logging. No token/error body logs. */
export function createLoggingWriter(config, { fetchImpl = fetch } = {}) {
  return async entry => {
    const controller = new AbortController(), signal = controller.signal;
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      async function metadata(path, max) {
        const response = await fetchImpl(METADATA + path, { headers: { 'Metadata-Flavor': 'Google' }, redirect: 'error', signal });
        if (response.headers.get('metadata-flavor') !== 'Google') { await response.body?.cancel(); fail(); }
        return boundedText(response, max);
      }
      const [email, projectId] = await Promise.all([
        metadata('instance/service-accounts/default/email', 256), metadata('project/project-id', 128),
      ]);
      if (email !== CANARY.email || projectId !== CANARY.projectId) fail();
      const credentials = JSON.parse(await metadata('instance/service-accounts/default/token', 8192));
      if (credentials.token_type !== 'Bearer' || typeof credentials.access_token !== 'string' ||
          !/^[A-Za-z0-9._~+\/-]{20,4096}={0,2}$/.test(credentials.access_token) ||
          !Number.isFinite(credentials.expires_in) || credentials.expires_in < 30) fail();
      const body = JSON.stringify({ entries: [entry], partialSuccess: false, dryRun: config.mode === 'CANARY_DRY_RUN' });
      if (Buffer.byteLength(body) > 8192) fail();
      const response = await fetchImpl('https://logging.googleapis.com/v2/entries:write', {
        method: 'POST', redirect: 'error', signal,
        headers: { Authorization: `Bearer ${credentials.access_token}`, 'Content-Type': 'application/json' }, body,
      });
      await response.body?.cancel();
      if (!response.ok) fail();
    } catch { throw Error('OBSERVATION_WRITE_FAILED'); }
    finally { clearTimeout(timer); controller.abort(); }
  };
}
