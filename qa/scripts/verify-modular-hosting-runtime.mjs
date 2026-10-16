// Exercise the exact SSR ZIP, never a development server or substituted source.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { check, sha } from '../../scripts/deploy-modular-hosting.mjs';
import { digest } from '../../scripts/capture-production-baseline.mjs';
import { inspectSource } from '../../scripts/prepare-release-candidate.mjs';

const require = createRequire(import.meta.url);
const JSZip = require('../../functions/node_modules/jszip');
const { chromium, expect } = require('@playwright/test');
const [inputFile, inputSha256] = process.argv.slice(2);
let server, browser;
try {
  const input = check(inputFile, inputSha256);
  const build = JSON.parse(fs.readFileSync(input.buildFile));
  const baseline = JSON.parse(fs.readFileSync(input.baselineFile));
  const frameworkEntry = baseline.functions.ssrpay0system.resource.serviceConfig.environmentVariables.__FIREBASE_FRAMEWORKS_ENTRY__;
  assert.equal(frameworkEntry, 'next.js', 'UNEXPECTED_PRESERVED_FRAMEWORK_ENTRY');
  const cwd = build.cwd;
  assert.equal(inspectSource(cwd).sourceCommit, input.sourceCommit, 'SOURCE_CHANGED');
  const directory = path.join(path.dirname(inputFile), `runtime-${crypto.randomUUID()}`);
  fs.mkdirSync(directory);
  const zip = await JSZip.loadAsync(fs.readFileSync(input.archive));
  for (const entry of Object.values(zip.files)) {
    assert.ok(!entry.name.startsWith('/') && !entry.name.includes('\\') && !entry.name.includes(':')
      && !entry.name.split('/').includes('..') && !/(^|\/)\.env/.test(entry.name), 'UNSAFE_ZIP_ENTRY');
    const target = path.join(directory, entry.name);
    if (entry.dir) fs.mkdirSync(target, { recursive: true });
    else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, await entry.async('nodebuffer')); }
  }
  const install = spawnSync('npm', ['ci', '--omit=dev', '--prefer-offline', '--no-audit', '--no-fund'], {
    cwd: directory, shell: process.platform === 'win32', windowsHide: true, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 300_000,
  });
  fs.writeFileSync(path.join(directory, 'install.log'), (install.stdout || '') + (install.stderr || ''));
  assert.equal(install.status, 0, 'RUNTIME_INSTALL_FAILED');
  const harness = `
    const Module = require('node:module'), path = require('node:path');
    const original = Module._resolveFilename;
    Module._resolveFilename = function(...args) {
      const resolved = original.apply(this, args);
      if (path.isAbsolute(resolved) && !resolved.startsWith(process.cwd() + path.sep)) throw Error('OUTSIDE_ARTIFACT_MODULE');
      return resolved;
    };
    const deny = () => { throw Error('OUTBOUND_NETWORK_FORBIDDEN'); };
    require('node:http').request = deny; require('node:https').request = deny;
    require('node:net').connect = deny; require('node:net').createConnection = deny; global.fetch = deny;
    const handler = require('./server.js').ssrpay0system;
    const server = require('node:http').createServer(handler);
    server.listen(0, '127.0.0.1', () => process.stdout.write('PAY0_PORT=' + server.address().port + '\\n'));
  `;
  const log = fs.openSync(path.join(directory, 'runtime.log'), 'w');
  server = spawn(process.execPath, ['-e', harness], { cwd: directory, windowsHide: true,
    env: { ...process.env, __FIREBASE_FRAMEWORKS_ENTRY__: frameworkEntry, NODE_ENV: 'production', GCLOUD_PROJECT: 'demo-pay0-hosting', FIREBASE_CONFIG: JSON.stringify({ projectId: 'demo-pay0-hosting' }) },
    stdio: ['ignore', 'pipe', log] });
  fs.closeSync(log);
  const port = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(Error('SSR_START_TIMEOUT')), 30_000);
    server.once('exit', () => { clearTimeout(timer); reject(Error('SSR_EXITED')); });
    server.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/PAY0_PORT=(\d+)/);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
  });
  const base = `http://127.0.0.1:${port}`;
  const routes = ['/login', '/pagos', '/solicitudes', '/administracion/recursos-corporativos', '/reportes'];
  const http = [];
  for (const route of routes) {
    const response = await fetch(base + route, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    assert.equal(response.status, 200, `SSR_HTTP_${route}`);
    assert.match(await response.text(), /<html[^>]*lang="es"/);
    http.push({ route, status: response.status });
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  let externalRequestsBlocked = 0;
  await context.route('**/*', route => {
    if (route.request().url().startsWith(base + '/')) return route.continue();
    externalRequestsBlocked++; return route.abort();
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const browserChecks = [];
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + '/login');
    await expect(page.getByRole('heading', { name: 'Bienvenido' })).toBeVisible();
    await expect(page.getByLabel('Usuario o correo electrónico')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Entrar al sistema' })).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'LOGIN_OVERFLOW');
    await page.screenshot({ path: path.join(directory, `login-${width}.png`), fullPage: true });
    browserChecks.push({ route: '/login', width, status: 'PASS' });
  }
  await page.goto(base + '/pagos');
  await expect(page).toHaveURL(/\/login(?:\?|$)/, { timeout: 15_000 });
  assert.deepEqual(errors, [], 'BROWSER_RUNTIME_ERRORS');
  browserChecks.push({ route: '/pagos', anonymousRedirect: '/login', status: 'PASS' });
  const components = [];
  for (const file of ['receipt-evidence-browser.test.cjs', 'document-dossier-browser.test.cjs', 'engineering-control-emulator.test.cjs', 'global-loading-browser.test.cjs', 'modal-accessibility-browser.test.cjs']) {
    const result = spawnSync(process.execPath, [path.join('qa/scripts', file)], { cwd, encoding: 'utf8', windowsHide: true,
      env: { ...process.env, FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:18088' }, maxBuffer: 5 * 1024 * 1024, timeout: 120_000 });
    fs.writeFileSync(path.join(directory, file + '.log'), (result.stdout || '') + (result.stderr || ''));
    assert.equal(result.status, 0, `COMPONENT_FAILED_${file}`);
    components.push({ file, status: 'PASS', scope: 'committed-source-component' });
  }
  assert.equal(inspectSource(cwd).sourceCommit, input.sourceCommit, 'SOURCE_CHANGED_DURING_CHECK');
  check(inputFile, inputSha256);
  const proof = { schema: 'PAY0-MODULAR-HOSTING-RUNTIME@1', status: 'PASS', sourceCommit: input.sourceCommit,
    archiveSha256: input.archiveSha256, hostingManifestSha256: digest(input.hostingFiles), runtimeHttpPassed: true,
    criticalBrowserPassed: true, verifierSha256: sha(fs.readFileSync(import.meta.filename)), http, browserChecks, components, externalRequestsBlocked,
    authenticatedProductionVerification: 'NOT_RUN', financialMutations: 0, checkedAt: new Date().toISOString() };
  const proofFile = path.join(directory, 'proof.json');
  fs.writeFileSync(proofFile, JSON.stringify(proof, null, 2));
  console.log(JSON.stringify({ proofFile, proofSha256: sha(fs.readFileSync(proofFile)), status: 'PASS' }));
} catch (error) {
  console.error(JSON.stringify({ status: 'FAILED', reason: error.message.split('\n')[0] })); process.exitCode = 1;
} finally { await browser?.close(); server?.kill(); }
