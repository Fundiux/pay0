const assert = require('node:assert/strict');
const path = require('node:path');
const { loadConfig } = require('../../tools/whatsapp-qr-connector/enrolledLauncher.cjs');

const base = { baseUrl: "https://example.invalid/fn", pythonPath: "C:/Python/python.exe", vaultPath: "C:/x/pay0-wa-worker-vault/worker.dpapi", sessionRoot: "C:/x/auth" };
const read = over => () => JSON.stringify({ ...base, ...over });
const cases = [];
const test = (name, fn) => { fn(); cases.push(name); };
const rejects = (over, code) => assert.throws(() => loadConfig('c.json', read(over)), e => e.message.startsWith(code));

test('valid-config-defaults-capture-off', () => {
  const c = loadConfig('c.json', read({}));
  assert.equal(c.captureGroups, false);
  assert(c.policyModule.endsWith(path.join('documentDelivery', 'whatsappConnectorPolicy.js')));
});
test('capture-groups-only-true-when-explicit', () => assert.equal(loadConfig('c.json', read({ captureGroups: true })).captureGroups, true));
test('rejects-non-https-and-relative-paths', () => {
  rejects({ baseUrl: 'http://example.invalid' }, 'CONFIG_HTTPS_REQUIRED');
  rejects({ sessionRoot: 'auth' }, 'CONFIG_ABSOLUTE_PATH_REQUIRED:sessionRoot');
  rejects({ executablePath: 'chrome.exe' }, 'CONFIG_ABSOLUTE_PATH_REQUIRED:executablePath');
});
test('rejects-vault-path-outside-expected-shape', () => rejects({ vaultPath: 'C:/x/other/worker.dpapi' }, 'CONFIG_VAULT_PATH_SHAPE'));
test('rejects-missing-fields-and-bad-capture-type', () => {
  rejects({ baseUrl: undefined }, 'CONFIG_FIELD_REQUIRED:baseUrl');
  rejects({ captureGroups: 'yes' }, 'CONFIG_CAPTURE_GROUPS_BOOLEAN');
});
console.log(JSON.stringify({ status: 'PASS', checks: cases.length, cases }));
