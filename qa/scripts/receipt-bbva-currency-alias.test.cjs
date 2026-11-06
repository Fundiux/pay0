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
