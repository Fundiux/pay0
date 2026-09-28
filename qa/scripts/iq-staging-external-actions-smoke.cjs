const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const environment = {};
let networkCalls = 0, checks = 0, lastCall;
const response = { ok: true };
const policyPath = 'functions/src/modules/iq/externalActionsPolicy.ts';
const exportsCache = new Map();
function load(file) {
  const resolved = path.resolve(root, file);
  if (exportsCache.has(resolved)) return exportsCache.get(resolved);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(resolved, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const fetch = async (input, init) => { networkCalls++; lastCall = { input, init }; return response; };
  vm.runInNewContext(code, { module, exports: module.exports, process: { env: environment },
    require: name => load(path.relative(root, path.resolve(path.dirname(resolved), `${name}.ts`))),
    globalThis: { fetch }, URL, AbortController, setTimeout, clearTimeout,
  }, { filename: resolved });
  exportsCache.set(resolved, module.exports);
  return module.exports;
}
function setEnvironment(next) { for (const key of Object.keys(environment)) delete environment[key]; Object.assign(environment, next); }
function check(condition, label) { assert.ok(condition, label); checks++; }
async function main() {
  const policy = load(policyPath), transport = load('functions/src/modules/iq/iqHttpClient.ts');
  const cases = [
    { PAY0_ENVIRONMENT: 'staging' },
    { PAY0_ENVIRONMENT: 'staging', PAY0_EXTERNAL_ACTIONS_MODE: 'live' },
    { GCLOUD_PROJECT: 'pay-0-system-staging' },
    { GCLOUD_PROJECT: 'pay-0-system-staging', PAY0_ENVIRONMENT: 'production', PAY0_EXTERNAL_ACTIONS_MODE: 'live' },
    { GOOGLE_CLOUD_PROJECT: 'pay-0-system-staging' },
    { GCP_PROJECT: 'pay-0-system-staging' },
    { FIREBASE_CONFIG: JSON.stringify({ projectId: 'pay-0-system-staging' }) },
    { GCLOUD_PROJECT: 'pay-0-system', GOOGLE_CLOUD_PROJECT: 'pay-0-system-staging' },
    ...['disabled', 'simulated', 'sandbox', 'live', 'typo'].map(mode => ({ PAY0_EXTERNAL_ACTIONS_MODE: mode })),
    { PAY0_ENVIRONMENT: 'sandbox' }, { PAY0_ENVIRONMENT: 'typo' },
  ];
  for (const env of cases) {
    setEnvironment(env);
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      await assert.rejects(policy.fetchIqExternal('https://iq.invalid/resource', { method }), /EXTERNAL_ACTIONS_DISABLED/);
      checks++;
    }
    await assert.rejects(transport.fetchIq('https://iq.invalid/resource', { method: 'POST' }), /EXTERNAL_ACTIONS_DISABLED/);
    checks++;
  }
  check(networkCalls === 0, 'No isolated/unknown mode opens transport');
  setEnvironment({ GCLOUD_PROJECT: 'pay-0-system' });
  const init = { method: 'POST', headers: { 'x-synthetic': 'fixture' }, body: 'synthetic', signal: new AbortController().signal };
  assert.equal(await policy.fetchIqExternal('https://iq.invalid/resource', init), response);
  check(lastCall.init === init && lastCall.input === 'https://iq.invalid/resource', 'Production request and signal preserved');
  setEnvironment({ GCLOUD_PROJECT: 'pay-0-system', PAY0_ENVIRONMENT: 'production' });
  await policy.fetchIqExternal('https://iq.invalid/resource');
  check(networkCalls === 2, 'Legacy production transport remains available through stub only');
  const domains = ['iq', 'clients', 'paymentApplications'];
  let guardedModules = 0;
  for (const domain of domains) {
    const directory = path.join(root, 'functions/src/modules', domain);
    for (const name of fs.readdirSync(directory).filter(name => name.endsWith('.ts'))) {
      const file = path.join(directory, name), source = fs.readFileSync(file, 'utf8');
      if (file === path.resolve(root, policyPath)) continue;
      assert.doesNotMatch(source, /(?:globalThis|global)\.fetch\s*\(|https?\.request\s*\(|axios[.(]/, `Unreviewed network bypass: ${domain}/${name}`);
      if (/\bfetch\s*\(/.test(source)) {
        assert.match(source, /import\s*\{\s*fetchIqExternal\s+as\s+fetch\s*\}\s*from\s*["'][^"']*externalActionsPolicy["']/,
          `Unguarded IQ transport: ${domain}/${name}`);
        guardedModules++;
      }
    }
  }
  check(guardedModules === 6, 'All six current IQ transport modules covered');
  console.log(JSON.stringify({ test: 'iq-staging-external-actions', checks, guardedModules, productionCalls: 0, externalActions: 0, result: 'PASS' }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
