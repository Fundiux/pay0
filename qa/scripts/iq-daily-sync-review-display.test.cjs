'use strict';
// Pure test: readable reviews and the wider window for open reviews of the daily IQ sync.
//   npm --prefix functions run build && node qa/scripts/iq-daily-sync-review-display.test.cjs
const assert = require('node:assert/strict');
const display = require('../../functions/lib/modules/iqDailySync/reviewDisplay.js');
const domain = require('../../functions/lib/modules/iqDailySync/domain.js');

let checks = 0;
const check = (name, fn) => { fn(); checks += 1; console.log('ok', name); };
const TZ = 'America/Mexico_City';

check('deposit row becomes client, amount and date in plain data', () => {
  const row = display.displayFromIqRow('PAYMENT', { id: 237159, client: 'GRUPO INTERNACIONAL AYEKAN', amount: '200000', currency: 'mxn', created_at: '2026-11-21T11:07:00-06:00', __p4ClientResolution: { status: 'CONFLICT', candidateCount: 2 } });
  assert.equal(row.kind, 'Depósito');
  assert.equal(row.clientName, 'GRUPO INTERNACIONAL AYEKAN');
  assert.equal(row.amount, 200000);
  assert.equal(row.currency, 'MXN');
  assert.equal(row.date, '2026-11-21');
  assert.deepEqual(row.clientMatch, { status: 'CONFLICT', candidateCount: 2 });
});

check('client row carries the RFC and no amount', () => {
  const row = display.displayFromIqRow('CLIENT', { id: 5025, name: 'GRUPO INTERNACIONAL AYEKAN', rfc: 'GIA230810TD6', created_at: '2025-01-31 08:01:00' });
  assert.equal(row.kind, 'Cliente');
  assert.equal(row.rfc, 'GIA230810TD6');
  assert.equal(row.amount, null);
  assert.equal(row.date, '2025-01-31');
});

check('a missing amount is null, never zero', () => {
  assert.equal(display.displayFromIqRow('PAYMENT', { id: 1, client: 'X' }).amount, null);
  assert.equal(display.displayFromIqRow('PAYMENT', { id: 1, client: 'X', amount: '' }).amount, null);
});

check('dispersion row keeps client, beneficiary and bank', () => {
  const row = display.displayFromIqDispersion({ id: 442623, client: 'Cliente Norte', beneficiary_name: 'ALEJANDRO TREVIÑO SANTOS', bank_name: 'BANREGIO', total_to_disperse: 171464.55, currency: 'MXN', created_at: '2026-11-21T10:00:00-06:00' });
  assert.equal(row.kind, 'Dispersión');
  assert.equal(row.beneficiaryName, 'ALEJANDRO TREVIÑO SANTOS');
  assert.equal(row.bank, 'BANREGIO');
  assert.equal(row.amount, 171464.55);
});

check('reasons are plain Spanish and the client match explains the unresolved client', () => {
  assert.match(display.reasonEs('IQ_DISPERSION_NOT_IN_PAY0'), /Dispersión hecha directamente en IQ/);
  const conflict = display.displayFromIqRow('PAYMENT', { client: 'X', __p4ClientResolution: { status: 'CONFLICT', candidateCount: 2 } });
  assert.match(display.reasonEs('FINANCIAL_COMPONENT_DEPENDS_ON_AN_UNRESOLVED_CLIENT', conflict), /2 clientes con ese mismo nombre/);
  const missing = display.displayFromIqRow('PAYMENT', { client: 'X', __p4ClientResolution: { status: 'NOT_FOUND', candidateCount: 0 } });
  assert.match(display.reasonEs('FINANCIAL_COMPONENT_DEPENDS_ON_AN_UNRESOLVED_CLIENT', missing), /no se encontró un cliente con ese nombre/);
  assert.equal(display.reasonEs('SOMETHING_NEW'), 'Requiere revisión del equipo.');
  for (const code of ['IQ_DISPERSION_NOT_IN_PAY0', 'FINANCIAL_COMPONENT_DEPENDS_ON_AN_UNRESOLVED_CLIENT', 'OPERATIONAL_IDENTITY_SCOPE_MISMATCH', 'POSSIBLE_PAY0_DUPLICATE', 'WALLET_POSTING_REQUIRES_OPERATION_TYPE']) {
    assert.doesNotMatch(display.reasonEs(code), /[A-Z]{3,}_[A-Z]{3,}/, 'no internal code in the text: ' + code);
  }
});

check('groups are named after the person, never by internal id', () => {
  assert.equal(display.groupLabel('iq-group-rr'), 'RR (BETELL)');
  assert.equal(display.groupLabel('iq-group-pay0'), 'PAY0 (EBASOR)');
  assert.equal(display.groupLabel('other'), 'Grupo desconocido');
});

check('attachDisplay adds the data only to reviews whose IQ row is known', () => {
  const index = new Map([['PAYMENT:237159', display.displayFromIqRow('PAYMENT', { client: 'GRUPO INTERNACIONAL AYEKAN', amount: 200000 })]]);
  const reviews = [
    { entityType: 'PAYMENT', iqEntityId: '237159', canonicalGroupId: 'iq-group-rr', code: 'A', detail: '', evidence: { operation: 'CLIENT_REVIEW_REQUIRED' } },
    { entityType: 'PAYMENT', iqEntityId: '999', canonicalGroupId: 'iq-group-rr', code: 'A', detail: '', evidence: {} },
  ];
  const out = display.attachDisplay(reviews, index);
  assert.equal(out[0].evidence.display.clientName, 'GRUPO INTERNACIONAL AYEKAN');
  assert.equal(out[0].evidence.operation, 'CLIENT_REVIEW_REQUIRED');
  assert.equal(out[1].evidence.display, undefined);
  const posting = display.attachDisplay([{ entityType: 'PAYMENT_POSTING', iqEntityId: '237159', canonicalGroupId: 'iq-group-rr', code: 'WALLET_POSTING_REQUIRES_OPERATION_TYPE', detail: '', evidence: {} }], index);
  assert.equal(posting[0].evidence.display.clientName, 'GRUPO INTERNACIONAL AYEKAN', 'a deposit pending its wallet posting is the same IQ deposit');
});

// ---- the window reaches back to the oldest open review
const win = (start, end) => ({ start, end, timezone: TZ });
const now = new Date('2026-11-23T12:30:00Z'); // 06:30 in Mexico City, 2026-11-23

check('window widens back to the oldest open review', () => {
  assert.deepEqual(domain.widenWindowForOpenReviews(win('2026-11-22', '2026-11-23'), '2026-11-21', now), win('2026-11-21', '2026-11-23'));
});

check('window never moves forward and ignores a missing or invalid date', () => {
  assert.deepEqual(domain.widenWindowForOpenReviews(win('2026-11-22', '2026-11-23'), '2026-11-23', now), win('2026-11-22', '2026-11-23'));
  assert.deepEqual(domain.widenWindowForOpenReviews(win('2026-11-22', '2026-11-23'), null, now), win('2026-11-22', '2026-11-23'));
  assert.deepEqual(domain.widenWindowForOpenReviews(win('2026-11-22', '2026-11-23'), 'not-a-date', now), win('2026-11-22', '2026-11-23'));
});

check('window is capped at 10 days before today', () => {
  assert.equal(domain.DAILY_SYNC_MAX_REVIEW_LOOKBACK_DAYS, 10);
  assert.deepEqual(domain.widenWindowForOpenReviews(win('2026-11-22', '2026-11-23'), '2026-09-01', now), win('2026-11-13', '2026-11-23'));
});

console.log(JSON.stringify({ status: 'PASS', checks }));
