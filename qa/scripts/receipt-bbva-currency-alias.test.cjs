const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseReceiptText } = require('../../functions/lib/modules/pagos/receiptPdfCallables.js');
const { receiptIdentityContradicts } = require('../../functions/lib/modules/pagos/receiptIdentificationDomain.js');

const bbva = ['INSERVICE TELECOM S DE RL DE CV', 'Resultado del traspaso', 'Importe: $ 46,965.72', 'Forma de depósito: MISMO DIA (SPEI)', 'Referencia numérica: 051126', 'RFC: ACA180724QV3', 'Datos del beneficiario', 'Nombre: ACIER CAPITAL SA DE CV'].join('\n');

test('SPEI receipt with a peso amount and no other currency is MXN', () => {
  assert.equal(parseReceiptText(bbva).currency, 'MXN');
});
test('foreign currency or non-SPEI receipts are not defaulted to MXN', () => {
  assert.equal(parseReceiptText(bbva + '\nUSD').currency, '');
  assert.equal(parseReceiptText(bbva.replace('SPEI', 'CHEQUE')).currency, '');
});
test('a learned alias cannot override a contradicting RFC', () => {
  const company = { id: 'c', name: 'ACIER CAPITAL SA DE CV', rfc: 'ACA180724QV3' };
  assert.equal(receiptIdentityContradicts(company, { name: company.name, rfc: 'XYZ010101AB1' }, { party: 'COMPANY' }), true);
  assert.equal(receiptIdentityContradicts(company, { name: company.name, rfc: 'ACA180724QV3' }, { party: 'COMPANY' }), false);
});

test('a BBVA capture date is detected evidence, not inferred', () => {
  const { buildSemanticReceipt } = require('../../functions/lib/modules/pagos/receiptSemantics.js');
  const text = 'Importe: $ 46,965.72\nFecha y Hora de Captura: 05/11/2026 17:15:58\nReferencia numérica: 051126';
  const semantic = buildSemanticReceipt(text, parseReceiptText(text));
  assert.equal(semantic.fields.executionDate.provenance, 'DETECTED');
});
