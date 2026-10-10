'use strict';
// Exercise the real CLI PATCH boundary without network or application handlers.
const assert = require('node:assert/strict');
const path = require('node:path');
const cp = require('node:child_process');
const fs = require('node:fs');
const appDataCli = process.env.APPDATA && path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools');
const cli = process.env.PAY0_FIREBASE_TOOLS_ROOT || (appDataCli && fs.existsSync(path.join(appDataCli, 'lib/apiv2.js')) ? appDataCli : path.join(cp.execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] }).trim(), 'firebase-tools'));
const { Client } = require(path.join(cli, 'lib/apiv2.js'));
const gcf = require(path.join(cli, 'lib/gcp/cloudfunctionsv2.js'));
for (const name of ['node:http', 'node:https']) { const net = require(name); net.request = net.get = () => { throw Error('NETWORK_FORBIDDEN'); }; }
global.fetch = () => { throw Error('NETWORK_FORBIDDEN'); };
let captured;
const prior = Client.prototype.patch;
Client.prototype.patch = async function(resource, body, options) {
  assert.equal(resource, 'projects/demo-pay0-manifest/locations/us-central1/functions/synthetic');
  captured = { body: JSON.parse(JSON.stringify(body)), options };
  return { body: { name: 'synthetic-operation' } };
};
(async () => {
  let cases = 0;
  try {
    for (const limit of [undefined, null, 1, 20]) {
      const endpoint = { platform: 'gcfv2', id: 'synthetic', project: 'demo-pay0-manifest', region: 'us-central1', runtime: 'nodejs22', entryPoint: 'synthetic', availableMemoryMb: 2048, timeoutSeconds: 540, cpu: 1, concurrency: 80, taskQueueTrigger: {}, ...(limit === undefined ? {} : { maxInstances: limit }) };
      const wire = gcf.functionFromEndpoint(endpoint);
      await gcf.updateFunction(wire);
      const mask = captured.options.queryParams.updateMask.split(',');
      assert.equal(mask.includes('serviceConfig.maxInstanceCount'), limit !== undefined);
      assert.equal(Object.hasOwn(captured.body.serviceConfig, 'maxInstanceCount'), limit !== undefined);
      if (limit !== undefined) assert.equal(captured.body.serviceConfig.maxInstanceCount, limit);
      assert(!mask.includes('serviceConfig')); // No parent mask silently resets the absent child.
      assert.equal(captured.body.serviceConfig.maxInstanceRequestConcurrency, 80);
      cases++;
    }
  } finally { Client.prototype.patch = prior; }
  console.log(`IQ_PATCH_BOUNDARY_PASS cases=${cases} CLI=${require(path.join(cli, 'package.json')).version} network=forbidden absent_limit=not_sent cloud_default=not_simulated`);
})().catch(() => { console.error('IQ_PATCH_BOUNDARY_FAIL'); process.exitCode = 1; });
