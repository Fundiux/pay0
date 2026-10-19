const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const esbuild = require('../../functions/node_modules/esbuild');
const { chromium, expect } = require('@playwright/test');
const root = path.resolve(__dirname, '../..'), output = path.join(root, 'tmp/d2-review-browser');
fs.mkdirSync(output, { recursive: true });
const mocks = {
  '@/lib/useUserProfile': 'export const useUserProfile=()=>({profileUid:window.profile.uid,profile:{rootId:window.profile.rootId,role:window.profile.role,active:window.profile.active}});',
  '@/lib/firebaseClient': 'export const functions={};',
  'firebase/functions': 'export const httpsCallable=(_,name)=>data=>window.callable(name,data);',
};
(async () => {
  await esbuild.build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import View from '@/components/HugoLearningDiagnostics';const root=createRoot(document.getElementById('root'));window.renderProfile=profile=>{window.profile=profile;flushSync(()=>root.render(<View/>));};`, loader: 'tsx', resolveDir: root }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', tsconfigRaw: {}, define: { 'process.env.NODE_ENV': '"development"' }, outfile: path.join(output, 'fixture.js'), plugins: [{ name: 'transport-only', setup(build) {
    build.onResolve({ filter: /.*/ }, args => {
      if (mocks[args.path]) return { path: args.path, namespace: 'fixture' };
      if (args.path.startsWith('@/')) { const base = path.join(root, 'src', args.path.slice(2)); return { path: fs.existsSync(base + '.tsx') ? base + '.tsx' : base + '.ts' }; }
      if (args.path.startsWith('.')) {
        const file = path.resolve(args.resolveDir, args.path);
        for (const candidate of [file, file + '.tsx', file + '.ts', file + '.js', file + '.json', path.join(file, 'index.js')])
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return { path: candidate };
      }
      if (!args.path.startsWith('.') && !path.isAbsolute(args.path)) return { path: require.resolve(args.path, { paths: [args.resolveDir || root, root] }) };
    });
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'js' }));
  } }] });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    await page.evaluate(() => {
      window.calls = []; window.ruleStatus = null;
      const candidate = id => ({ id, revision: 2, state: 'VERIFIED', split: 'TRAIN', domain: 'SOLICITUDES', taskType: 'REASON', features: { entityType: 'SOLICITUD', status: 'PENDIENTE', issueCode: 'DOCUMENT_MISSING' }, expectedBehavior: 'VERIFY_DOCUMENT_BEFORE_DECISION', correctionCode: 'OUTCOME_SUPPORTED_CORRECTION', outcomeType: 'SOLICITUD_COMPLETADA', outcomeAt: '2026-10-01T00:00:00Z', evidence: [{ system: 'HUGO', kind: 'OBSERVATION', id: 'evidence-' + id }], selectionEligible: id !== 'blocked', reasons: id === 'blocked' ? ['EVIDENCE_NOT_VERIFIED'] : [] });
      window.reviewPage = input => {
        const rule = window.ruleStatus ? { id: 'rule-approved', status: window.ruleStatus, version: window.ruleStatus === 'ACTIVE' ? 1 : 2, behavior: 'VERIFY_DOCUMENT_BEFORE_DECISION', supportingIds: ['a', 'b'], supportingRevisions: { a: 2, b: 2 }, approvedBy: 'supervisor', approvedAt: '2026-10-01T00:00:00Z', expiresAt: '2026-10-02T00:00:00Z', expired: false, invalidatedBy: window.ruleStatus === 'INVALIDATED' ? 'HUMAN_REVOKED' : null } : null;
        return { ok: true, mode: 'SUPERVISED_REVIEW', gateStatus: { diagnosticsLocalFlag: false, chat: 'UNKNOWN', review: 'UNKNOWN' }, queriedAt: '2026-10-01T00:00:00Z', limit: 20, candidates: (input.candidateCursor ? ['g'] : ['a', 'b', 'c', 'd', 'e', 'f', 'blocked']).map(candidate), nextCandidateCursor: input.candidateCursor ? null : 'page-next', rules: rule ? [{ ...rule, id: input.ruleCursor ? 'older-rule' : rule.id }] : [], nextRuleCursor: rule && !input.ruleCursor ? 'rules-next' : null, focusedRule: input.focusedRuleId ? rule : null };
      };
      window.callable = async (name, input) => {
        window.calls.push({ name, input, uid: window.profile.uid, rootId: window.profile.rootId });
        if (name === 'listAgent007LearningDiagnostics' && input.mode === 'SUPERVISED_REVIEW') {
          if (window.legacyReview) return { data: { ok: true, boundedTo: 100, experiences: [] } };
          if (window.holdRead) return new Promise(resolve => { window.finishRead = () => resolve({ data: window.reviewPage(input) }); });
          return { data: window.reviewPage(input) };
        }
        if (name === 'listAgent007LearningDiagnostics') return { data: { ok: true, boundedTo: 100, experiences: [{ id: 'legacy', domain: 'SOLICITUDES', taskType: 'REASON', state: 'VERIFIED', revision: 1, trainingEligible: true, reasons: [], outcomeType: 'SOLICITUD_COMPLETADA' }] } };
        if (name === 'listAgent007LearningLineage') return { data: { events: [] } };
        if (name === 'reviewAgent007LearningRule') {
          if (window.rejectReview) throw Error('Revisión pausada por el servidor.');
          if (window.holdReview) return new Promise(resolve => { window.finishReview = () => resolve({ data: { ok: true, ruleId: 'stale-rule', status: 'ACTIVE', version: 1 } }); });
          window.ruleStatus = input.action === 'APPROVE' ? 'ACTIVE' : 'INVALIDATED';
          return { data: { ok: true, ruleId: 'rule-approved', status: window.ruleStatus, version: window.ruleStatus === 'ACTIVE' ? 1 : 2 } };
        }
        throw Error('Unexpected callable: ' + name);
      };
    });
    await page.addScriptTag({ path: path.join(output, 'fixture.js') });
    const profile = { uid: 'supervisor', rootId: 'root-a', role: 'superadmin', active: true };
    await page.evaluate(value => window.renderProfile(value), profile);
    await page.evaluate(() => { window.legacyReview = true; });
    await page.getByRole('button', { name: 'Consultar revisión supervisada', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('no está disponible');
    await expect(page.getByLabel('Seleccionar experiencia a', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Consultar', exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => window.calls.filter(row => row.name === 'reviewAgent007LearningRule').length), 0);
    await page.evaluate(() => { window.legacyReview = false; });
    await page.getByRole('button', { name: 'Consultar revisión supervisada', exact: true }).click();
    await expect(page.getByLabel('Seleccionar experiencia blocked')).toBeDisabled();
    const approve = page.getByRole('button', { name: 'Revisar aprobación', exact: false });
    await expect(approve).toBeDisabled();
    await page.getByLabel('Seleccionar experiencia a', { exact: true }).check();
    await expect(approve).toBeDisabled();
    await page.getByLabel('Seleccionar experiencia b', { exact: true }).check();
    await expect(approve).toBeEnabled();
    for (const id of ['c', 'd', 'e']) await page.getByLabel('Seleccionar experiencia ' + id, { exact: true }).check();
    await expect(page.getByLabel('Seleccionar experiencia f', { exact: true })).toBeDisabled();
    for (const id of ['c', 'd', 'e']) await page.getByLabel('Seleccionar experiencia ' + id, { exact: true }).uncheck();
    await page.getByRole('button', { name: 'Ver evidencia de a', exact: true }).click();
    await expect(page.getByLabel('Evidencia de experiencia')).toContainText('evidence-a');
    await approve.click();
    await expect(page.getByRole('dialog')).toContainText('a, b');
    assert.equal(await page.evaluate(() => window.calls.filter(row => row.name === 'reviewAgent007LearningRule').length), 0);
    await page.getByRole('button', { name: 'Confirmar decisión', exact: true }).click();
    await expect(page.getByText('Estado guardado: ACTIVE', { exact: false })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Revocar regla', exact: true }).click();
    await page.getByRole('button', { name: 'Confirmar decisión', exact: true }).click();
    await expect(page.getByText('Estado guardado: INVALIDATED', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Revocar regla', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Reglas siguientes', exact: true }).click();
    await expect(page.getByText('older-rule · versión 2', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Reglas anteriores', exact: true }).click();
    await expect(page.getByText('rule-approved · versión 2', { exact: true })).toBeVisible();
    await page.getByLabel('Seleccionar experiencia a', { exact: true }).check();
    await page.getByRole('button', { name: 'Experiencias siguientes', exact: true }).click();
    await expect(approve).toHaveText('Revisar aprobación (0/5)');
    await expect(page.getByLabel('Seleccionar experiencia g', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Experiencias anteriores', exact: true }).click();
    await expect(page.getByLabel('Seleccionar experiencia a', { exact: true })).toBeVisible();
    await page.evaluate(() => { window.rejectReview = true; });
    await page.getByLabel('Seleccionar experiencia a', { exact: true }).check();
    await page.getByLabel('Seleccionar experiencia b', { exact: true }).check();
    await approve.click(); await page.getByRole('button', { name: 'Confirmar decisión', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Revisión pausada');
    await expect(page.getByText('Estado guardado: INVALIDATED', { exact: false })).toBeVisible();
    await page.evaluate(() => { window.rejectReview = false; });
    await page.evaluate(() => { window.holdReview = true; });
    await approve.click(); await page.getByRole('button', { name: 'Confirmar decisión', exact: true }).click();
    await page.waitForFunction(() => !!window.finishReview);
    await page.evaluate(value => window.renderProfile(value), { ...profile, uid: 'new-user', rootId: 'root-b' });
    const readsAfterSwitch = await page.evaluate(() => window.calls.filter(row => row.input.mode === 'SUPERVISED_REVIEW').length);
    await page.evaluate(() => window.finishReview());
    await expect(page.getByText('stale-rule', { exact: false })).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.calls.filter(row => row.input.mode === 'SUPERVISED_REVIEW').length), readsAfterSwitch);
    await page.evaluate(() => { window.holdRead = true; });
    await page.getByRole('button', { name: 'Consultar revisión supervisada', exact: true }).click();
    await page.waitForFunction(() => !!window.finishRead);
    await page.evaluate(value => window.renderProfile(value), { ...profile, role: 'admin' });
    await page.evaluate(() => window.finishRead());
    await expect(page.getByRole('button', { name: 'Consultar revisión supervisada', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Consultar', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Consultar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Consultar', exact: true })).toBeEnabled();
    await expect(page.getByRole('cell', { name: 'VERIFIED', exact: true })).toBeVisible();
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, 'legacy-preserved.png'), fullPage: true });
    console.log(JSON.stringify({ status: 'PASS', realComponentAndService: true, transport: 'SYNTHETIC', selectionBounds: true, confirmBeforeMutation: true, canonicalRefresh: true, paginationClearsSelection: true, staleIdentityIgnored: true, legacyPreserved: true }));
    await page.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
