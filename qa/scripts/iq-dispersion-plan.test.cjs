'use strict';
// Pure rules to bring a dispersion made in IQ into PAY0 (parse, identify the client, deterministic ids).
//   npm --prefix functions run build && node qa/scripts/iq-dispersion-plan.test.cjs
const assert = require('node:assert/strict');
const plan = require('../../functions/lib/modules/iqDailySync/dispersionPlan.js');

let checks = 0;
const check = (name, fn) => { fn(); checks += 1; console.log('ok', name); };

const EBASOR = 'Ab4z0RttIqXbZFT0NuWsDjBkt6J2';
const BETELL = 'lcOz4nO5DTbksM3Lbz3hJcCpCdu1';
const PAY0_PROFILE = 'bEGPMuplqNHMZ3lvYkeb';
const RR_PROFILE = 'Q3TaFdNTdR2mLPh7KcTi';

// The three dispersions the owner pasted from IQ (2026-11-21).
const rr = { id: 442623, created_at: '2026-11-21T13:26:00-06:00', operation_status: 'Terminada', conciliation_status: 'Sin Conciliar', dispersion_type: 'Transferencia', sale_percentage: '0.0%',
  client: 'GRUPO INTERNACIONAL AYEKAN', beneficiary_name: 'MARIA DEL ROSARIO GONZALEZ GARZA', partner: 'RR', account: 'CLABE: 661610005732587353', bank_name: 'KLAR', currency: 'mxn', total_to_disperse: '$171,464.55' };
const clabe = { id: 442482, created_at: '2026-11-21T10:30:00-06:00', operation_status: 'Terminada', dispersion_type: 'Transferencia', sale_percentage: 0, client: 'CAIT MONTERREY',
  beneficiary_name: 'ALFREDO PEREYRA GUZMAN', partner: 'ELIUT', account: 'CLABE: 002580701012614311', bank_name: 'BANAMEX', currency: 'mxn', amount: '$200,000.00' };
const card = { id: 442458, created_at: '2026-11-21T09:37:00-06:00', operation_status: 'Terminada', dispersion_type: 'Transferencia', sale_percentage: 0, client: 'HEALTHYNUTS SAPI DE CV',
  beneficiary_name: 'RAUL ALFONSO LOPEZ', partner: 'ELIUT', account: 'No. de tarjeta: 4189140098920951', bank_name: 'BANORTE/IXE', currency: 'mxn', amount: '$4,400.00' };

