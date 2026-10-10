'use strict';
// Local SDK/CLI transformations only. Never load PAY0 handlers or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
for (const name of ['node:http', 'node:https']) {
  const net = require(name);
  net.request = net.get = () => { throw Error('NETWORK_FORBIDDEN'); };
}
global.fetch = () => { throw Error('NETWORK_FORBIDDEN'); };
const root = path.resolve(__dirname, '../..');
const ts = require(require.resolve('typescript', { paths: [path.join(root, 'functions')] }));
const sdk = path.resolve(path.dirname(require.resolve('firebase-functions/v2', { paths: [path.join(root, 'functions')] })), '../..');
const cli = process.env.PAY0_FIREBASE_TOOLS_ROOT || path.join(cp.execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] }).trim(), 'firebase-tools');
const { onCall } = require(path.join(sdk, 'lib/v2/providers/https.js'));
const options = require(path.join(sdk, 'lib/v2/options.js'));
const backend = require(path.join(cli, 'lib/deploy/functions/backend.js'));
const prepare = require(path.join(cli, 'lib/deploy/functions/prepare.js'));
const gcf = require(path.join(cli, 'lib/gcp/cloudfunctionsv2.js'));
const proto = require(path.join(cli, 'lib/gcp/proto.js'));
options.setGlobalOptions({ region: 'us-central1' });
const source = ts.createSourceFile('callables.ts', fs.readFileSync(path.join(root, 'functions/src/modules/documents/authorizedDownload.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const names = ['getAuthorizedDocumentDownloadUrl'];
const found = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(source))) {
    const call = node.initializer;
    assert(ts.isCallExpression(call)); assert.equal(call.expression.getText(source), 'onCall');
    assert(ts.isObjectLiteralExpression(call.arguments[0]));
    const opts = {};
    for (const prop of call.arguments[0].properties) {
      assert(ts.isPropertyAssignment(prop));
      const key = prop.name.getText(source), value = prop.initializer;
      assert(!Object.hasOwn(opts, key), 'duplicate option');
      if (ts.isStringLiteral(value)) opts[key] = value.text;
      else if (ts.isNumericLiteral(value)) opts[key] = Number(value.text);
      else { assert.equal(value.kind, ts.SyntaxKind.TrueKeyword); opts[key] = true; }
    }
    assert(!found.has(node.name.text)); found.set(node.name.text, opts);
  }
  ts.forEachChild(node, visit);
}
visit(source); assert.equal(found.size, 1);
let assertions = 0;
const omitted = ['minInstances', 'ingressSettings', 'serviceAccountEmail', 'vpc'];
const wireOmitted = ['minInstanceCount', 'ingressSettings', 'serviceAccountEmail', 'vpcConnector', 'vpcConnectorEgressSettings'];
for (const name of names) {
  const opts = found.get(name);
  assert.deepEqual(opts, { cors: true, preserveExternalChanges: true, maxInstances: 20, concurrency: 80, timeoutSeconds: 30, memory: '256MiB' }); assertions++;
  const endpoint = JSON.parse(JSON.stringify(onCall(opts, () => { throw Error('HANDLER_FORBIDDEN'); }).__endpoint));
  assert.deepEqual((endpoint.secretEnvironmentVariables || []).map(x => x.key), []); assertions++;
  for (const key of omitted) { assert(!Object.hasOwn(endpoint, key), key); assertions++; }
  assert.deepEqual(endpoint.callableTrigger, {}); assertions++;
  const e = { ...endpoint, id: name, project: 'demo-document-manifest', region: 'us-central1', runtime: 'nodejs22', entryPoint: name };
  const live = { ...e, cpu: 1, ingressSettings: 'ALLOW_ALL', serviceAccountEmail: 'synthetic@example.invalid' };
  const want = backend.of(e);
  prepare.inferDetailsFromExisting(want, backend.of(live), true);
  prepare.resolveCpuAndConcurrency(want);
  const wire = gcf.functionFromEndpoint(e), mask = proto.fieldMasks(wire);
  for (const [key, value] of Object.entries({ maxInstanceCount: 20, maxInstanceRequestConcurrency: 80, timeoutSeconds: 30, availableMemory: '256Mi', availableCpu: '1' })) {
    assert.equal(wire.serviceConfig[key], value, key); assert(mask.includes('serviceConfig.' + key), key); assertions += 2;
  }
  for (const field of wireOmitted) { assert(!mask.includes('serviceConfig.' + field), field); assertions++; }
  // Negative control proves this checks the actual SDK reset behavior.
  const unsafe = JSON.parse(JSON.stringify(onCall({ ...opts, preserveExternalChanges: false }, () => {}).__endpoint));
  assert.equal(unsafe.minInstances, null); assertions++;
  const resetWire = gcf.functionFromEndpoint({ ...e, minInstances: unsafe.minInstances });
  assert(proto.fieldMasks(resetWire).includes('serviceConfig.minInstanceCount')); assertions++;
}
console.log(`AUTHORIZED_DOCUMENT_MANIFEST_PASS functions=1 assertions=${assertions} SDK=${require(path.join(sdk, 'package.json')).version} CLI=${require(path.join(cli, 'package.json')).version} network=forbidden`);
