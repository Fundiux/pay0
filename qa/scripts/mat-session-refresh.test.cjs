const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ts = require('../../functions/node_modules/typescript');
const { chromium, expect } = require('@playwright/test');
const file = path.resolve(process.env.PAY0_MAT_REFRESH_SOURCE || 'output/mat-session-refresh/source/src/components/mat/useMatHome.ts');
const source = fs.readFileSync(file, 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const kind of ['User', 'Client']) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
      await page.goto('http://localhost/mat-refresh-fixture');
      await page.addScriptTag({ path: path.join(path.dirname(require.resolve('react')), 'umd/react.development.js') });
      await page.addScriptTag({ path: path.join(path.dirname(require.resolve('react-dom')), 'umd/react-dom.development.js') });
      await page.evaluate(({ code, kind }) => {
        window.fixture = { init: 'synthetic-signed-session', actor: '', visibility: 'visible', calls: [], pending: [] };
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => fixture.visibility });
        const auth = { get currentUser() { return fixture.actor ? { uid: fixture.actor } : null; } };
        const request = scope => input => {
          fixture.calls.push({ scope, ...input });
          return new Promise((resolve, reject) => fixture.pending.push({ resolve, reject }));
        };
        const deps = {
          react: React,
          '@/lib/auth': { useAuth: () => ({ user: auth.currentUser }) },
          '@/lib/firebaseClient': { auth },
          '@/lib/telegramMiniApp': { getTelegramInitData: () => fixture.init },
          '@/services/telegramMiniApp': { getMatUserHome: request('USERS'), getMatClientHome: request('CLIENTS') },
        };
        const exports = {};
        new Function('require', 'exports', code)(name => { if (!(name in deps)) throw Error('UNEXPECTED_IMPORT'); return deps[name]; }, exports);
        const View = () => React.createElement('pre', { id: 'state' }, JSON.stringify(exports[`useMat${kind}Home`]()));
        const root = ReactDOM.createRoot(document.getElementById('root'));
        fixture.render = () => root.render(React.createElement(View));
        fixture.unmount = () => root.unmount();
        fixture.render();
      }, { code, kind });
      const state = async () => JSON.parse(await page.locator('#state').textContent());
      await expect.poll(() => page.evaluate(() => fixture.calls.length)).toBe(1);
      assert.equal(await page.evaluate(() => fixture.calls[0].botScope), kind === 'User' ? 'USERS' : 'CLIENTS');
      await page.evaluate(() => fixture.pending.shift().resolve({ linked: true, marker: 'old-home' }));
      await expect.poll(async () => (await state()).home?.marker).toBe('old-home');
      await page.evaluate(() => { fixture.visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); });
      await expect.poll(async () => (await state()).home).toBe(null);
      await page.evaluate(() => { fixture.visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('pageshow')); });
      await expect.poll(() => page.evaluate(() => fixture.calls.length)).toBe(2);
      await page.evaluate(() => fixture.pending.shift().resolve({ linked: false, status: 'UNLINKED' }));
      await expect.poll(async () => (await state()).home?.linked).toBe(false);
      results.push(`${kind}: hidden-clear/revoked-link/debounced-events PASS`);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect.poll(() => page.evaluate(() => fixture.calls.length)).toBe(3);
      await page.evaluate(() => { fixture.actor = 'new-actor'; fixture.render(); });
      await expect.poll(() => page.evaluate(() => fixture.calls.length)).toBe(4);
      await page.evaluate(() => fixture.pending.shift().resolve({ linked: true, marker: 'foreign-old-response' }));
      assert.equal((await state()).home, null);
      await page.evaluate(() => fixture.pending.shift().resolve({ linked: true, marker: 'new-actor-response' }));
      await expect.poll(async () => (await state()).home?.marker).toBe('new-actor-response');
      results.push(`${kind}: actor-switch drops old response PASS`);
      await page.evaluate(() => { fixture.init = ''; window.dispatchEvent(new Event('focus')); });
      await expect.poll(async () => (await state()).mode).toBe('LOCAL');
      assert.equal((await state()).home, null);
      assert.equal(await page.evaluate(() => fixture.calls.length), 4);
      await page.evaluate(() => { fixture.init = 'new-synthetic-session'; window.dispatchEvent(new Event('focus')); });
      await expect.poll(() => page.evaluate(() => fixture.calls.length)).toBe(5);
      await page.evaluate(() => fixture.pending.shift().reject(new Error('synthetic-secret-not-for-logs')));
      await expect.poll(async () => (await state()).error).toMatch(/No se pudo/);
      await page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
      await expect.poll(() => page.evaluate(() => fixture.calls.length)).toBe(6);
      await page.evaluate(() => { fixture.unmount(); fixture.pending.shift().resolve({ marker: 'after-unmount' }); });
      assert.deepEqual(errors, []);
      results.push(`${kind}: missing-session/error/unmount PASS`);
      await page.close();
    }
  } finally { await browser.close(); }
  const proof = { status: 'PASS', sourceSha256: crypto.createHash('sha256').update(source).digest('hex'), results, requests: 'synthetic-wrapper-only', productionReads: 0, productionWrites: 0, limitations: 'Real React hooks and Chromium events; server signature/auth validation is not replaced or certified by this fixture.' };
  fs.mkdirSync('output/mat-session-refresh', { recursive: true });
  fs.writeFileSync('output/mat-session-refresh/verification.json', JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
})().catch(error => { console.error(error); process.exitCode = 1; });
