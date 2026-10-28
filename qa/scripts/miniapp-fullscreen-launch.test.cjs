const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('config/hosting-miniapp/fullscreen-launch.js', 'utf8');

test('both bot entry pages load the same fullscreen launcher', () => {
  for (const scope of ['usuarios', 'clientes']) {
    const html = fs.readFileSync(`config/hosting-miniapp/mat/${scope}.html`, 'utf8');
    assert.match(html, new RegExp(`data-mat-scope="${scope}"`));
    assert.match(html, /src="https:\/\/telegram\.org\/js\/telegram-web-app\.js"/);
    assert.match(html, /src="\/fullscreen-launch\.js"/);
  }
});

function launch(scope, app) {
  const events = new Map();
  const calls = [];
  let timeout;
  const context = {
    URL,
    document: { documentElement: { dataset: { matScope: scope } } },
    location: {
      search: '?v=1',
      hash: '#tgWebAppData=signed',
      replace: (url) => calls.push(['navigate', url]),
    },
    window: { Telegram: app ? { WebApp: app } : undefined },
    setTimeout: (callback) => { timeout = callback; },
  };
  if (app) app.onEvent = (name, callback) => events.set(name, callback);
  vm.runInNewContext(source, context);
  return { calls, events, runTimeout: () => timeout?.() };
}

test('fullscreen is requested before opening the existing Usuarios app', () => {
  const app = {
    initData: 'signed', isFullscreen: false,
    ready() { this.calls.push('ready'); },
    expand() { this.calls.push('expand'); },
    requestFullscreen() { this.calls.push('fullscreen'); },
    calls: [],
  };
  const result = launch('usuarios', app);
  assert.deepEqual(app.calls, ['ready', 'expand', 'fullscreen']);
  assert.equal(result.calls.length, 0);
  app.isFullscreen = true;
  result.events.get('fullscreenChanged')();
  assert.equal(result.calls[0][0], 'navigate');
  assert.match(result.calls[0][1], /^https:\/\/pay0-next16--pay-0-system\.us-central1\.hosted\.app\/mat\/usuarios\?v=1#tgWebAppData=signed$/);
  result.runTimeout();
  assert.equal(result.calls.length, 1);
});

test('Clientes falls back to its existing app when Telegram is unavailable', () => {
  const result = launch('clientes');
  assert.equal(result.calls[0][0], 'navigate');
  assert.match(result.calls[0][1], /\/mat\/clientes\?v=1#tgWebAppData=signed$/);
});
