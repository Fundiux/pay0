'use strict';
// Pure test: when the daily sync links a PAY0 client to an IQ client by exact RFC, and when it must not.
//   npm --prefix functions run build && node qa/scripts/iq-daily-sync-client-links.test.cjs
const assert = require('node:assert/strict');
const { planClientLinks } = require('../../functions/lib/modules/iqDailySync/clientLinks.js');

let checks = 0;
const check = (name, fn) => { fn(); checks += 1; console.log('ok', name); };

const EBASOR = 'Ab4z0RttIqXbZFT0NuWsDjBkt6J2';
const BETELL = 'lcOz4nO5DTbksM3Lbz3hJcCpCdu1';
const PAY0_PROFILE = 'bEGPMuplqNHMZ3lvYkeb';
const RR_PROFILE = 'Q3TaFdNTdR2mLPh7KcTi';
const BETELL_PROFILE = 'LxyRRZrJsAYoiAU62scb';

const iq = (id, rfc, over = {}) => ({ kind: 'CLIENT', id, profileId: PAY0_PROFILE, raw: { id, name: 'CLIENTE ' + id, rfc, ...(over.raw || {}) }, inRange: false, ...over });
const pay0 = (id, rfc, over = {}) => ({ collection: 'clients', id, data: { rfc, name: 'PAY0 ' + id, adminId: EBASOR, active: true, ...over } });
const plan = (iqRows, pay0Rows, groupId = 'iq-group-pay0') => planClientLinks({ groupId, iqRows, pay0Rows });

check('links the one PAY0 client with the same RFC and owner', () => {
  const links = plan([iq('502', 'GIA230810TD6')], [pay0('c1', 'GIA230810TD6')]);
  assert.equal(links.length, 1);
  assert.equal(links[0].pay0ClientId, 'c1');
  assert.equal(links[0].iqClientId, '502');
  assert.equal(links[0].ownerAdminId, EBASOR);
  assert.equal(links[0].profileId, PAY0_PROFILE);
  assert.equal(links[0].profileAlias, 'PAY0');
});

check('the RR group links to a BETELL client, also when IQ was read through the BETELL login', () => {
  const rows = [iq('5025', 'GIA230810TD6', { profileId: BETELL_PROFILE })];
  const links = plan(rows, [pay0('ayekan', 'GIA230810TD6', { adminId: BETELL })], 'iq-group-rr');
  assert.equal(links.length, 1);
  assert.equal(links[0].ownerAdminId, BETELL);
  assert.equal(links[0].profileId, RR_PROFILE);
  assert.equal(links[0].profileAlias, 'RR');
});

check('the RFC is compared ignoring case and spaces', () => {
  assert.equal(plan([iq('502', ' gia230810td6 ')], [pay0('c1', 'GIA230810TD6')]).length, 1);
});

check('a client of another owner is never linked', () => {
  assert.deepEqual(plan([iq('502', 'GIA230810TD6')], [pay0('c1', 'GIA230810TD6', { adminId: BETELL })]), []);
  assert.deepEqual(plan([iq('5025', 'GIA230810TD6')], [pay0('c1', 'GIA230810TD6', { adminId: EBASOR })], 'iq-group-rr'), []);
  assert.deepEqual(plan([iq('502', 'GIA230810TD6')], [pay0('c1', 'GIA230810TD6', { adminId: undefined })]), []);
});

check('several PAY0 clients with the same RFC are left for a person', () => {
  assert.deepEqual(plan([iq('502', 'GIA230810TD6')], [pay0('c1', 'GIA230810TD6'), pay0('c2', 'GIA230810TD6')]), []);
});

check('two IQ clients with the same RFC are left for a person', () => {
  assert.deepEqual(plan([iq('502', 'GIA230810TD6'), iq('503', 'GIA230810TD6')], [pay0('c1', 'GIA230810TD6')]), []);
});

check('generic and empty RFCs are never used', () => {
  assert.deepEqual(plan([iq('1', 'XAXX010101000')], [pay0('c1', 'XAXX010101000')]), []);
  assert.deepEqual(plan([iq('1', 'XEXX010101000')], [pay0('c1', 'XEXX010101000')]), []);
  assert.deepEqual(plan([iq('1', '')], [pay0('c1', '')]), []);
});

check('no PAY0 client with that RFC: nothing to link (the client is created instead)', () => {
  assert.deepEqual(plan([iq('502', 'GIA230810TD6')], [pay0('c1', 'ZZZ010101AAA')]), []);
});

check('a client already linked to this IQ client needs nothing; one linked to another IQ client is left alone', () => {
  assert.deepEqual(plan([iq('502', 'GIA230810TD6')], [pay0('c1', 'GIA230810TD6', { iqClientId: '502' })]), []);
  assert.deepEqual(plan([iq('502', 'GIA230810TD6')], [pay0('c1', 'GIA230810TD6', { iqLink: { clientId: '999', status: 'LINKED' } })]), []);
  assert.deepEqual(plan([iq('502', 'GIA230810TD6')], [pay0('c1', 'GIA230810TD6', { iqLinksByProfile: { x: { clientId: '999' } } })]), []);
});

check('another PAY0 client already linked to this IQ client means it is already matched', () => {
  assert.deepEqual(plan([iq('502', 'GIA230810TD6')], [pay0('c1', 'GIA230810TD6'), pay0('c2', 'OTR010101AAA', { iqClientId: '502' })]), []);
});

check('deleted and merged twins do not count; a live client is still linked', () => {
  const rows = [pay0('c1', 'GIA230810TD6'), pay0('gone', 'GIA230810TD6', { isDeleted: true }), pay0('merged', 'GIA230810TD6', { mergedInto: 'c1', mergeStatus: 'MERGED' })];
  const links = plan([iq('502', 'GIA230810TD6')], rows);
  assert.equal(links.length, 1);
  assert.equal(links[0].pay0ClientId, 'c1');
});

check('only clients of the group profiles are considered', () => {
  assert.deepEqual(plan([iq('502', 'GIA230810TD6', { profileId: RR_PROFILE })], [pay0('c1', 'GIA230810TD6')], 'iq-group-pay0'), []);
  assert.deepEqual(plan([iq('502', 'GIA230810TD6')], [pay0('c1', 'GIA230810TD6')], 'iq-group-unknown'), []);
});

check('rows that are not clients, and non-client PAY0 collections, are ignored', () => {
  assert.deepEqual(plan([{ kind: 'PAYMENT', id: '9', profileId: PAY0_PROFILE, raw: { rfc: 'GIA230810TD6' }, inRange: true }], [pay0('c1', 'GIA230810TD6')]), []);
  assert.deepEqual(plan([iq('502', 'GIA230810TD6')], [{ collection: 'solicitudes', id: 's1', data: { rfc: 'GIA230810TD6', adminId: EBASOR } }]), []);
});

console.log(JSON.stringify({ status: 'PASS', checks }));
