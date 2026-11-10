const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const domain = require('../../functions/lib/modules/warmCapacity/domain');
const service = require('../../functions/lib/modules/warmCapacity/service');
let checks = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const config = domain.WARM_CAPACITY_CONFIG;

check(JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/warm-capacity.json'), 'utf8')), JSON.parse(JSON.stringify(config)), 'config/warm-capacity.json mirrors the function constant');
check(config.services.length, 23, 'the agreed 23 services');
check(new Set(config.services.map(s => s.name)).size, 23, 'no duplicates');

// Mexico City is UTC-6 all year since 2022 (no DST).
const at = (hh, mm, day = 10) => new Date(Date.UTC(2026, 10, day, hh + 6, mm));
check(domain.desiredMinInstances(at(8, 44), config), 0, '08:44 is still cold');
check(domain.desiredMinInstances(at(8, 45), config), 1, '08:45 opens the window');
check(domain.desiredMinInstances(at(15, 0), config), 1, 'afternoon is warm');
check(domain.desiredMinInstances(at(20, 59), config), 1, '20:59 is warm');
check(domain.desiredMinInstances(at(21, 0), config), 0, '21:00 closes the window');
check(domain.desiredMinInstances(new Date(Date.UTC(2026, 10, 11, 5, 59)), config), 0, '23:59 local is cold');
check(domain.desiredMinInstances(new Date(Date.UTC(2026, 10, 11, 6, 0)), config), 0, 'midnight local is cold');

check(domain.runServiceId({name: 'listPagos', kind: 'function'}), 'listpagos', 'gen2 service ids are lowercase');
check(domain.runServiceId({name: 'pay0-next16', kind: 'appHosting'}), 'pay0-next16', 'App Hosting keeps its id');

const states = [
  {service: {name: 'a', kind: 'function'}, current: 0}, {service: {name: 'b', kind: 'function'}, current: 1},
  {service: {name: 'c', kind: 'function'}, current: null, error: 'RUN_GET_403'},
];
const plan = domain.planScalingChanges(states, 1);
check([plan.patch.map(s => s.service.name), plan.unchanged.map(s => s.service.name), plan.unreadable.map(s => s.service.name)], [['a'], ['b'], ['c']], 'only drift is patched; unreadable is reported, not guessed');
check(domain.planScalingChanges(states, 0).patch.map(s => s.service.name), ['b'], 'closing the window patches only the warm ones');

(async () => {
  const calls = [];
  const fakeFetch = async (url, init = {}) => { calls.push({url, init}); return {ok: true, status: 200, json: async () => ({scaling: {minInstanceCount: 1}})}; };
  const svc = {name: 'listPagos', kind: 'function'};
  check(await service.readMinInstances(config, svc, 'tok', fakeFetch), 1, 'reads service-level scaling');
  check(calls[0].url, 'https://run.googleapis.com/v2/projects/pay-0-system/locations/us-central1/services/listpagos', 'GET the Run service');
  await service.patchMinInstances(config, svc, 0, 'tok', fakeFetch);
  check([calls[1].init.method, calls[1].url.endsWith('?updateMask=scaling.minInstanceCount'), calls[1].init.body], ['PATCH', true, '{"scaling":{"minInstanceCount":0}}'], 'PATCH touches only scaling.minInstanceCount (no template, so no new revision)');
  await assert.rejects(service.patchMinInstances(config, svc, 1, 'tok', async () => ({ok: false, status: 403})), /RUN_PATCH_403/); checks++;
  console.log('WARM CAPACITY OK', checks);
})().catch(error => { console.error(error); process.exit(1); });
