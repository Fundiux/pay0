// Exercise the actual TypeScript HTTP adapter with an in-memory provider only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const directory = path.resolve(__dirname, '../../functions/src/modules/iq');
const allow = new Set(['dispersionHttpCreateCore', 'commissionInstrumentBinding', 'iqDateTime', 'iqHttpClient', 'externalActionsPolicy']);
let scenario, calls, posts, posted, checks = 0;
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
async function fakeFetch(input, init = {}) {
  const url = new URL(input);
  assert.equal(url.origin, 'https://synthetic-iq.invalid', 'Only synthetic requests may reach the stub');
  calls++;
  if (url.pathname === '/users/sessions' && init.method === 'POST') return response({ access_token: 'synthetic-memory-token' }, 201);
  if (url.pathname === '/dispersions/new' && init.method === 'GET') {
    if (!url.search) return response({ partners: [{ id: scenario.partnerId || 101, name: 'Synthetic partner' }] });
    if (!url.searchParams.has('beneficiary_id')) return response({ beneficiaries: [{ id: scenario.beneficiaryId || 103, name: 'Synthetic beneficiary' }] });
    return response({ clients: [{ id: 102, name: 'Synthetic client' }],
      beneficiary_accounts: [{ id: scenario.accountId || 104, account: '00001234' }],
      sale_percentages: [{ id: 301, base_percentage: 2, sale_percentage: 2, name: '2%' }],
    });
  }
  if (url.pathname === '/dispersions' && init.method === 'POST') {
    posts++; posted = Object.fromEntries(init.body.entries());
    return response({ message: 'success' }, 201);
  }
  if (url.pathname === '/dispersions' && init.method === 'GET') return response([{ id: 401, created_at: new Date().toISOString(), total_to_disperse: 100,
    currency: 'MXN', client: 'Synthetic client', beneficiary_name: 'Synthetic beneficiary', partner: 'Synthetic partner', dispersion_type: 'TRANSFERENCIA', account: '00001234' }]);
  throw Error('UNEXPECTED_SYNTHETIC_PROVIDER_REQUEST');
}
const modules = new Map();
function load(name) {
  assert(allow.has(name), 'Unexpected dependency: ' + name);
  if (modules.has(name)) return modules.get(name);
  const filename = path.join(directory, name + '.ts'), module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, process: { env: {} },
    require: dependency => dependency === 'crypto' ? crypto : load(dependency.replace(/^\.\//, '')),
    globalThis: Object.freeze({ fetch: fakeFetch }), URL, FormData, AbortController, setTimeout, clearTimeout,
  }, { filename });
  modules.set(name, module.exports);
  return module.exports;
}
const { bindVerifiedIqCommissionInstrument: bind } = load('commissionInstrumentBinding');
const { runIqCreateDispersionHttpH4D85A50: execute } = load('dispersionHttpCreateCore');
const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ rootId: 'root', despachoId: 'dispatch', profileId: 'owner-profile', clientIqId: '102', beneficiaryId: '103', accountId: '104', last4: '1234', operationTypeKey: 'TRANSFERENCIA' })).digest('hex');
const bindInput = { rootId: 'root', despachoId: 'dispatch', profileId: 'owner-profile', clientIqId: '102', operationTypeKey: 'TRANSFERENCIA',
  method: { iqPartnerId: '101', iqClientId: '102', iqBeneficiaryId: '103', iqAccountId: '104', iqInstrumentLast4: '1234', last4: '1234', iqDespachoId: 'dispatch', iqCredentialProfileId: 'owner-profile', iqInstrumentType: 'TRANSFERENCIA', iqEvidenceFingerprint: fingerprint },
  historicalLeg: { iqPartnerId: '101', iqBeneficiaryId: '103', iqAccountId: '104', instrumentLast4: '1234', iqEvidenceFingerprint: fingerprint },
};
const binding = bind(bindInput);
const item = { associatedName: 'Synthetic partner', clientCandidates: ['Synthetic client'], beneficiaryCandidates: ['Synthetic beneficiary'], clientIqId: '102', currency: 'MXN', operationTypeKey: 'TRANSFERENCIA', percentageLabel: '2', amount: 100, expectedDestinationLast4: '1234', reference: 'SYNTHETIC', fundingHolderType: 'USER', verifiedInstrument: binding };
function check(condition, label) { assert.ok(condition, label); checks++; }
async function run(changes = {}, itemChanges = {}) {
  scenario = changes; calls = posts = 0; posted = null;
  return execute({ apiOrigin: 'https://synthetic-iq.invalid', username: 'synthetic', password: 'synthetic', item: { ...item, ...itemChanges } });
}
async function main() {
  check(binding.accountId === '104' && binding.clientId === '102', 'Actual binding retains verified IDs');
  for (const changes of [{ clientIqId: '999' }, { profileId: 'another-profile' }, { despachoId: 'another-dispatch' }, { rootId: 'another-root' },
    { operationTypeKey: 'TDC' }, { historicalLeg: undefined }, { historicalLeg: { ...bindInput.historicalLeg, iqEvidenceFingerprint: 'changed' } },
    { method: { ...bindInput.method, iqCredentialProfileId: 'other' } }, { method: { ...bindInput.method, iqEvidenceFingerprint: 'changed' } },
    { method: { ...bindInput.method, last4: '9999' } }, { method: { ...bindInput.method, iqClientId: '999' } }]) {
    assert.throws(() => bind({ ...bindInput, ...changes }), /IQ_COMMISSION_VERIFIED_INSTRUMENT_CHANGED/); checks++;
  }
  for (const key of ['partnerId', 'clientId', 'beneficiaryId', 'accountId']) {
    const result = await run({}, { verifiedInstrument: { ...binding, [key]: '' } });
    check(result.outcome === 'FAILED_SAFE' && calls === 0 && posts === 0, 'Incomplete verified ID blocks before login: ' + key);
  }
  for (const [changes, code] of [[{ partnerId: 901 }, 'PARTNER'], [{ beneficiaryId: 903 }, 'BENEFICIARY'], [{ accountId: 904 }, 'ACCOUNT']]) {
    const result = await run(changes);
    check(result.outcome === 'FAILED_SAFE' && !result.submitClicked && !result.destinationVerified && posts === 0, 'Replacement with identical name/last4 must not POST: ' + code);
    check(result.errors.includes('IQ_COMMISSION_' + code + '_CHANGED'), 'Exact replacement diagnostic: ' + code);
  }
  for (const changes of [{ verifiedInstrument: undefined }, { clientIqId: '999' }, { expectedDestinationLast4: '9999' }]) {
    const result = await run({}, changes);
    check(result.outcome === 'FAILED_SAFE' && calls === 0 && posts === 0, 'Missing/stale USER evidence blocks before any provider request');
  }
  const success = await run();
  check(success.outcome === 'CREATED' && success.iqId === '401' && success.destinationVerified && posts === 1, 'Exact USER instrument submits once and reads back created result');
  check(posted.client_id === '102' && posted.beneficiary_account_id === '104' && posted.sale_percentage_id === '301' && posted.total_to_disperse === '100', 'POST preserves verified IDs and canonical amount/fee');
  scenario = { partnerId: 901 }; calls = posts = 0;
  await assert.rejects(async () => execute({ apiOrigin: 'https://synthetic-iq.invalid', username: 'synthetic', password: 'synthetic', item: {
    ...item, verifiedInstrument: bind({ ...bindInput, method: { ...bindInput.method, iqPartnerId: '901' } }),
  } }), /IQ_COMMISSION_VERIFIED_INSTRUMENT_CHANGED/);
  check(calls === 0 && posts === 0, 'Changed method and provider partner cannot replace the historical partner');
  const legacy = await run({ accountId: 904 }, { fundingHolderType: 'CLIENT', verifiedInstrument: undefined });
  check(legacy.outcome === 'CREATED' && posts === 1 && posted.beneficiary_account_id === '904', 'Existing CLIENT path is unchanged');
  console.log(JSON.stringify({ ok: true, checks, providerRequests: 0, emulatorUsed: false, coverage: 'actual HTTP adapter with in-memory provider; USER verified IDs and CLIENT compatibility' }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
