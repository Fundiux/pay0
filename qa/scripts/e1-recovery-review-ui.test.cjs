const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../../functions/node_modules/typescript');
const { chromium, expect } = require('@playwright/test');
const sourceRoot = path.resolve(process.env.RECOVERY_UI_SOURCE_ROOT || '.firebase/modular-release/e-recovery-review-ui/source');
const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;

test('candidate wrappers call only the existing review endpoints with cursor and acknowledgement payloads', async () => {
  const calls = [], exports = {};
  const source = fs.readFileSync(path.join(sourceRoot, 'src/services/controlCenter.ts'), 'utf8');
  new Function('require', 'exports', transpile(source))(name => name === 'firebase/functions' ? { httpsCallable: (_client, name) => async data => { calls.push({ name, data }); return { data: { ok: true } }; } } : name.includes('firebaseClient') ? { functions: {} } : { CALLABLES: {} }, exports);
  await exports.listOperationRecoveryReviews();
  await exports.listOperationRecoveryReviews('a'.repeat(64));
  await exports.acknowledgeOperationRecoveryReview({ jobId: 'b'.repeat(64), note: 'Revisar evidencia; sin reintentar.' });
  assert.deepEqual(calls, [
    { name: 'listOperationRecoveryReviews', data: {} },
    { name: 'listOperationRecoveryReviews', data: { cursor: 'a'.repeat(64) } },
    { name: 'acknowledgeOperationRecoveryReview', data: { jobId: 'b'.repeat(64), note: 'Revisar evidencia; sin reintentar.' } },
  ]);
});

test('candidate review UI loads, paginates, records an acknowledgement and exposes retryable errors', async () => {
  const browser = await chromium.launch({ headless: true });
  let reviewed = false, fail = false;
  const calls = [];
  const row = { id: 'a'.repeat(64), solicitudId: 'synthetic-review', kind: 'CERTIFICATE', status: 'NEEDS_REVIEW', attempts: 5, lastErrorCode: 'SYNTHETIC_ERROR', acknowledged: false, acknowledgedBy: null, note: null };
  try {
    const page = await browser.newPage();
    await page.exposeFunction('qaCall', async (name, data) => {
      calls.push({ name, data });
      if (name === 'acknowledgeOperationRecoveryReview') { reviewed = true; return { ok: true, created: true, jobId: data.jobId }; }
      assert.equal(name, 'listOperationRecoveryReviews');
      if (fail) throw Error('Servicio de revisión temporalmente no disponible');
      if (data.cursor) return { ok: true, rows: [{ ...row, id: 'b'.repeat(64), solicitudId: 'synthetic-page-two' }], truncated: false, nextCursor: null };
      return { ok: true, rows: [{ ...row, acknowledged: reviewed, note: reviewed ? 'Revisar evidencia; sin reintentar.' : null }], truncated: true, nextCursor: row.id };
    });
    await page.route('http://localhost/recovery-review-test', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
    await page.goto('http://localhost/recovery-review-test');
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve('react')), 'umd/react.development.js') });
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve('react-dom')), 'umd/react-dom.development.js') });
    const source = 'import * as React from "react";\n' + fs.readFileSync(path.join(sourceRoot, 'src/components/control-center/RecoveryReview.tsx'), 'utf8');
    await page.evaluate(js => {
      const exports = {};
      const services = { listOperationRecoveryReviews: cursor => window.qaCall('listOperationRecoveryReviews', cursor ? { cursor } : {}), acknowledgeOperationRecoveryReview: data => window.qaCall('acknowledgeOperationRecoveryReview', data) };
      new Function('require', 'exports', js)(name => name === 'react' ? window.React : services, exports);
      window.ReactDOM.createRoot(document.getElementById('root')).render(window.React.createElement(exports.default));
    }, transpile(source));
    await page.getByText('Revisión administrativa de recuperaciones', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Registrar revisión sin reintentar' })).toBeDisabled();
    await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
    await expect(page.getByText(/synthetic-page-two/)).toBeVisible();
    await page.getByRole('button', { name: 'Anterior', exact: true }).click();
    await page.getByLabel('Acuerdo de revisión').fill('Revisar evidencia; sin reintentar.');
    await page.getByRole('button', { name: 'Registrar revisión sin reintentar' }).click();
    await expect(page.getByText('Revisión registrada: Revisar evidencia; sin reintentar.', { exact: true })).toBeVisible();
    assert.equal(calls.filter(call => call.name === 'acknowledgeOperationRecoveryReview').length, 1);
    assert.equal(row.status, 'NEEDS_REVIEW');
    fail = true;
    await page.getByRole('button', { name: 'Actualizar incidencias' }).click();
    await expect(page.getByRole('alert')).toContainText('temporalmente no disponible');
    fail = false;
    await page.getByRole('button', { name: 'Actualizar incidencias' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    assert.ok(calls.every(call => ['listOperationRecoveryReviews', 'acknowledgeOperationRecoveryReview'].includes(call.name)));
  } finally { await browser.close(); }
});

