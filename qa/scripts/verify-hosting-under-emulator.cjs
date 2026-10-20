// Run the exact Hosting verifier with the isolated emulator supplied by the launcher.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/);
assert.match(process.env.GCLOUD_PROJECT || '', /^demo-pay0-e1-/);
const root = path.resolve(__dirname, '../..');
const input = process.env.PAY0_HOSTING_TEST_INPUT;
const hash = process.env.PAY0_HOSTING_TEST_INPUT_SHA;
const runtime = process.env.PAY0_HOSTING_TEST_RUNTIME;
assert.ok(input, 'Exact input required');
assert.match(hash || '', /^[a-f0-9]{64}$/);
const result = spawnSync(process.execPath, [path.join(__dirname, 'verify-modular-hosting-runtime.mjs'), input, hash, ...(runtime ? [runtime] : [])], {
  cwd: root, env: process.env, windowsHide: true, stdio: 'inherit', timeout: 900000,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
