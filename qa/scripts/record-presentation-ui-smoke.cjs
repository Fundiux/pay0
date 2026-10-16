const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), ts = require('typescript');
const { chromium, expect } = require('@playwright/test');
const files = ['src/components/RecordCreatorFilter.tsx', 'src/components/CompactBalanceCells.tsx'];
async function run() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<html lang="es"><body style="padding:24px"><h1>Solicitudes · importes y usuarios</h1><div id="root"></div></body></html>');
    for (const name of ['react', 'react-dom']) await page.addScriptTag({ path: path.join(path.dirname(require.resolve(name)), `umd/${name}.development.js`) });
    for (const file of fs.readdirSync('.next/static/css').filter(name => name.endsWith('.css'))) await page.addStyleTag({ path: path.resolve('.next/static/css', file) });
    await page.addStyleTag({ content: fs.readFileSync('src/styles/globals.css', 'utf8').replace('@import "tailwindcss";', '') });
    const code = files.map(file => ts.transpileModule('import * as React from "react";\n' + fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText);
    await page.evaluate(compiled => {
      const modules = compiled.map(source => { const exports = {}; new Function('require', 'exports', source)(() => window.React, exports); return exports.default; });
      const [Filter, Balance] = modules, h = window.React.createElement;
      function Fixture() {
        const [creator, setCreator] = window.React.useState('');
        const rows = [{ name: 'Ana Operaciones', uid: 'internal-user-a', amount: 1000, paid: 0, pending: 1000 }, { name: 'Luis Finanzas', uid: 'internal-user-b', amount: 1000, paid: 400, pending: 600 }, { name: 'Ana Operaciones', uid: 'internal-user-a', amount: 1000, paid: 1000, pending: 0 }];
        return h('div', { style: { marginTop: 20 } }, h(Filter, { value: creator, onChange: setCreator, options: [{ uid: 'internal-user-a', displayName: 'Ana Operaciones', username: 'ana' }, { uid: 'internal-user-b', displayName: 'Luis Finanzas', username: 'luis' }] }),
          h('div', { style: { overflowX: 'auto', marginTop: 20 } }, h('table', { className: 'pay0-solicitudes-main-table', style: { tableLayout: 'fixed', width: 850 } }, h('colgroup', null, h('col'), ...['monto', 'abono', 'pendiente'].map(name => h('col', { key: name, className: 'pay0-sol-col-' + name }))), h('thead', null, h('tr', null, ...['Usuario creador', 'Monto', 'Abonado', 'Pendiente'].map(title => h('th', { key: title, className: title === 'Usuario creador' ? '' : 'pay0-balance-heading' }, title)))),
            h('tbody', null, rows.filter(row => !creator || row.uid === creator).map((row, index) => h('tr', { key: row.name + row.paid, 'data-testid': 'record-' + index }, h('td', null, row.name), h(Balance, row)))))),
          h('table', { style: { marginTop: 30 } }, h('tbody', null, h('tr', { 'aria-selected': true }, h('td', { style: { backgroundColor: 'rgb(40, 65, 90)' } }, 'Selección conservada')))));
      }
      window.ReactDOM.createRoot(document.getElementById('root')).render(h(Fixture));
    }, code);
    const filter = page.getByRole('combobox', { name: 'Filtrar por usuario creador' });
    await expect(filter).toBeVisible();
    await expect(page.locator('.pay0-balance-cell')).toHaveCount(9);
    await expect(page.getByText('Parcial', { exact: true })).toBeVisible();
    await expect(page.getByText('Pagado', { exact: true })).toBeVisible();
    assert(!((await page.locator('body').innerText()).includes('internal-user')));
    const monetaryWidth = await page.locator('.pay0-balance-cell').first().evaluate(cell => cell.getBoundingClientRect().width);
    assert(monetaryWidth <= 90, `monetary width ${monetaryWidth}`);
    await page.getByTestId('record-0').hover();
    assert.match(await page.getByTestId('record-0').locator('td').first().evaluate(cell => getComputedStyle(cell).backgroundImage), /linear-gradient/);
    const selected = page.getByText('Selección conservada');
    await selected.hover();
    assert.equal(await selected.evaluate(cell => getComputedStyle(cell).backgroundImage), 'none');
    assert.equal(await selected.evaluate(cell => getComputedStyle(cell).backgroundColor), 'rgb(40, 65, 90)');
    await filter.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await expect(page.locator('.pay0-balance-cell')).toHaveCount(6);
    await filter.selectOption(''); await expect(page.locator('.pay0-balance-cell')).toHaveCount(9);
    await page.keyboard.press('Escape'); await page.locator('h1').click();
    fs.mkdirSync('tmp', { recursive: true });
    await page.screenshot({ path: 'tmp/record-presentation-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 720 });
    await expect(filter).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'mobile uses local table scrolling');
    await page.screenshot({ path: 'tmp/record-presentation-mobile.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, checks: ['human filter', 'keyboard selection/reset', 'three balances', 'partial/paid states', 'compact widths', 'global hover', 'selection preserved', 'mobile overflow', 'no browser errors'], externalActions: 0 }));
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