const ok = (raw, group) => { const result = plan.parseIqDispersion(raw, group); assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const bad = (raw, code, group = 'iq-group-pay0') => { const result = plan.parseIqDispersion(raw, group); assert.equal(result.ok, false); assert.equal(result.code, code); };

check('a real RR transfer to a CLABE keeps client, beneficiary, bank, amount and the original date', () => {
  const value = ok(rr, 'iq-group-rr');
  assert.equal(value.iqId, '442623'); assert.equal(value.amount, 171464.55); assert.equal(value.currency, 'MXN');
  assert.equal(value.operationTypeKey, 'TRANSFERENCIA'); assert.deepEqual(value.destination, { kind: 'CLABE', digits: '661610005732587353', bankCode: '661' });
  assert.equal(value.bankName, 'KLAR'); assert.equal(value.beneficiaryName, 'MARIA DEL ROSARIO GONZALEZ GARZA'); assert.equal(value.clientName, 'GRUPO INTERNACIONAL AYEKAN');
  assert.equal(value.date, '2026-11-21'); assert.equal(value.createdAtIso, '2026-11-21T19:26:00.000Z');
  assert.equal(value.salePercentage, 0); assert.equal(value.clientChargeAmount, 0);
});

check('a date without a time zone is Mexico City time, as IQ sends it', () => {
  const value = ok({ ...rr, created_at: '2026-11-21T13:26:00' }, 'iq-group-rr');
  assert.equal(value.createdAtIso, '2026-11-21T19:26:00.000Z');
  assert.equal(value.date, '2026-11-21');
  assert.equal(ok({ ...rr, created_at: '2026-11-21 23:30:00' }, 'iq-group-rr').date, '2026-11-21', 'late evening stays on the same Mexico City day');
  assert.equal(ok({ ...rr, created_at: '2026-11-22T01:00:00Z' }, 'iq-group-rr').date, '2026-11-21', 'an explicit UTC time converts to the Mexico City day');
});

check('a transfer to a card is a transfer with a card destination, as IQ says', () => {
  const value = ok(card, 'iq-group-pay0');
  assert.equal(value.operationTypeKey, 'TRANSFERENCIA'); assert.deepEqual(value.destination, { kind: 'TARJETA', digits: '4189140098920951', bankCode: null }); assert.equal(value.amount, 4400);
  assert.equal(ok(clabe, 'iq-group-pay0').amount, 200000);
});

check('a sale percentage becomes a client commission on the total requested', () => {
  const value = ok({ ...clabe, sale_percentage: '1.5%' }, 'iq-group-pay0');
  assert.equal(value.salePercentage, 1.5); assert.equal(value.clientChargeAmount, 3000);
  assert.equal(ok({ ...card, sale_percentage: '0.6' }, 'iq-group-pay0').clientChargeAmount, 26.4);
  bad({ ...clabe, sale_percentage: 'abc' }, 'DISPERSION_PERCENTAGE_INVALID');
});

check('only a finished dispersion is brought in', () => {
  for (const status of ['EN OPERACION', 'Rechazada', 'Cancelada', 'Devuelta', '']) bad({ ...clabe, operation_status: status }, 'DISPERSION_NOT_FINISHED');
  ok({ ...clabe, operation_status: 'TERMINADA' }, 'iq-group-pay0');
});

check('an account that is incomplete or has a wrong check digit is never used', () => {
  bad({ ...clabe, account: '00001234' }, 'DISPERSION_ACCOUNT_UNREADABLE');
  bad({ ...clabe, account: 'CLABE: 002580701012614312' }, 'DISPERSION_ACCOUNT_UNREADABLE');
  bad({ ...clabe, account: 'CLABE: ****4311' }, 'DISPERSION_ACCOUNT_UNREADABLE');
  bad({ ...clabe, account: '' }, 'DISPERSION_ACCOUNT_UNREADABLE');
});

check('missing or unreadable data is reported with its own reason', () => {
  bad({ ...clabe, id: 'abc' }, 'DISPERSION_ID_INVALID');
  bad({ ...clabe, created_at: 'ayer' }, 'DISPERSION_DATE_INVALID');
  bad({ ...clabe, amount: '', total_to_disperse: undefined }, 'DISPERSION_AMOUNT_INVALID');
  bad({ ...clabe, amount: '$0.00' }, 'DISPERSION_AMOUNT_INVALID');
  bad({ ...clabe, dispersion_type: 'Otra cosa' }, 'DISPERSION_TYPE_UNKNOWN');
  bad({ ...clabe, client: '' }, 'DISPERSION_CLIENT_MISSING');
  bad({ ...clabe, beneficiary_name: '' }, 'DISPERSION_BENEFICIARY_MISSING');
  bad({ ...clabe, dispersion_type: 'Efectivo' }, 'DISPERSION_CASH_NOT_SUPPORTED');
});

check('the CLABE check digit', () => {
  assert.equal(plan.isValidClabe('661610005732587353'), true);
  assert.equal(plan.isValidClabe('002580701012614311'), true);
  assert.equal(plan.isValidClabe('002580701012614312'), false);
  assert.equal(plan.isValidClabe('12345'), false);
});

check('ids and folios are deterministic and never consume PAY0 numbering', () => {
  assert.equal(plan.historicalDispersionFolio('iq-group-rr', '442623'), 'DIQR442623');
  assert.equal(plan.historicalDispersionFolio('iq-group-pay0', '442482'), 'DIQP442482');
  assert.equal(plan.historicalDispersionId('r1', 'iq-group-rr', '1'), plan.historicalDispersionId('r1', 'iq-group-rr', '1'));
  assert.notEqual(plan.historicalDispersionId('r1', 'iq-group-rr', '1'), plan.historicalDispersionId('r1', 'iq-group-pay0', '1'));
  assert.notEqual(plan.historicalDispersionId('r1', 'iq-group-rr', '1'), plan.historicalDispersionId('r2', 'iq-group-rr', '1'));
  assert.match(plan.historicalDispersionId('r1', 'iq-group-rr', '1'), /^iqd_[0-9a-f]{28}$/);
});

check('the destination account id is the one the beneficiary screen uses', () => {
  const clabeDestination = { kind: 'CLABE', digits: '661610005732587353', bankCode: '661' };
  assert.equal(plan.methodDedupeKey(clabeDestination), 'CLABE|661610005732587353');
  assert.equal(plan.methodDedupeKey({ kind: 'TARJETA', digits: '4189140098920951', bankCode: null }), 'CARD|4189140098920951');
  assert.equal(plan.methodDocId('c1', clabeDestination), plan.methodDocId('c1', clabeDestination));
  assert.match(plan.methodDocId('c1', clabeDestination), /^cbm_[0-9a-f]{40}$/);
  assert.notEqual(plan.methodDocId('c1', clabeDestination), plan.methodDocId('c2', clabeDestination));
});

// ---- client identification
const client = (id, over = {}) => ({ collection: 'clients', id, data: { name: 'GRUPO INTERNACIONAL AYEKAN', adminId: BETELL, active: true, iqClientName: 'GRUPO INTERNACIONAL AYEKAN', iqLinksByProfile: { [RR_PROFILE]: { clientId: '5025', status: 'LINKED' } }, ...over } });
const resolve = (rows, name = 'GRUPO INTERNACIONAL AYEKAN', group = 'iq-group-rr') => plan.resolveDispersionClient({ groupId: group, clientName: name, pay0Rows: rows });

check('the client is the one linked to IQ with that name and that owner', () => {
  assert.deepEqual(resolve([client('ayekan')]), { ok: true, clientId: 'ayekan' });
  assert.deepEqual(resolve([client('ayekan')], 'grupo internacional áyekan'), { ok: true, clientId: 'ayekan' }, 'case and accents are ignored');
});

check('a client of another owner, unlinked, inactive or deleted is not used', () => {
  for (const over of [{ adminId: EBASOR }, { iqLinksByProfile: {}, iqLink: undefined }, { active: false }, { isDeleted: true }, { iqLinksByProfile: { [PAY0_PROFILE]: { clientId: '1' } } }]) {
    const result = resolve([client('x', over)]);
    assert.equal(result.ok, false); assert.equal(result.code, 'DISPERSION_CLIENT_NOT_IDENTIFIED');
  }
});

check('two clients with the same name are never guessed', () => {
  const result = resolve([client('a'), client('b')]);
  assert.equal(result.ok, false); assert.equal(result.code, 'DISPERSION_CLIENT_AMBIGUOUS');
});

check('an unknown group has no owner, so nothing is created', () => {
  const result = resolve([client('a')], 'GRUPO INTERNACIONAL AYEKAN', 'iq-group-unknown');
  assert.equal(result.ok, false); assert.equal(result.code, 'DISPERSION_GROUP_UNKNOWN');
});

console.log(JSON.stringify({ status: 'PASS', checks }));
