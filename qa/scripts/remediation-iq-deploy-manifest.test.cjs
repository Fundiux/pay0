'use strict';
// Executes SDK/CLI transformation functions only; no PAY0 handlers or provider calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const ts = require(require.resolve('typescript', { paths: [root] }));
const sdk = path.resolve(path.dirname(require.resolve('firebase-functions/v2', { paths: [path.join(root, 'functions')] })), '../..');
const cli = process.env.PAY0_FIREBASE_TOOLS_ROOT || path.join(cp.execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] }).trim(), 'firebase-tools');
const tasks = require(path.join(sdk, 'lib/v2/providers/tasks.js'));
const scheduler = require(path.join(sdk, 'lib/v2/providers/scheduler.js'));
const options = require(path.join(sdk, 'lib/v2/options.js'));
const backend = require(path.join(cli, 'lib/deploy/functions/backend.js'));
const prepare = require(path.join(cli, 'lib/deploy/functions/prepare.js'));
const gcf = require(path.join(cli, 'lib/gcp/cloudfunctionsv2.js'));
const proto = require(path.join(cli, 'lib/gcp/proto.js'));
// Any accidental network use fails immediately (module loading above makes no requests).
for (const name of ['node:http', 'node:https']) {
  const net = require(name); net.request = net.get = () => { throw Error('NETWORK_FORBIDDEN'); };
}
global.fetch = () => { throw Error('NETWORK_FORBIDDEN'); };
options.setGlobalOptions({ region: 'us-central1' });
const source = ts.createSourceFile('pago.ts', fs.readFileSync(path.join(root, 'functions/src/modules/iq/pagoDepositCallables.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const names = ['processIqPagoDepositOnDemandTask', 'processIqPagoDepositAutomaticTask', 'processIqPagoDepositCreateQueue'];
const found = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(source))) {
    assert(ts.isCallExpression(node.initializer));
    const text = node.initializer.arguments[0].getText(source);
    // Only the literal options object is evaluated; secret names are synthetic strings.
    const opts = vm.runInNewContext('(' + text + ')', { IQ_CREDENTIALS_KEY: 'IQ_CREDENTIALS_KEY', TELEGRAM_BOT_TOKEN: 'TELEGRAM_BOT_TOKEN', DEFAULT_IQ_TIME_ZONE: 'America/Mexico_City' });
    found.set(node.name.getText(source), opts);
  }
  ts.forEachChild(node, visit);
}
visit(source); assert.equal(found.size, 3);
let assertions = 0;
for (const [index, name] of names.entries()) {
  const opts = found.get(name); assert.equal(opts.preserveExternalChanges, true); assertions++;
  const factory = index === 2 ? scheduler.onSchedule : tasks.onTaskDispatched;
  const endpoint = JSON.parse(JSON.stringify(factory(opts, () => {}).__endpoint));
  for (const key of ['minInstances', 'ingressSettings', 'serviceAccountEmail', 'vpc']) { assert(!Object.hasOwn(endpoint, key)); assertions++; }
  if (index !== 0) { assert(!Object.hasOwn(endpoint, 'maxInstances')); assertions++; }
  assert.equal(endpoint.availableMemoryMb, 2048); assert.equal(endpoint.timeoutSeconds, 540); assertions += 2;
  assert.deepEqual(endpoint.secretEnvironmentVariables.map(x => x.key).sort(), ['IQ_CREDENTIALS_KEY', 'TELEGRAM_BOT_TOKEN']); assertions++;
  if (index === 2) {
    assert.equal(endpoint.scheduleTrigger.schedule, 'every 1 minutes');
    assert.equal(endpoint.scheduleTrigger.timeZone, 'America/Mexico_City'); assertions += 2;
  } else {
    assert.equal(endpoint.taskQueueTrigger.retryConfig.maxAttempts, index === 0 ? 1 : 3);
    assert.equal(endpoint.taskQueueTrigger.retryConfig.minBackoffSeconds, index === 0 ? 60 : 300);
    assert.equal(endpoint.taskQueueTrigger.retryConfig.maxBackoffSeconds, index === 0 ? 300 : 900);
    assert.equal(endpoint.taskQueueTrigger.rateLimits.maxConcurrentDispatches, 1);
    assert.equal(endpoint.taskQueueTrigger.rateLimits.maxDispatchesPerSecond, 1);
    assert(!Object.hasOwn(endpoint.taskQueueTrigger.retryConfig, 'maxDoublings')); assertions += 6;
    if (index === 1) { assert.equal(endpoint.taskQueueTrigger.retryConfig.maxRetrySeconds, 1800); assertions++; }
  }
  const e = { ...endpoint, id: name, project: 'demo-pay0-manifest', region: 'us-central1', runtime: 'nodejs22', entryPoint: name };
  const live = { ...e, cpu: 1, ingressSettings: 'ALLOW_ALL', concurrency: index === 0 ? 1 : 80 };
  if (index === 2) live.maxInstances = 20;
  const want = backend.of(e); prepare.inferDetailsFromExisting(want, backend.of(live), true); prepare.resolveCpuAndConcurrency(want);
  const wire = gcf.functionFromEndpoint(e); const mask = proto.fieldMasks(wire);
  assert.equal(wire.serviceConfig.availableCpu, '1'); assert.equal(wire.serviceConfig.maxInstanceRequestConcurrency, index === 0 ? 1 : 80); assertions += 2;
  for (const field of ['minInstanceCount', 'ingressSettings', 'serviceAccountEmail', 'vpcConnector', 'vpcConnectorEgressSettings']) { assert(!mask.includes('serviceConfig.' + field)); assertions++; }
  assert.equal(mask.includes('serviceConfig.maxInstanceCount'), index === 0); assertions++;
  if (index === 0) { assert.equal(wire.serviceConfig.maxInstanceCount, 1); assertions++; }
  // Regression: removal of preserveExternalChanges resets omitted limits explicitly.
  const unsafe = JSON.parse(JSON.stringify(factory({ ...opts, preserveExternalChanges: false }, () => {}).__endpoint));
  assert.equal(unsafe.minInstances, null); assertions++;
  if (index !== 0) { assert.equal(unsafe.maxInstances, null); const reset = gcf.functionFromEndpoint({ ...e, maxInstances: null }); assert(proto.fieldMasks(reset).includes('serviceConfig.maxInstanceCount')); assertions += 2; }
}
console.log(`IQ_DEPLOY_MANIFEST_PASS functions=3 assertions=${assertions} SDK=${require(path.join(sdk, 'package.json')).version} CLI=${require(path.join(cli, 'package.json')).version} network=forbidden`);
