// Real UiSelect and Modal components in Chromium; synthetic state only, no Firebase or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { chromium, expect } = require('@playwright/test');

const transpile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
  target: ts.ScriptTarget.ES2020, esModuleInterop: true,
} }).outputText;

async function run() {
  const uiSelectCode = transpile(fs.readFileSync('src/components/UiSelect.tsx', 'utf8'));
  const modalCode = transpile(`import * as React from "react";\n${fs.readFileSync('src/components/Modal.tsx', 'utf8')}`);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.route('**/*', route => route.abort());
    await page.setContent('<button id="outside">Abrir modal</button><div id="root"></div>');
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve('react')), 'umd/react.development.js') });
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve('react-dom')), 'umd/react-dom.development.js') });
    await page.evaluate(({ uiSelectCode, modalCode }) => {
      const load = (code, dependencies) => {
        const exports = {};
        new Function('require', 'exports', code)(name => {
          if (name === 'react') return React;
          if (name === 'lucide-react') return {
            ChevronDown: () => React.createElement('svg'),
            X: () => React.createElement('svg'),
          };
          if (name === '@/components/Modal') return dependencies.modal;
          if (name === '@/components/UiSelect') return dependencies.uiSelect;
          return { X: () => null };
        }, exports);
        return exports.default;
      };
      const Modal = load(modalCode, {});
      const UiSelect = load(uiSelectCode, { modal: Modal });
      const root = ReactDOM.createRoot(document.getElementById('root'));
      const choices = [
        { value: 'uno', label: 'Uno' },
        { value: 'bloqueado', label: 'Bloqueado', disabled: true },
        { value: 'dos', label: 'Dos' },
        { value: 'tres', label: 'Tres' },
      ];
      const longChoices = Array.from({ length: 30 }, (_, index) => ({ value: `item-${index}`, label: `Elemento ${index}` }));
      function Harness() {
        const [standaloneValue, setStandaloneValue] = React.useState('uno');
        const [scrollValue, setScrollValue] = React.useState('item-0');
        const [modalOpen, setModalOpen] = React.useState(false);
        const [busyOpen, setBusyOpen] = React.useState(false);
        const [modalValue, setModalValue] = React.useState('uno');
        const [formValue, setFormValue] = React.useState('conservado');
        window.uiSelectState = { standaloneValue, scrollValue, modalValue, formValue, modalOpen, busyOpen };
        return React.createElement(React.Fragment, null,
          React.createElement('div', { id: 'standalone' }, React.createElement(UiSelect, {
            value: standaloneValue, onChange: setStandaloneValue, options: choices,
          })),
          React.createElement('div', { id: 'scroll-select' }, React.createElement(UiSelect, {
            value: scrollValue, onChange: setScrollValue, options: longChoices,
          })),
          React.createElement('button', { id: 'open-modal', onClick: () => setModalOpen(true) }, 'Abrir formulario'),
          React.createElement('button', { id: 'open-busy-modal', onClick: () => setBusyOpen(true) }, 'Abrir formulario ocupado'),
          React.createElement(Modal, { open: modalOpen, title: 'Formulario de prueba', onClose: () => setModalOpen(false) },
            React.createElement('input', { id: 'form-value', value: formValue, onChange: event => setFormValue(event.target.value), 'aria-label': 'Campo del formulario' }),
            React.createElement('div', { id: 'modal-select' }, React.createElement(UiSelect, {
              value: modalValue, onChange: setModalValue, options: choices,
            }))),
          React.createElement(Modal, {
            open: busyOpen, title: 'Formulario ocupado', onClose: () => setBusyOpen(false),
            closeOnEscape: false, closeOnBackdrop: false, closeButtonDisabled: true,
          },
          React.createElement('div', { id: 'busy-select' }, React.createElement(UiSelect, {
            value: modalValue, onChange: setModalValue, options: choices,
          })),
          React.createElement('button', { id: 'finish-busy', onClick: () => setBusyOpen(false) }, 'Finalizar prueba')),
        );
      }
      root.render(React.createElement(Harness));
    }, { uiSelectCode, modalCode });

    const standalone = page.locator('#standalone > div > button');
    await standalone.focus();
    await page.keyboard.press('ArrowDown');
    await expect(standalone).toHaveAccessibleName('Dos');
    await expect(standalone).toHaveAttribute('aria-expanded', 'true');
    const standaloneListbox = page.locator('#standalone [role=listbox]');
    await expect(standaloneListbox).toHaveAttribute('aria-labelledby', await standalone.getAttribute('id'));
    await expect(standalone).toHaveAttribute('aria-controls', await standaloneListbox.getAttribute('id'));
    await expect(standaloneListbox.getByRole('option', { name: 'Bloqueado' })).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    await expect(standaloneListbox).toHaveCount(0);
    await expect(standalone).toBeFocused();
    assert.equal(await page.evaluate(() => window.uiSelectState.standaloneValue), 'dos');

    await standalone.press('Enter');
    await expect(standaloneListbox).toBeVisible();
    await standalone.press('Tab');
    await expect(standaloneListbox.getByRole('button', { name: 'Uno' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(standalone).toBeFocused();
    await standalone.press('Escape');
    await standalone.click();
    await standaloneListbox.getByRole('button', { name: 'Tres' }).click();
    await expect(standalone).toHaveAccessibleName('Tres');

    const scrollTrigger = page.locator('#scroll-select > div > button');
    await scrollTrigger.click();
    const scrollListbox = page.locator('#scroll-select [role=listbox]');
    await scrollListbox.evaluate(element => {
      element.style.maxHeight = '80px';
      element.style.overflowY = 'auto';
      element.scrollTop = 120;
    });
    assert.ok(await scrollListbox.evaluate(element => element.scrollTop > 0), 'menu scrolls');
    await page.keyboard.press('Escape');
    await expect(scrollTrigger).toBeFocused();

    await page.locator('#outside').focus();
    await page.locator('#open-modal').click();
    const modal = page.getByRole('dialog', { name: 'Formulario de prueba' });
    await expect(modal).toBeVisible();
    const modalSelect = page.locator('#modal-select > div > button');
    await modalSelect.click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(page.locator('#modal-select [role=listbox]')).toHaveCount(0);
    await expect(modal).toBeVisible();
    await expect(modalSelect).toBeFocused();
    assert.deepEqual(await page.evaluate(() => ({ value: window.uiSelectState.modalValue, field: window.uiSelectState.formValue })), { value: 'dos', field: 'conservado' });
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(page.locator('#open-modal')).toBeFocused();

    await page.locator('#open-busy-modal').click();
    const busyModal = page.getByRole('dialog', { name: 'Formulario ocupado' });
    await expect(busyModal).toBeVisible();
    const busySelect = page.locator('#busy-select > div > button');
    await busySelect.click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#busy-select [role=listbox]')).toHaveCount(0);
    await expect(busyModal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(busyModal).toBeVisible();
    await page.locator('#finish-busy').click();

    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await standalone.click();
      await expect(standaloneListbox).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(standalone).toBeFocused();
    }

    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, component: 'UiSelect', escape: true, modalIsolation: true,
      selectionPreserved: true, busyModal: true, mouseAndKeyboard: true, scroll: true,
      viewports: [320, 390, 768, 1440] }));
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
