// Real Clientes page and Modal in Chromium with callable mocks; no Firebase or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { chromium, expect } = require('@playwright/test');

const transpile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
  target: ts.ScriptTarget.ES2020, esModuleInterop: true,
} }).outputText;

async function run() {
  const pageCode = transpile('src/app/clientes/page.tsx');
  const modalCode = transpile('src/components/Modal.tsx');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<button id="outside">Fuera</button><div id="root"></div>');
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve('react')), 'umd/react.development.js') });
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve('react-dom')), 'umd/react-dom.development.js') });
    await page.evaluate(({ pageCode, modalCode }) => {
      const icon = () => React.createElement('svg');
      const modalExports = {};
      new Function('require', 'exports', modalCode)(name => {
        if (name === 'react') return React;
        if (name === 'lucide-react') return { X: icon };
        throw new Error(`Unexpected Modal dependency: ${name}`);
      }, modalExports);
      window.repairCalls = 0;
      window.resolveRepair = null;
      const serviceMocks = {
        repairClientNumbersByAdminMutation: () => {
          window.repairCalls += 1;
          return new Promise(resolve => { window.resolveRepair = resolve; });
        },
        saveClientMutation: async () => ({}), syncIqClientMutation: async () => ({}), toggleClientActiveMutation: async () => ({}),
      };
      const pageExports = {};
      new Function('require', 'exports', pageCode)(name => {
        if (name === 'react') return React;
        if (name === 'next/link') return { __esModule: true, default: props => React.createElement('a', props) };
        if (name === '@/components/Modal') return { __esModule: true, default: modalExports.default };
        if (name === '@/lib/auth') return { useAuth: () => ({ user: { uid: 'qa-admin' } }) };
        if (name === '@/lib/useUserProfile') return { useUserProfile: () => ({ profile: { role: 'ADMIN', modules: { clientes: { view: true, create: true, edit: true, costs: true } } }, loading: false }) };
        if (name === '@/lib/roles') return {
          normalizeRole: value => String(value || '').toUpperCase(), isSuperAdmin: () => false,
          isAdmin: value => value === 'ADMIN', isOperador: () => false,
          mergeModules: () => ({ clientes: { view: true, create: true, edit: true, costs: true } }),
        };
        if (name === 'lucide-react') return new Proxy({}, { get: () => icon });
        if (name === '@/services/clientMutations') return serviceMocks;
        if (name === '@/services/clients') return { listScopedClients: () => () => {} };
        if (name === '@/services/clientCsf') return { finalizeClientCsfIntake: async () => ({}), parseClientCsfFile: async () => ({}) };
        if (name === '@/lib/uploadEntityDocument') return { uploadEntityDocument: async () => ({}) };
        if (name === '@/services/telegram') return {
          createClientTelegramLinkToken: async () => ({}), getClientTelegramLinkStatus: async () => ({}), unlinkClientTelegramAccount: async () => ({}),
        };
        throw new Error(`Unexpected Clientes dependency: ${name}`);
      }, pageExports);
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(pageExports.default));
    }, { pageCode, modalCode });

    const opener = page.getByRole('button', { name: 'Reparar C00' });
    await expect(opener).toBeVisible();
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Reparar C00', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancelar', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Cerrar', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Cancelar', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();

    await opener.click();
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(opener).toBeFocused();

    await opener.click();
    await dialog.evaluate(element => element.parentElement.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();

    await opener.click();
    await dialog.getByRole('button', { name: 'Reparar', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Cancelar', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Cerrar', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await dialog.evaluate(element => element.parentElement.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    await expect(dialog).toBeVisible();
    assert.equal(await page.evaluate(() => window.repairCalls), 1);
    await page.evaluate(() => window.resolveRepair());
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();

    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await opener.click();
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(opener).toBeFocused();
    }

    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, component: 'Clientes confirmations', keyboard: true,
      focusRestore: true, backdrop: true, busyProtection: true, oneAction: true,
      viewports: [320, 390, 768, 1440] }));
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
