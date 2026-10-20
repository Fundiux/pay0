// Real DateScopeBar component in Chromium; synthetic callbacks, no Firebase or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { chromium, expect } = require('@playwright/test');

async function run() {
  const source = fs.readFileSync('src/components/DateScopeBar.tsx', 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
    target: ts.ScriptTarget.ES2020, esModuleInterop: true,
  } }).outputText;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<button id="outside">Fuera</button><div id="root"></div>');
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve('react')), 'umd/react.development.js') });
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve('react-dom')), 'umd/react-dom.development.js') });
    await page.evaluate(code => {
      const dateScope = {
        formatMonthSpanish: date => [
          'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
          'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
        ][date.getMonth()],
        getScopeLabel: (mode, baseDate, range) => {
          if (mode === 'custom' && range?.start && range?.end) return 'personalizado';
          return `${baseDate.getDate()}/${baseDate.getMonth() + 1}/${baseDate.getFullYear()}`;
        },
      };
      const exports = {};
      new Function('require', 'exports', code)(name => {
        if (name === 'react') return React;
        if (name === 'lucide-react') return { CalendarDays: () => React.createElement('svg') };
        if (name === '@/lib/dateScope') return dateScope;
        throw new Error(`Unexpected dependency: ${name}`);
      }, exports);
      const root = ReactDOM.createRoot(document.getElementById('root'));
      function Harness() {
        const [mode, setMode] = React.useState('day');
        const [range, setRange] = React.useState({});
        const [baseDate, setBaseDate] = React.useState(new Date(2026, 0, 15));
        window.dateScopeState = { mode, range, baseDate: baseDate.toISOString() };
        return React.createElement(exports.default, {
          mode,
          baseDate,
          customRange: range,
          onModeChange: setMode,
          onNavigate: direction => setBaseDate(previous => new Date(previous.getFullYear(), previous.getMonth(), previous.getDate() + direction)),
          onCustomRangeChange: setRange,
        });
      }
      root.render(React.createElement(Harness));
    }, code);

    const trigger = page.getByRole('button', { name: 'Seleccionar periodo personalizado' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Enero 2026' });
    await expect(dialog).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Mes anterior');
    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(trigger).toBeFocused();
    assert.deepEqual(await page.evaluate(() => window.dateScopeState.range), {});

    await trigger.click();
    await page.getByRole('button', { name: /20 de enero de 2026/i }).click();
    await expect(dialog).toBeVisible();
    await page.getByRole('button', { name: /22 de enero de 2026/i }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    assert.deepEqual(await page.evaluate(() => ({
      mode: window.dateScopeState.mode,
      start: new Date(window.dateScopeState.range.start).getDate(),
      end: new Date(window.dateScopeState.range.end).getDate(),
    })), { mode: 'custom', start: 20, end: 22 });

    await trigger.click();
    await page.locator('#outside').click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#outside')).toBeFocused();

    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await trigger.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
    }

    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, component: 'DateScopeBar', keyboardOpen: true,
      escape: true, cancel: true, applyRange: true, focusRestore: true,
      outsideClose: true, viewports: [320, 390, 768, 1440] }));
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
