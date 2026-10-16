const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { chromium, expect } = require('@playwright/test');
const ts = require('typescript');
(async () => {
 const browser = await chromium.launch({ headless: true });
 try {
  const page = await browser.newPage({ viewport: { width: 320, height: 640 }, reducedMotion: 'reduce' });
  await page.route('http://localhost/loading-test', route => route.fulfill({ contentType:'text/html', body:'<html><body><div id="root"></div></body></html>' }));
  await page.goto('http://localhost/loading-test');
  const css = await require('postcss')([require('@tailwindcss/postcss')()]).process('@import "tailwindcss" source(none); @source "../../src/components/GlobalLoading.tsx";', { from: path.resolve('qa/scripts/loading-preview.css') });
  await page.addStyleTag({ content: css.css });
  for (const name of ['react','react-dom']) await page.addScriptTag({ path: path.join(path.dirname(require.resolve(name)), `umd/${name}.development.js`) });
  const source = 'import * as React from "react";\n' + fs.readFileSync('src/components/GlobalLoading.tsx','utf8').replace('<style jsx>', '<style>');
  const js = ts.transpileModule(source, { compilerOptions: { module:ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.React, esModuleInterop:true } }).outputText;
  await page.evaluate(js => {
   const exports = {}; new Function('require','exports',js)(() => window.React,exports);
   function Driver() { window.loading = exports.useGlobalLoading(); return null; }
   window.ReactDOM.createRoot(document.getElementById('root')).render(window.React.createElement(exports.GlobalLoadingProvider,null,window.React.createElement(Driver)));
  }, js);
  await page.waitForFunction(() => window.loading);
  await page.evaluate(() => window.loading.show());
  await expect(page.getByRole('status')).toHaveText('CARGANDO…');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.evaluate(() => window.loading.update({ progress:42, helper:'Subiendo documento' }));
  await expect(page.getByRole('progressbar')).toHaveAttribute('value','42');
  await expect(page.getByText('Subiendo documento')).toBeVisible();
  assert.equal(await page.locator('.pay0-bounceball').evaluate(el => getComputedStyle(el,'::before').animationName), 'none');
  await page.evaluate(() => window.loading.update({ progress:null }));
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.evaluate(() => window.loading.update({ progress:Infinity }));
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.evaluate(() => window.loading.update({ progress:120 }));
  await expect(page.getByRole('progressbar')).toHaveAttribute('value','100');
  await page.evaluate(() => window.loading.update({ label:'Preparando documentos para compartir', helper:'Espera a que termine la operación.' }));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  const output = path.resolve('output/engineering-ui'); fs.mkdirSync(output, { recursive:true });
  await page.screenshot({ path:path.join(output,'loading-mobile.png') });
  await page.setViewportSize({ width:1440,height:900 });
  await page.screenshot({ path:path.join(output,'loading-desktop.png') });
  await page.evaluate(() => window.loading.hide());
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.evaluate(async () => { try { await window.loading.run({}, () => { throw Error('Expected failure'); }); } catch {} });
  await expect(page.getByRole('status')).toHaveCount(0);
  console.log('PASS GlobalLoading real provider: Spanish, explicit progress, null/nonfinite reset, helper, reduced motion, cleanup on failure');
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
