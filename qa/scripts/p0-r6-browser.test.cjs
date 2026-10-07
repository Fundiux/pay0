const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const { chromium } = require('@playwright/test');
const { build } = require('esbuild');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const functionsRequire = createRequire(path.resolve('functions/package.json'));
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8088');
const projectId = `demo-pay0-r6-${Date.now().toString(36)}`;
const mocks = {
  '@/lib/firebaseClient': `import { initializeApp } from 'firebase/app'; import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'; export const db=getFirestore(initializeApp({projectId:'${projectId}',apiKey:'synthetic',appId:'synthetic'}));connectFirestoreEmulator(db,'127.0.0.1',8088);`,
  '@/lib/useUserProfile': 'export const useUserProfile=()=>({profile:window.__profile,loading:false});',
  '@/lib/auth': 'export const useAuth=()=>({user:{uid:"u"},loading:false}); export const reauthenticateCurrentUser=async()=>{};export const changeMyPassword=async()=>{};',
  '@/services/loginIdentity': 'export const setMyUsername=async username=>({username});',
  '@/components/UserCommissionDestinations': 'export default function Component(){return null}',
  '@/services/corporateResources': 'export const listCorporateResources=async()=>({resources:[],companies:[]});export const changeCorporateVersion=async()=>{};export const downloadCorporateResource=async()=>{};export const getCorporateResource=async()=>{};export const importCorporateResource=async()=>{};export const prepareCorporateResourceMigration=async()=>{};export const uploadCorporateResource=async()=>{};',
  'next/link': 'import React from "react";export default function Link(p){return React.createElement("a",p,p.children)}',
};
test('restored route components and P0 live hook in two browser tabs preserve filters, pagination, selection and DOM across updates/reconnect', { timeout: 120000 }, async () => {
  const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8088, rules: 'rules_version = "2"; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if true; } } }' } });
  const admin = functionsRequire('firebase-admin'); const app = admin.initializeApp({ projectId }, projectId); const db = app.firestore();
  const { Timestamp } = functionsRequire('firebase-admin/firestore');
  const result = await build({ entryPoints: ['qa/fixtures/p0-r6-browser.jsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'isolated-boundaries', setup(b) {
    b.onResolve({ filter: /^(?:@\/lib\/(?:firebaseClient|useUserProfile|auth)|@\/services\/(?:loginIdentity|corporateResources)|@\/components\/UserCommissionDestinations|next\/link)$/ }, args => ({ path: args.path, namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js', resolveDir: process.cwd() }));
    b.onResolve({ filter: /^@\// }, args => ({ path: path.resolve('src', args.path.slice(2)).replace(/$/, fs.existsSync(path.resolve('src',args.path.slice(2))+'.tsx') ? '.tsx' : '.ts') }));
  } }] });
  const server = http.createServer((req, res) => { if(req.url === '/bundle.js'){ res.setHeader('content-type','application/javascript');res.end(result.outputFiles[0].text); } else {res.setHeader('content-type','text/html');res.end('<div id="root"></div><script>window.__profile={role:new URLSearchParams(location.search).get("role")||"superadmin",rootId:"r",displayName:"Operador Prueba"}</script><script src="/bundle.js"></script>');} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const errors = [], external = [];
    await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.hostname !== '127.0.0.1') { external.push(url.origin); return route.abort(); } return route.continue(); });
    const page = await context.newPage();page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${origin}/?route=/cuenta`); await page.getByRole('heading', { name:'Mi cuenta' }).waitFor();
    await page.goto(`${origin}/?route=/administracion/recursos-corporativos`); await page.getByRole('heading', { name:'Recursos corporativos', exact:true }).waitFor();
    await page.goto(`${origin}/?route=/administracion/recursos-corporativos&role=admin`); await page.getByText('Acceso denegado').waitFor();
    await page.goto(`${origin}/?route=/hugo/evaluation`); await page.getByRole('heading', { name:'Comparación controlada de cerebros' }).waitFor();
    await db.doc('pay0ActivityLog/current').set({rootId:'r',sourceSystem:'PAY0',event:'PAGO_CREADO',actorUid:'u',actorName:'Operador Visible',description:'Evento actual visible',createdAt:Timestamp.fromMillis(2000)});
    await db.doc('activityLog/legacy').set({rootId:'r',event:'SOLICITUD_CREADA',actorUid:'u',actorName:'Operador Anterior',description:'Evento histórico visible',createdAt:Timestamp.fromMillis(1000)});
    await db.doc('activityLog/other-system').set({rootId:'r',event:'ASSET_CREATED',description:'NO MOSTRAR',createdAt:Timestamp.fromMillis(3000)});
    await page.goto(`${origin}/?route=/activity-log`); await page.getByText('Evento actual visible').waitFor(); await page.getByText('Evento histórico visible').waitFor(); assert.equal(await page.getByText('NO MOSTRAR').count(),0);
    for(const kind of ['pagos','solicitudes']){
      for(const [id,time,creator] of [['stable',3000,'selected'],['initial',2000,'selected'],['older',1000,'selected'],['foreign',4000,'other']]) await db.doc(`${kind}/${id}`).set({rootId:'r',createdBy:creator,status:'QUEUED',createdAt:Timestamp.fromMillis(time)});
      const other = await context.newPage();other.on('pageerror',e=>errors.push(e.message));
      await Promise.all([page.goto(`${origin}/?kind=${kind}`),other.goto(`${origin}/?kind=${kind}`)]);
      for(const tab of [page,other]){
        await tab.locator('[data-row="stable"]').waitFor();await tab.getByRole('button',{name:'Cargar otra página'}).click();await tab.locator('[data-row="older"]').waitFor();
        await tab.getByLabel('Seleccionar stable').check();
        await tab.evaluate(()=>{window.originalTable=document.querySelector('table');window.originalRow=document.querySelector('[data-row="stable"]');window.removals=0;new MutationObserver(ms=>{for(const m of ms)for(const n of m.removedNodes)if(n===window.originalRow||n===window.originalTable)window.removals++;}).observe(document.querySelector('main'),{childList:true,subtree:true});});
      }
      await page.evaluate(()=>window.uiTest.create('new'));
      await other.locator('[data-row="new"]').waitFor();
      await db.doc(`${kind}/new`).update({status:'LINKED',[kind==='pagos'?'pagoIqFolio':'solicitudIqFolio']:'IQ-991'});
      for(const tab of [page,other]) await tab.getByText('IQ-991').waitFor();
      await other.getByLabel('Filtro',{exact:true}).fill('stable');
      await other.evaluate(()=>window.uiTest.offline());
      await db.doc(`${kind}/stable`).update({status:'UPDATED'});
      await db.doc(`${kind}/offline-new`).set({rootId:'r',createdBy:'selected',status:'QUEUED',createdAt:Timestamp.fromMillis(6000)});
      await other.evaluate(()=>window.uiTest.online());
      await other.locator('[data-row="stable"]').getByText('UPDATED').waitFor();
      assert.equal(await other.getByLabel('Filtro',{exact:true}).inputValue(),'stable');assert(await other.getByLabel('Seleccionar stable').isChecked());
      await other.getByLabel('Filtro',{exact:true}).fill('');await other.locator('[data-row="offline-new"]').waitFor();
      assert.equal(await other.locator('[data-row="foreign"]').count(),0);assert.equal(await other.locator('[data-row="older"]').count(),1);
      for(const tab of [page,other]) {assert.deepEqual(await tab.evaluate(()=>({sameTable:window.originalTable===document.querySelector('table'),sameRow:window.originalRow===document.querySelector('[data-row="stable"]'),removals:window.removals})),{sameTable:true,sameRow:true,removals:0});assert.equal(await tab.getByRole('alert').textContent(),'');}
      await other.close();
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  } finally { await browser?.close();await new Promise(resolve=>server.close(resolve));await env.cleanup();await app.delete(); }
});
