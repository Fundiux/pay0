const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const ts = require('typescript');
const { chromium, expect } = require('@playwright/test');
const { createEvaluationReader } = require('./remediation-ocr-quota.test.cjs');

async function run() {
  const reader = createEvaluationReader();
  const text = 'BBVA\nMonto: 100 MXN\nFecha: 2026-10-16\nBeneficiario: EMPRESA SINTETICA';
  const receipt = reader.semantic(text, reader.parse(text));
  const source = 'import * as React from "react";\n' + fs.readFileSync('src/components/pagos/ReceiptEvidenceSummary.tsx', 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => route.request().url() === 'http://localhost/receipt-evidence'
      ? route.fulfill({ contentType: 'text/html', body: '<html lang="es"><body><div id="root"></div></body></html>' }) : route.abort());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://localhost/receipt-evidence');
    const cssDirectory = '.next/static/css';
    if (fs.existsSync(cssDirectory)) for (const name of fs.readdirSync(cssDirectory).filter(name => name.endsWith('.css'))) {
      await page.addStyleTag({ content: fs.readFileSync(path.join(cssDirectory, name), 'utf8') });
    }
    await page.addStyleTag({ content: 'body { margin: 0; padding: 16px; background: #020617; color: #f1f5f9; font-family: Arial, sans-serif; }' });
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve('react')), 'umd/react.development.js') });
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve('react-dom')), 'umd/react-dom.development.js') });
    await page.evaluate(({ code, receipt }) => {
      const exports = {}; new Function('require', 'exports', code)(() => window.React, exports);
      window.ReactDOM.createRoot(document.getElementById('root')).render(window.React.createElement(exports.default, { receipt }));
    }, { code, receipt });
    const section = page.getByRole('region', { name: 'Resultado de lectura del comprobante' });
    await expect(section).toBeVisible();
    await expect(section.getByRole('status')).toContainText('detectados');
    await expect(section.getByRole('status')).toContainText('inferidos');
    await expect(section.getByRole('status')).toContainText('no disponibles');
    await expect(section.getByText('Inferido · revisar', { exact: true }).first()).toBeVisible();
    await expect(section.getByText('No disponible', { exact: true }).first()).toBeVisible();
    await expect(section.getByText('100.00', { exact: true })).toBeVisible();
    await expect(section.getByText('BBVA', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'No horizontal overflow on mobile');
    assert.deepEqual(errors, []);
    fs.mkdirSync('output', { recursive: true });
    await page.screenshot({ path: 'output/receipt-evidence-mobile.png', fullPage: true });
    console.log(JSON.stringify({ ok: true, component: 'ReceiptEvidenceSummary', realParser: true, detectedInferredMissing: true, mobileOverflow: false, externalActions: 0 }));
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
