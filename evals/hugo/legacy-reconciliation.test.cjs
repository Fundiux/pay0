const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');
const compiled = join(__dirname, '../../functions/lib/modules/agent007/reconciliation.js');

test('both legacy read paths invoke reconciliation', () => {
  const source = readFileSync(join(__dirname, '../../functions/src/modules/agent007/callables.ts'), 'utf8');
  assert.match(source, /async function operationalContext[\s\S]*?await reconcileAgent007Recommendations\(db, rootId\)/);
  assert.match(source, /export const listAgent007Recommendations[\s\S]*?await reconcileAgent007Recommendations\(db, rootId\)/);
});

test('legacy reconciliation called by READ writes a superseded recommendation', { skip: !existsSync(compiled) && 'Run npm --prefix functions run build first' }, async () => {
  const { reconcileAgent007Recommendations } = require(compiled);
  const writes = [];
  const recommendation = { kind: 'OC_FISCAL_REVIEW', caseId: 'sol-1', rootId: 'root-a', status: 'PENDING_REVIEW', proposal: 'Revisar OC' };
  const recDoc = { id: 'rec-1', data: () => recommendation, ref: { set: async (patch, options) => writes.push({ patch, options }) } };
  const db = {
    collection: name => {
      assert.equal(name, 'agent007Recommendations');
      return { where: () => ({ where: () => ({ limit: () => ({ get: async () => ({ docs: [recDoc] }) }) }) }) };
    },
    doc: path => {
      assert.equal(path, 'solicitudes/sol-1');
      return { get: async () => ({ exists: true, id: 'sol-1', data: () => ({ rootId: 'root-a', folio: 'S12345', facturaUuid: 'synthetic-uuid' }) }) };
    },
  };
  assert.equal(await reconcileAgent007Recommendations(db, 'root-a'), 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].patch.status, 'SUPERSEDED');
  assert.equal(writes[0].patch.resolvedByEvent, 'CFDI_ISSUED');
  assert.equal(writes[0].options.merge, true);
});
