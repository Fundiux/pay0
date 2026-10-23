const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const esbuild = require('esbuild');

const source = fs.readFileSync('src/lib/telegramMiniApp.ts', 'utf8');
const compiled = esbuild.transformSync(source, { loader: 'ts', format: 'cjs' }).code;

function setup(app) {
  const module = { exports: {} };
  const document = { documentElement: { dataset: {} } };
  const window = app ? { Telegram: { WebApp: app } } : {};
  const context = { module, exports: module.exports, window, document, setTimeout, clearTimeout };
  vm.runInNewContext(compiled, context);
  return { api: module.exports, document };
}

test('fullscreen is requested once and only confirmed by client state', () => {
  const calls = [];
  const events = new Map();
  const app = {
    initData: 'signed', version: '8.0', isFullscreen: false,
    ready: () => calls.push('ready'), expand: () => calls.push('expand'),
    requestFullscreen: () => calls.push('request'),
    onEvent: (name, callback) => events.set(name, callback),
    offEvent: (name) => events.delete(name),
  };
  const { api, document } = setup(app);
  const stop = api.initTelegramMiniAppShell();
  assert.deepEqual(calls, ['ready', 'expand', 'request']);
  assert.equal(document.documentElement.dataset.matFullscreen, 'false');
  app.isFullscreen = true;
  events.get('fullscreenChanged')();
  assert.equal(document.documentElement.dataset.matFullscreen, 'true');
  api.initTelegramMiniAppShell()();
  assert.equal(calls.filter((value) => value === 'request').length, 1);
  stop();
  assert.equal(events.size, 0);
});

test('unsupported client and rejected fullscreen keep the shell available', () => {
  for (const version of ['7.0', '8.0']) {
    let expanded = 0;
    const app = { initData: 'signed', version, ready() {}, expand() { expanded++; },
      requestFullscreen() { throw Error('unsupported'); } };
    const { api, document } = setup(app);
    api.initTelegramMiniAppShell()();
    assert.equal(expanded, 1);
    assert.equal(document.documentElement.dataset.matFullscreen, 'false');
  }
});

test('browser without Telegram stays available', () => {
  const { api } = setup(null);
  assert.equal(api.getTelegramWebApp(), null);
  api.initTelegramMiniAppShell()();
});

test('native controls are gated by Telegram API version', () => {
  const { api } = setup(null);
  assert.equal(api.supportsTelegramVersion({ version: '6.0' }, '6.1'), false);
  assert.equal(api.supportsTelegramVersion({ version: '6.1' }, '6.1'), true);
  assert.equal(api.supportsTelegramVersion({ version: '7.9' }, '8.0'), false);
  assert.equal(api.supportsTelegramVersion({ version: '8.0' }, '8.0'), true);
});
