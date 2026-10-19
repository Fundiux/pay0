const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createRequire } = require('node:module');
const ts = require('../../functions/node_modules/typescript');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !/^demo-pay0-e1-/.test(process.env.GCLOUD_PROJECT || '')) throw Error('Isolated demo emulator required');
const artifactDirectory = process.env.PAY0_CONFIG_ARTIFACT_DIR ? fs.realpathSync(process.env.PAY0_CONFIG_ARTIFACT_DIR) : null;
if (artifactDirectory && !artifactDirectory.startsWith(path.resolve(__dirname, '../../.firebase/modular-release') + path.sep)) throw Error('Private exact artifact required');
const uiRoot = path.resolve(process.env.PAY0_CONFIG_UI_ROOT || path.resolve(__dirname, '../..'));
const artifactRequire = artifactDirectory ? createRequire(path.join(artifactDirectory, 'package.json')) : null;
const admin = artifactRequire ? artifactRequire('firebase-admin') : require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const exportsObject = artifactRequire ? artifactRequire('./lib/modules/paymentApplications/complementAutomation.js') : {};
if (!artifactRequire) {
  const source = fs.readFileSync(path.resolve(__dirname, '../../functions/src/modules/paymentApplications/complementAutomation.ts'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'exports', js)(createRequire(path.resolve(__dirname, '../../functions/lib/modules/paymentApplications/complementAutomation.js')), exportsObject);
}
const configure = exportsObject.configurePaymentComplementAutomation;
async function run() {
  const rootId = 'e1-admin-root', ref = db.doc(`paymentComplementConfigs/${rootId}`);
  await Promise.all([
    db.doc('users/first').set({ rootId, role: 'superadmin', active: true }),
    db.doc('users/second').set({ rootId, role: 'superadmin', active: true }),
    db.doc('users/disabled').set({ rootId, role: 'superadmin', active: false }),
    db.doc('users/operator').set({ rootId, role: 'operador', active: true }),
    db.doc('users/foreign').set({ rootId: 'foreign-root', role: 'superadmin', active: true }),
  ]);
  const call = (uid, data) => configure.run({ auth: { uid, token: {} }, data });
  const activation = admin.firestore.Timestamp.fromMillis(123456);
  await ref.set({ rootId, iqEnabled: false, facturamaEnabled: false, iqLookupEnabled: true, activatedAt: activation });
  await Promise.all([
    call('first', { provider: 'FACTURAMA', enabled: true, confirmation: 'AUTORIZO_REP_AUTOMATICO' }),
    call('second', { provider: 'IQ', enabled: true }),
  ]);
  const enabled = (await ref.get()).data();
  assert.equal(enabled.iqEnabled, true); assert.equal(enabled.facturamaEnabled, true);
  assert.equal(enabled.iqLookupEnabled, true); assert.equal(enabled.activatedAt.toMillis(), 123456);
  await call('second', { provider: 'IQ', enabled: false });
  assert.equal((await ref.get()).get('facturamaEnabled'), true, 'pausing IQ cannot overwrite the other provider');
  for (const uid of ['disabled', 'operator']) await assert.rejects(call(uid, { provider: 'IQ', enabled: true }), error => error.code === 'permission-denied');
  await assert.rejects(configure.run({ data: { provider: 'IQ', enabled: true } }), error => error.code === 'unauthenticated');
  await assert.rejects(call('first', { provider: 'FACTURAMA', enabled: true }), error => error.code === 'failed-precondition');
  for (const data of [{ provider: 'IQ', enabled: true, iqEnabled: false, facturamaEnabled: false }, { provider: 'OTHER', enabled: true }, { provider: 'IQ', enabled: 'true' }, { enabled: true }])
    await assert.rejects(call('first', data), error => error.code === 'invalid-argument');
  await call('foreign', { rootId, provider: 'IQ', enabled: true });
  assert.equal((await ref.get()).get('iqEnabled'), false, 'requested root cannot redirect administrative scope');
  assert.equal((await db.doc('paymentComplementConfigs/foreign-root').get()).get('iqEnabled'), true);
  await call('first', { iqEnabled: false, facturamaEnabled: false });
  assert.equal((await ref.get()).get('facturamaEnabled'), false, 'legacy two-provider contract remains supported');
  const audit = await db.collection('pay0ActivityLog').where('rootId', '==', rootId).get();
  assert.equal(audit.size, 4);
  const { chromium, expect } = require('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const payloads = [];
    await page.exposeFunction('qaConfigure', data => { payloads.push(data); return call('first', data); });
    await page.exposeFunction('qaRead', async () => ({ rows: [], truncated: false, automation: (await ref.get()).data() }));
    await page.route('**/*', route => route.request().url() === 'http://localhost/e1-admin'
      ? route.fulfill({ contentType: 'text/html', body: '<html><body><div id="root"></div></body></html>' }) : route.abort());
    await page.goto('http://localhost/e1-admin');
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve('react')), 'umd/react.development.js') });
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve('react-dom')), 'umd/react-dom.development.js') });
    const component = 'import * as React from "react";\n' + fs.readFileSync(path.join(uiRoot, 'src/components/control-center/PaymentComplementFollowup.tsx'), 'utf8');
    const compiled = ts.transpileModule(component, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    const service = fs.readFileSync(path.join(uiRoot, 'src/services/paymentComplements.ts'), 'utf8');
    const serviceCode = ts.transpileModule(service, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    await page.evaluate(({code, serviceCode}) => {
      window.confirm = () => true;
      const services = {};
      new Function('require', 'exports', serviceCode)(name => {
        if (name === '@/lib/firebaseClient') return { functions: {} };
        if (name === 'firebase/functions') return { httpsCallable: (_functions, callable) => async data => ({ data:
          callable === 'listPaymentComplementFollowup' ? await window.qaRead() :
          callable === 'configurePaymentComplementAutomation' ? await window.qaConfigure(data) : (() => { throw Error('Unexpected callable'); })() }) };
        throw Error('Unexpected service dependency');
      }, services);
      const exports = {}; new Function('require', 'exports', code)(name => name === 'react' ? window.React : services, exports);
      window.ReactDOM.createRoot(document.getElementById('root')).render(window.React.createElement(exports.default));
    }, {code: compiled, serviceCode});
    await expect(page.getByRole('button', { name: 'Facturama: pausado · activar' })).toBeVisible();
    await call('second', { provider: 'FACTURAMA', enabled: true, confirmation: 'AUTORIZO_REP_AUTOMATICO' });
    await page.getByRole('button', { name: 'IQ · nuevas solicitudes: pausado · activar' }).click();
    await expect(page.getByRole('button', { name: 'Facturama: activo · pausar' })).toBeVisible();
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].provider, 'IQ');
    assert.equal('facturamaEnabled' in payloads[0], false);
    assert.equal((await ref.get()).get('facturamaEnabled'), true);
    await page.screenshot({ path: path.join(process.env.TEMP, 'admin-provider-patch.png'), fullPage: true });
  } finally { await browser.close(); }
  assert.equal((await db.collection('paymentComplementJobs').get()).size, 0, 'configuration test cannot enqueue or emit financial operations');
  console.log(JSON.stringify({ result: 'PASS', persistence: 'REAL_ISOLATED_FIRESTORE_EMULATOR', backendMode: artifactDirectory ? 'EXACT_COMPILED_ARTIFACT' : 'CURRENT_SOURCE_TRANSPILED', uiMode: process.env.PAY0_CONFIG_UI_ROOT ? 'EXPLICIT_SOURCE_ROOT' : 'CURRENT_SOURCE', realServiceWrapper: true, concurrentProviderPatches: 2, auditRecords: audit.size, financialJobsCreated: 0 }));
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.terminate());
