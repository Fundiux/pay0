import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectCapabilityRegistrations } from '../../scripts/verify-capability-registration.mjs';

const manifest = { entrypoint: 'index.ts', contracts: [{ capability: 'fixture', module: './handler', symbol: 'handleFixture' }] };
function fixture(t, entry = 'export { handleFixture } from "./handler";', handler) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pay0-capability-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'index.ts'), entry);
  fs.writeFileSync(path.join(root, 'handler.ts'), handler || 'import { onCall as callable } from "firebase-functions/v2/https"; export const handleFixture = callable({}, () => ({ ok: true }));');
  return inspectCapabilityRegistrations(root, manifest);
}
test('canonical callable registration passes even when formatting changes', t => {
  assert.equal(fixture(t, '/* fixture */ export {\n handleFixture\n } from "./handler";').status, 'PASSED');
});
test('removing the endpoint fails even when its name remains in comments', t => {
  assert.ok(fixture(t, '// handleFixture is still documented').failures.some(item => item.code === 'CANONICAL_ENDPOINT_MISSING'));
});
test('exporting same handler under a second endpoint fails as duplication', t => {
  assert.ok(fixture(t, 'export { handleFixture, handleFixture as duplicateFixture } from "./handler";').failures.some(item => item.code === 'DUPLICATE_HANDLER_REGISTRATION'));
});
test('replacing callable with a plain function fails', t => {
  assert.ok(fixture(t, undefined, 'export const handleFixture = () => ({ok:true});').failures.some(item => item.code === 'CALLABLE_DEFINITION_MISSING_OR_REPLACED'));
});
test('colliding endpoint names from another module fail', t => {
  assert.ok(fixture(t, 'export { handleFixture } from "./handler"; export { other as handleFixture } from "./other";').failures.some(item => item.code === 'ENDPOINT_NAME_COLLISION'));
});
