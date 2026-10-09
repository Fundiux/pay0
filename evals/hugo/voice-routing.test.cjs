const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../functions/src/modules/agent007/voiceDelegation.ts'), 'utf8');
test('las tres rutas quedan separadas y la autorizacion ocurre antes de PAY0', () => {
  assert.match(source, /ECONOMIC_VOICE/); assert.match(source, /DETERMINISTIC_TOOL/); assert.match(source, /BRAIN_MODEL/);
  assert.ok(source.indexOf('assertAuthorized') < source.indexOf('new Pay0Connector'));
  assert.match(source, /delegatedModelCostUsd: route === "DETERMINISTIC_TOOL" \? 0/);
});
test('el ledger separa hablar pensar herramientas y transcripcion', () => {
  for (const key of ['voiceCostUsd','delegatedModelCostUsd','externalToolCostUsd','transcriptionCostUsd']) assert.match(source, new RegExp(key));
});
