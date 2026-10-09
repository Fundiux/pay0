#!/usr/bin/env node
'use strict';
// Explicit anonymous transport/authentication probe. No financial inputs, credentials or retries.
const fs = require('node:fs');
const path = require('node:path');
const NEW_CALLABLES = Object.freeze([
  'activateCorporateResourceVersion', 'cancelUserCommissionDispersion', 'configureUserCommissionEntitlement',
  'executeUserCommissionDispersion', 'finalizeCorporateResourceUpload', 'generateSolicitudReceiptCertificate',
  'getCommissionAutomationConfig', 'getCorporateResource', 'getCorporateResourceDownloadUrl', 'getMyCommissionSettings',
  'importCorporateResource', 'initCorporateResourceUpload', 'listCorporateResources', 'prepareCorporateResourceMigration',
  'previewMyCommissionDestinations', 'previewUserCommissionWithdrawal', 'requestUserCommissionDispersion',
  'restoreCorporateResourceVersion', 'retireCorporateResourceVersion', 'reviewCorporateResourceVersion',
  'runDailyUserCommissionPreflight', 'saveCommissionAutomationConfig', 'saveMyCommissionDestinations',
]);
const REFERENCES = Object.freeze(['setMyUsername', 'getMaterialityOperation', 'loginWithUsername']);
const TARGETS = Object.freeze([...NEW_CALLABLES, ...REFERENCES]);

async function inspect(name, fetchImpl = fetch) {
  if (!TARGETS.includes(name)) throw Error('UNREVIEWED_ENDPOINT');
  try {
    const response = await fetchImpl(`https://us-central1-pay-0-system.cloudfunctions.net/${name}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"data":{}}',
      credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    const json = /^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '');
    let code = null;
    if (json) {
      const reader = response.body?.getReader();
      const chunks = []; let size = 0;
      if (reader) {
        while (true) {
          const next = await reader.read(); if (next.done) break;
          size += next.value.byteLength;
          if (size > 16384) { await reader.cancel(); throw Error('RESPONSE_TOO_LARGE'); }
          chunks.push(Buffer.from(next.value));
        }
      }
      try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))?.error?.status;
        if (['UNAUTHENTICATED', 'INVALID_ARGUMENT', 'PERMISSION_DENIED'].includes(value)) code = value;
      } catch { /* Malformed JSON is a failed gate; never log response content. */ }
    } else await response.body?.cancel();
    const ok = response.status === 401 && code === 'UNAUTHENTICATED' ||
      name === 'loginWithUsername' && response.status === 400 && code === 'INVALID_ARGUMENT';
    return { name, ok, httpStatus: response.status, json, code };
  } catch { return { name, ok: false, failure: 'TRANSPORT_OR_RESPONSE_FAILURE' }; }
}

async function selfTest() {
  const assert = require('node:assert/strict');
  let calls = 0;
  const mock = (status, type, body) => async (url, options) => {
    calls++; assert.match(url, /^https:\/\/us-central1-pay-0-system\.cloudfunctions\.net\/[A-Za-z]+$/);
    assert.deepEqual(options.headers, { 'Content-Type': 'application/json' });
    assert.equal(options.body, '{"data":{}}'); assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    return new Response(body, { status, headers: { 'content-type': type } });
  };
  assert.equal(NEW_CALLABLES.length, 23); assert.equal(new Set(TARGETS).size, 26);
  assert.equal(TARGETS.includes('prepareDailyUserCommissions'), false);
  assert.equal((await inspect(TARGETS[0], mock(401, 'application/json; charset=utf-8', '{"error":{"status":"UNAUTHENTICATED"}}'))).ok, true);
  assert.equal((await inspect(TARGETS[0], mock(403, 'text/html', '<html>Forbidden</html>'))).ok, false);
  assert.equal((await inspect(TARGETS[0], mock(200, 'application/json', '{"result":{}}'))).ok, false);
  assert.equal((await inspect(TARGETS[0], mock(401, 'application/json', '{invalid'))).ok, false);
  assert.equal((await inspect('loginWithUsername', mock(400, 'application/json', '{"error":{"status":"INVALID_ARGUMENT"}}'))).ok, true);
  assert.equal((await inspect(TARGETS[0], mock(400, 'application/json', '{"error":{"status":"INVALID_ARGUMENT"}}'))).ok, false);
  await assert.rejects(() => inspect('prepareDailyUserCommissions', mock(200, 'application/json', '{}')), /UNREVIEWED_ENDPOINT/);
  assert.equal(calls, 6);
  console.log(JSON.stringify({ ok: true, selfTest: true, scenarios: 7, networkRequests: 0 }));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--self-test') return selfTest();
  if (args.length !== 3 || args[0] !== '--run' || args[1] !== '--project' || args[2] !== 'pay-0-system')
    throw Error('USE: node scripts/verify-astra-callable-access.cjs --run --project pay-0-system (or --self-test)');
  const results = [];
  for (let offset = 0; offset < TARGETS.length; offset += 2) results.push(...await Promise.all(TARGETS.slice(offset, offset + 2).map(name => inspect(name))));
  const report = { capturedAt: new Date().toISOString(), project: 'pay-0-system', anonymous: true, body: 'data:{}',
    credentialsSent: false, financialInputsSent: false, retries: 0, expected: TARGETS.length,
    passed: results.filter(row => row.ok).length, failed: results.filter(row => !row.ok).length, results,
    limitation: 'Verifies public callable transport and anonymous rejection only; not authenticated UI or financial behavior.' };
  const dir = path.resolve(__dirname, '../__untracked_archive/astra-callable-access'); fs.mkdirSync(dir, { recursive: true });
  const output = path.join(dir, report.capturedAt.replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, passed: report.passed, failed: report.failed, failures: results.filter(row => !row.ok) }));
  if (report.failed) process.exitCode = 1;
}
module.exports = { NEW_CALLABLES, REFERENCES, inspect };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
