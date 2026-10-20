const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const esbuild = require('../../functions/node_modules/esbuild');
const { chromium, expect } = require('@playwright/test');
const workspace = path.resolve(__dirname, '../..');
const root = process.env.PAY0_DOCUMENT_UI_ROOT ? path.resolve(process.env.PAY0_DOCUMENT_UI_ROOT) : workspace;
const output = process.env.PAY0_DOCUMENT_UI_OUTPUT ? path.resolve(process.env.PAY0_DOCUMENT_UI_OUTPUT) : path.join(workspace, 'tmp/document-learning-browser');
assert.ok(root === workspace || root.startsWith(workspace + path.sep), 'UI source must be in the workspace');
assert.ok(output.startsWith(workspace + path.sep), 'QA output must be in the workspace');
fs.mkdirSync(output, { recursive: true });
const mocks = {
  '@/lib/useUserProfile': 'export const useUserProfile=()=>({profileUid:window.profile.uid,profile:{rootId:window.profile.rootId,role:window.profile.role,active:window.profile.active,disabled:window.profile.disabled}});',
  '@/lib/firebaseClient': 'export const functions={};',
  'firebase/functions': 'export const httpsCallable=(_,name)=>data=>window.callable(name,data);',
};
(async () => {
  await esbuild.build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import View from '@/components/hugo/HugoReceiptLearning';const root=createRoot(document.getElementById('root'));window.renderProfile=profile=>{window.profile=profile;flushSync(()=>root.render(<View/>));};`, loader: 'tsx', resolveDir: root }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', tsconfigRaw: {}, define: { 'process.env.NODE_ENV': '"development"' }, outfile: path.join(output, 'fixture.js'), plugins: [{ name: 'transport-only', setup(build) {
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
      window.calls=[]; window.saved=false;
      window.semantic=()=>({schemaVersion:1,fields:{concept:{value:window.saved?'DEMO CORREGIDO':'DEMO ORIGINAL',provenance:window.saved?'HUMAN_CORRECTION':'DETECTED',decision:'REVIEW'}}});
      window.callable=async(name,input)=>{
        window.calls.push({name,input});
        if(name==='parsePagoReceiptPdf') {
          if(window.hold) return new Promise(resolve=>window.finish=()=>resolve({data:{receipt:{warnings:[]},analysisId:'analysis-demo',correctionVersion:0,semanticReceipt:window.semantic()}}));
          return {data:{receipt:{warnings:[]},analysisId:'analysis-demo',correctionVersion:window.legacy?undefined:window.saved?1:0,semanticReceipt:window.semantic()}};
        }
        if(name==='correctPagoReceiptSemanticField'){
          if(window.reject) throw Error('Version obsoleta');
          if(window.holdCorrection)return new Promise(resolve=>window.finishCorrection=()=>resolve({data:{ok:true,semanticReceipt:window.semantic(),correctionVersion:2,receipt:{}}}));
          if(window.invalidAck)return{data:{ok:true,correctionId:'correction-demo',finalResult:{field:'concept',value:'DEMO CORREGIDO',source:'HUMAN_CONFIRMED'},semanticReceipt:window.semantic(),correctionVersion:window.invalidAck==='stale'?0:1,receipt:{}}};window.saved=true;return{data:{ok:true,correctionId:'correction-demo',finalResult:{field:'concept',value:'DEMO CORREGIDO',source:'HUMAN_CONFIRMED'},receipt:{concept:'DEMO CORREGIDO'},semanticReceipt:window.semantic(),correctionVersion:1,learningContext:[]}};
        }
        throw Error('Unexpected endpoint '+name);
      };
    });
    await page.addScriptTag({path:path.join(output,'fixture.js')});
    const profile={uid:'actor-a',rootId:'root-a',role:'superadmin',active:true};
    await page.evaluate(p=>window.renderProfile(p),profile);
    const upload=()=>page.locator('input[type=file]').setInputFiles({name:'demo.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF synthetic transport fixture')});
    await upload();await page.getByRole('button',{name:'Analizar comprobante',exact:true}).click();
    await expect(page.getByText('DEMO ORIGINAL',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Corregir Concepto'}).click();await page.getByRole('textbox',{name:'Concepto',exact:true}).fill('DEMO CORREGIDO');
    await page.evaluate(()=>window.reject=true);await page.getByRole('button',{name:'Guardar',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('Version obsoleta');await expect(page.getByText(/guardada y lectura actualizada\./)).toHaveCount(0);
    await page.evaluate(()=>{window.reject=false;window.invalidAck='stale'});await page.getByRole('button',{name:'Guardar',exact:true}).click();await expect(page.getByLabel(/documental/)).toHaveCount(0);await expect(page.getByRole('alert')).toContainText('No se pudo confirmar');await page.evaluate(()=>window.invalidAck='provenance');await page.getByRole('button',{name:'Guardar',exact:true}).click();await expect(page.getByLabel(/documental/)).toHaveCount(0);await page.evaluate(()=>window.invalidAck=false);await page.getByRole('button',{name:'Guardar',exact:true}).click();
    await expect(page.getByText('DEMO CORREGIDO',{exact:true})).toBeVisible();await expect(page.getByText(/guardada y lectura actualizada\./)).toBeVisible();
    await expect(page.getByLabel(/documental/)).toContainText(/versi.n 1/);await expect(page.getByLabel(/documental/)).toContainText('DEMO CORREGIDO');await expect(page.getByLabel(/documental/)).toContainText('Pulsa Volver');await page.getByRole('button',{name:'Volver a analizar',exact:true}).click();await expect(page.getByText('Se recuperaron tus correcciones',{exact:false})).toBeVisible();await expect(page.getByLabel(/documental/)).toContainText('Verificado al volver');
    await page.evaluate(()=>window.saved=false);await page.getByRole('button',{name:'Volver a analizar',exact:true}).click();await expect(page.getByRole('alert')).toContainText('La nueva lectura no');await expect(page.getByLabel(/documental/)).not.toContainText('Verificado al volver');await page.evaluate(()=>window.saved=true);await page.getByRole('button',{name:'Volver a analizar',exact:true}).click();await expect(page.getByLabel(/documental/)).toContainText('Verificado al volver');
    const correction=await page.evaluate(()=>window.calls.find(c=>c.name==='correctPagoReceiptSemanticField'));
    assert.equal(correction.input.expectedCorrectionVersion,0);assert.equal(correction.input.analysisId,'analysis-demo');
    await page.getByRole('button',{name:'Corregir Concepto'}).click();await page.getByRole('textbox',{name:'Concepto',exact:true}).fill('OTRO CAMBIO');
    await page.evaluate(()=>window.holdCorrection=true);await page.getByRole('button',{name:'Guardar',exact:true}).click();
    await page.waitForFunction(()=>typeof window.finishCorrection==='function');await page.evaluate(p=>window.renderProfile(p),{...profile,uid:'actor-c'});await page.evaluate(()=>{window.finishCorrection();window.holdCorrection=false});
    await expect(page.getByText('OTRO CAMBIO',{exact:true})).toHaveCount(0);await expect(page.getByText(/guardada y lectura actualizada\./)).toHaveCount(0);
    await upload();await page.getByRole('button',{name:'Analizar comprobante',exact:true}).click();await expect(page.getByText('DEMO CORREGIDO',{exact:true})).toBeVisible();
    await page.evaluate(()=>{window.hold=true});await page.getByRole('button',{name:'Volver a analizar',exact:true}).click();
    await page.waitForFunction(()=>typeof window.finish==='function');await page.evaluate(p=>window.renderProfile(p),{...profile,uid:'actor-b',rootId:'root-b'});await page.evaluate(()=>window.finish());
    await expect(page.getByText('DEMO CORREGIDO',{exact:true})).toHaveCount(0);await expect(page.locator('input[type=file]')).toBeVisible();
    const beforeLegacyCorrections=await page.evaluate(()=>window.calls.filter(c=>c.name==='correctPagoReceiptSemanticField').length);
    await page.evaluate(()=>{window.hold=false;window.legacy=true});await upload();await page.getByRole('button',{name:'Analizar comprobante',exact:true}).click();
    await expect(page.getByText('este resultado no permite guardar correcciones',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Corregir Concepto'})).toHaveCount(0);
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='correctPagoReceiptSemanticField').length),beforeLegacyCorrections,'LEGACY_RESPONSE_MUST_NOT_TRIGGER_CORRECTION');
    await page.evaluate(p=>window.renderProfile(p),{...profile,role:'cliente'});await expect(page.locator('input[type=file]')).toHaveCount(0);
    assert.deepEqual([...new Set(await page.evaluate(()=>window.calls.map(c=>c.name)))].sort(),['correctPagoReceiptSemanticField','parsePagoReceiptPdf']);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({status:'PASS',transport:'SYNTHETIC',component:'HugoReceiptLearning',checks:12}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
