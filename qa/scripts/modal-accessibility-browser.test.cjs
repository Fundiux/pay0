// Real Modal component in Chromium; synthetic content, no Firebase or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { chromium, expect } = require('@playwright/test');

async function run() {
  const source = 'import * as React from "react";\n' + fs.readFileSync('src/components/Modal.tsx', 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
    target: ts.ScriptTarget.ES2020, esModuleInterop: true,
  } }).outputText;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<button id="outside">Abrir</button><div id="root"></div>');
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve('react')), 'umd/react.development.js') });
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve('react-dom')), 'umd/react-dom.development.js') });
    await page.evaluate(code => {
      const exports = {};
      new Function('require', 'exports', code)(name => name === 'react' ? React : { X: () => null }, exports);
      const root = ReactDOM.createRoot(document.getElementById('root'));
      window.closeCalls = [];
      window.renderModals = specs => root.render(React.createElement(React.Fragment, null,
        ...specs.map(spec => React.createElement(exports.default, {
          key: spec.id, open: true, title: spec.untitled ? '' : spec.id,
          ariaLabel: spec.untitled ? 'Importar beneficiarios' : undefined,
          closeOnEscape: !spec.busy, closeOnBackdrop: !spec.busy,
          closeButtonDisabled: !!spec.busy,
          onClose: () => window.closeCalls.push(spec.id),
        }, React.createElement('button', { id: spec.id + '-first', autoFocus: !!spec.autoFocus }, 'Primero'),
        React.createElement('button', { id: spec.id + '-last' }, 'Último')))));
    }, code);
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const render = async specs => { await page.evaluate(specs => window.renderModals(specs), specs); await settle(); };
    const active = () => page.evaluate(() => document.activeElement.id);

    await page.locator('#outside').focus();
    await render([{ id: 'A' }]);
    const dialog = page.getByRole('dialog', { name: 'A', exact: true });
    await expect(dialog).toBeVisible();
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
    await dialog.focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(), 'A-last', 'Shift+Tab from container remains in dialog');
    await dialog.focus();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Cerrar', exact: true })).toBeFocused();
    await page.locator('#A-last').focus();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Cerrar', exact: true })).toBeFocused();

    await page.locator('#A-first').focus();
    await render([{ id: 'A' }, { id: 'B' }]);
    await page.locator('#B-last').focus();
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => window.closeCalls), ['B'], 'Only top modal handles Escape');
    await render([{ id: 'A' }]);
    assert.equal(await active(), 'A-first', 'Closing upper modal restores its opener');
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
    await render([{ id: 'A' }, { id: 'B' }]);
    await page.locator('#B-last').focus();
    await render([{ id: 'B' }]);
    assert.equal(await active(), 'B-last', 'Removing lower modal never steals top focus');
    await render([]);
    assert.equal(await page.evaluate(() => document.body.style.overflow), '', 'Final modal unlocks body');

    await page.locator('#outside').focus();
    await render([{ id: 'busy', busy: true, untitled: true }]);
    const busy = page.getByRole('dialog', { name: 'Importar beneficiarios' });
    await expect(busy.getByRole('button', { name: 'Cerrar', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await busy.evaluate(element => element.parentElement.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    assert.deepEqual(await page.evaluate(() => window.closeCalls), ['B'], 'Busy dialog ignores Escape and backdrop');
    await render([]);
    assert.equal(await active(), 'outside', 'Final close restores original opener');

    await page.locator('#outside').focus();
    await render([{ id: 'autofocus', autoFocus: true }]);
    assert.equal(await active(), 'autofocus-first', 'Child autofocus is preserved');
    await render([]);
    assert.equal(await active(), 'outside', 'Child autofocus must not replace the captured opener');

    // Replace the top dialog in the same commit: old restoration must not steal new focus.
    await render([{ id: 'old' }]);
    await render([{ id: 'new' }]);
    assert.equal(await page.evaluate(() => document.activeElement.closest('[role=dialog]')?.getAttribute('aria-labelledby') === document.querySelector('[role=dialog]')?.getAttribute('aria-labelledby')), true);
    await render([]);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, component: 'Modal', keyboardTrap: true, nestedFocus: true,
      busyCloseProtection: true, bodyLock: true, externalActions: 0 }));
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
