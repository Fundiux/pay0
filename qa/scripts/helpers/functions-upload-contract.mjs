import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { sha256 } from '../../../scripts/lib/functions-bundle-integrity.mjs';

export function cliRoot(environment = process.env) {
  const root = environment.PAY0_FIREBASE_TOOLS_ROOT || (environment.APPDATA && path.join(environment.APPDATA, 'npm/node_modules/firebase-tools'));
  if (!root || JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version !== '15.3.1') throw Error('CLI_VERSION_UNREVIEWED');
  return root;
}
export async function verifyCloudBuildContract(root) {
  const filename = path.join(root, 'lib/gcp/cloudfunctionsv2.js'), code = fs.readFileSync(filename, 'utf8');
  if (sha256(code) !== '86e509ae6d76fd048c32f9d85599099c54510c72306f0555d6dbc847048802b5') throw Error('CLI_CODE_UNREVIEWED');
  const calls = [], require = createRequire(filename), exports = {};
  class Client {
    async post(...args) { calls.push(['create', ...args]); return { body: {} }; }
    async patch(...args) { calls.push(['update', ...args]); return { body: {} }; }
  }
  const mocks = { '../apiv2': { Client }, '../api': { functionsV2Origin: () => 'https://invalid.example' }, './proto': require('./proto') };
  vm.runInNewContext('(function(exports,require){' + code + '\n})', {}, { timeout: 1000 })(exports, name => mocks[name] || {});
  const specimen = { name: 'projects/demo-bundle/locations/us-central1/functions/test', buildConfig: { entryPoint: 'test', environmentVariables: { PRESERVED: 'synthetic', GOOGLE_NODE_RUN_SCRIPTS: 'must-be-replaced' } }, serviceConfig: { maxInstanceCount: 20, minInstanceCount: 0, maxInstanceRequestConcurrency: 1, environmentVariables: { SYNTHETIC: 'fixture' } } };
  await exports.createFunction(structuredClone(specimen)); await exports.updateFunction(structuredClone(specimen));
  for (const [, , body] of calls) {
    assert.equal(body.buildConfig.environmentVariables.GOOGLE_NODE_RUN_SCRIPTS, '');
    assert.equal(body.buildConfig.environmentVariables.PRESERVED, 'synthetic');
    assert.equal(body.serviceConfig.maxInstanceCount, 20); assert.equal(body.serviceConfig.minInstanceCount, 0); assert.equal(body.serviceConfig.maxInstanceRequestConcurrency, 1);
    assert.equal(body.serviceConfig.environmentVariables.PAY0_FUNCTIONS_BUILD_MODE, undefined);
  }
  assert(calls[1][3].queryParams.updateMask.includes('buildConfig.environmentVariables'));
  return { cliVersion: '15.3.1', fakeRequests: calls.length, cloudScriptsDisabled: true, cloudCalls: 0 };
}
