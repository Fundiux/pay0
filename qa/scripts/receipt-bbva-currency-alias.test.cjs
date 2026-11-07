const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseReceiptText } = require('../../functions/lib/modules/pagos/receiptPdfCallables.js');
const { receiptAliasAllowed, selectReceiptIdentity } = require('../../functions/lib/modules/pagos/receiptIdentificationDomain.js');

const bbva = ['INSERVICE TELECOM S DE RL DE CV', 'Resultado del traspaso', 'Importe: $ 46,965.72', 'Forma de depósito: MISMO DIA (SPEI)', 'Referencia numérica: 051126', 'RFC: ACA180724QV3', 'Datos del beneficiario', 'Nombre: ACIER CAPITAL SA DE CV'].join('\n');

test('SPEI receipt with a peso amount and no other currency is MXN', () => {
  assert.equal(parseReceiptText(bbva).currency, 'MXN');
});
test('foreign currency or non-SPEI receipts are not defaulted to MXN', () => {
  assert.equal(parseReceiptText(bbva + '\nUSD').currency, '');
  assert.equal(parseReceiptText(bbva.replace('SPEI', 'CHEQUE')).currency, '');
});
for (const party of ['CLIENT', 'COMPANY']) {
  test(`${party}: a learned alias cannot override a contradicting RFC or another entity's exact RFC`, () => {
    const target = { id: 't', name: 'ACIER CAPITAL SA DE CV', rfc: 'ACA180724QV3' };
    const noRfc = { id: 'e2', name: 'OTRA SA DE CV' };
    const other = { id: 'e3', name: 'TERCERA SA DE CV', rfc: 'TER010101AB1' };
    const opts = { party };
    assert.equal(receiptAliasAllowed([target], target, { name: target.name, rfc: 'XYZ010101AB1' }, opts), false);
    assert.equal(receiptAliasAllowed([target], target, { name: target.name, rfc: 'ACA180724QV3' }, opts), true);
    assert.equal(receiptAliasAllowed([noRfc, other], noRfc, { name: 'X', rfc: 'TER010101AB1' }, opts), false);
    assert.equal(receiptAliasAllowed([noRfc, other], noRfc, { name: 'X' }, opts), true);
    const fullAccount = { id: 'e4', name: 'CUARTA', clabe: '659455292000000005' };
    assert.equal(receiptAliasAllowed([noRfc, fullAccount], noRfc, { name: 'X', account: '659455292000000005' }, opts), false);
  });
}
test('a learned alias is recorded as its own evidence, not as a user selection', () => {
  const item = { id: 'e2', name: 'OTRA SA DE CV' };
  const learned = selectReceiptIdentity([item], { name: 'X' }, 'e2', { party: 'COMPANY', selectionEvidence: 'LEARNED_ALIAS' }).match.evidence;
  assert.ok(learned.includes('LEARNED_ALIAS') && !learned.includes('USER_SELECTED_AUTHORIZED_CATALOG_ENTRY'));
  assert.ok(selectReceiptIdentity([item], { name: 'X' }, 'e2', { party: 'COMPANY' }).match.evidence.includes('USER_SELECTED_AUTHORIZED_CATALOG_ENTRY'));
});

test('a BBVA capture date is detected evidence, not inferred', () => {
  const { buildSemanticReceipt } = require('../../functions/lib/modules/pagos/receiptSemantics.js');
  const text = 'Importe: $ 46,965.72\nFecha y Hora de Captura: 05/11/2026 17:15:58\nReferencia numérica: 051126';
  const semantic = buildSemanticReceipt(text, parseReceiptText(text));
  assert.equal(semantic.fields.executionDate.provenance, 'DETECTED');
});

test('alias trust needs two consecutive registrations to the same target and dies with a cancelled pago', async () => {
  const { readReceiptAliasesTx, writeReceiptAliasesTx, retractReceiptAliasesForPago, receiptAliasId, RECEIPT_ALIAS_MIN_STREAK } = require('../../functions/lib/modules/pagos/receiptIdentification.js');
  const store = new Map();
  const db = {
    doc: path => ({ path, delete: async () => store.delete(path) }),
    collection: () => ({ where: (_f, _op, pagoId) => ({ get: async () => ({ docs: [...store].filter(([, v]) => v.pagoIds.includes(pagoId)).map(([path, v]) => ({ get: k => v[k], ref: { delete: async () => store.delete(path) } })) }) }) }),
  };
  const tx = { get: async ref => { const v = store.get(ref.path); return { exists: !!v, get: k => v?.[k], data: () => v }; }, set: (ref, v) => store.set(ref.path, v) };
  const register = async (pagoId, clienteId) => {
    const reads = await readReceiptAliasesTx(tx, db, 'r1', { senderName: 'INSERVICE TELECOM S DE RL DE CV', clienteId, companyId: 'co' });
    writeReceiptAliasesTx(tx, { uid: 'u', rootId: 'r1' }, pagoId, reads);
  };
  const key = `receiptIdentityAliases/${receiptAliasId('r1', 'CLIENT', 'INSERVICE TELECOM S DE RL DE CV')}`;
  await register('p1', 'c1');
  assert.equal(store.get(key).streak, 1);
  assert.ok(store.get(key).streak < RECEIPT_ALIAS_MIN_STREAK);
  await register('p2', 'c1');
  assert.equal(store.get(key).streak, 2);
  await register('p3', 'c2');
  assert.deepEqual([store.get(key).targetId, store.get(key).streak], ['c2', 1]);
  await register('p4', 'c2');
  assert.equal(await retractReceiptAliasesForPago(db, 'other-root', 'p4'), 0);
  assert.equal(await retractReceiptAliasesForPago(db, 'r1', 'p4'), 1);
  assert.equal(store.has(key), false);
});

test('cross-client duplicate keys catch a resent receipt whatever the file or client', () => {
  const { receiptCrossClientDuplicateIds } = require('../../functions/lib/modules/pagos/receiptIdentification.js');
  const first = receiptCrossClientDuplicateIds({ rootId: 'r1', amount: 46965.72, date: '2026-11-05', reference: '051126', trackingKey: 'BNET01002611050032896467' });
  assert.equal(first.length, 2);
  // Same transfer re-read from a screenshot: formatting differs, identity does not.
  const resent = receiptCrossClientDuplicateIds({ rootId: 'r1', amount: 46965.720, date: '2026-11-05', reference: '05-11-26'.replace(/-/g, ''), trackingKey: 'bnet 01002611050032896467' });
  assert.deepEqual(resent, first);
  // Only the tracking key is needed when the reference or date were misread.
  assert.equal(receiptCrossClientDuplicateIds({ rootId: 'r1', amount: 1, date: '', reference: '', trackingKey: 'BNET01002611050032896467' })[0], first[0]);
  // Never shared across roots, and weak evidence yields no key.
  assert.notEqual(receiptCrossClientDuplicateIds({ rootId: 'r2', amount: 46965.72, date: '2026-11-05', reference: '051126', trackingKey: 'BNET01002611050032896467' })[0], first[0]);
  assert.deepEqual(receiptCrossClientDuplicateIds({ rootId: 'r1', amount: 10, date: '2026-11-05', reference: '12', trackingKey: 'ABC' }), []);
});