test('actual EngineeringControl remounts reviews on uid/root changes and discards in-flight results', async () => {
  const browser = await chromium.launch({ headless: true });
  const lists = [];
  let delayedList, delayedAcknowledgement;
  try {
    const page = await browser.newPage();
    await page.exposeFunction('reviewCall', async (name, data, identity) => {
      if (name === 'acknowledgeOperationRecoveryReview') return new Promise(resolve => { delayedAcknowledgement = resolve; });
      lists.push(identity);
      if (data.delay) return new Promise(resolve => { delayedList = resolve; });
      return { rows: [{ id: 'a'.repeat(64), solicitudId: identity, kind: 'CERTIFICATE', attempts: 1, acknowledged: false }], truncated: false, nextCursor: null };
    });
    await page.route('http://localhost/recovery-context-test', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
    await page.goto('http://localhost/recovery-context-test');
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve('react')), 'umd/react.development.js') });
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve('react-dom')), 'umd/react-dom.development.js') });
    const sources = ['RecoveryReview', 'EngineeringControl'].map(file => transpile('import * as React from "react";\n' + fs.readFileSync(path.join(sourceRoot, `src/components/control-center/${file}.tsx`), 'utf8')));
    await page.evaluate(sources => {
      window.identity = { profileUid: 'actor-a', loading: false, profile: { rootId: 'root-a', role: 'superadmin', active: true } };
      const context = () => `${window.identity.profileUid}/${window.identity.profile.rootId}`;
      const services = { listOperationRecoveryReviews: () => window.reviewCall('listOperationRecoveryReviews', { delay: !!window.delayList }, context()), acknowledgeOperationRecoveryReview: data => window.reviewCall('acknowledgeOperationRecoveryReview', data, context()), getControlCenterEngineering: async () => null };
      const agent = { listAgent007Observations: async () => ({ observations: [] }), listAgent007Traces: async () => ({ traces: [] }) };
      const review = {}, engineering = {};
      new Function('require', 'exports', sources[0])(name => name === 'react' ? window.React : services, review);
      new Function('require', 'exports', sources[1])(name => name === 'react' ? window.React : name === './RecoveryReview' ? review : name === '@/lib/useUserProfile' ? { useUserProfile: () => window.identity } : name === '@/services/controlCenter' ? services : name === '@/services/agent007' ? agent : { __esModule: true, default: props => window.React.createElement('a', props) }, engineering);
      window.recoveryRoot = window.ReactDOM.createRoot(document.getElementById('root'));
      window.renderEngineering = () => window.ReactDOM.flushSync(() => window.recoveryRoot.render(window.React.createElement(engineering.default)));
      window.renderEngineering();
    }, sources);
    await page.getByText('Revisión administrativa de recuperaciones', { exact: true }).click();
    await expect(page.getByText(/actor-a\/root-a/)).toBeVisible();
    await page.evaluate(() => { window.delayList = true; });
    await page.getByRole('button', { name: 'Actualizar incidencias' }).click();
    await expect.poll(() => !!delayedList).toBe(true);
    await page.evaluate(() => { window.delayList = false; window.identity = { profileUid: 'actor-a', loading: false, profile: { rootId: 'root-b', role: 'superadmin', active: true } }; window.renderEngineering(); });
    await page.getByText('Revisión administrativa de recuperaciones', { exact: true }).click();
    await expect(page.getByText(/actor-a\/root-b/)).toBeVisible();
    delayedList({ rows: [{ id: 'f'.repeat(64), solicitudId: 'STALE_ROOT_A', kind: 'CERTIFICATE' }], truncated: false, nextCursor: null });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.getByText(/STALE_ROOT_A/)).toHaveCount(0);
    await page.getByLabel('Acuerdo de revisión').fill('Acuse pendiente');
    await page.getByRole('button', { name: 'Registrar revisión sin reintentar' }).click();
    await expect.poll(() => !!delayedAcknowledgement).toBe(true);
    await page.evaluate(() => { window.identity = { profileUid: 'actor-c', loading: false, profile: { rootId: 'root-b', role: 'superadmin', active: true } }; window.renderEngineering(); });
    await page.getByText('Revisión administrativa de recuperaciones', { exact: true }).click();
    await expect(page.getByText(/actor-c\/root-b/)).toBeVisible();
    delayedAcknowledgement({ ok: true, created: true });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(lists.filter(value => value === 'actor-c/root-b').length, 1);
    await page.evaluate(() => { window.identity.profile.active = false; window.renderEngineering(); });
    await expect(page.getByText('Revisión administrativa de recuperaciones', { exact: true })).toHaveCount(0);
  } finally { await browser.close(); }
});

