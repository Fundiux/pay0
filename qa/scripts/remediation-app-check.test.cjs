const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load() {
  const source = fs.readFileSync('src/lib/firebaseAppCheck.ts', 'utf8');
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText}\n})`)(
    name => { throw new Error(`SDK_IMPORT_NOT_ALLOWED:${name}`); }, module, module.exports);
  return module.exports;
}
const config = { mode: 'OBSERVE_ONLY', siteKey: 'public_site_key_for_synthetic_0123456789', useEmulators: false };
function browser(pathname = '/pagos') {
  return { location: { pathname,
    get hash() { throw new Error('HASH_MUST_NOT_BE_READ'); },
    get search() { throw new Error('SEARCH_MUST_NOT_BE_READ'); },
    get href() { throw new Error('HREF_MUST_NOT_BE_READ'); },
  } };
}
function sdk() {
  const stats = { imports: 0, providers: 0, initialized: 0 };
  const value = {
    ReCaptchaEnterpriseProvider: class { constructor(key) { assert.equal(key, config.siteKey); stats.providers++; } },
    initializeAppCheck(app, options) { assert.ok(app); assert.equal(options.isTokenAutoRefreshEnabled, true); stats.initialized++; return {}; },
  };
  return { stats, value, load: async () => { stats.imports++; return value; } };
}
test('SSR disabled configuration and emulator never import SDK', async () => {
  const { initializeBrowserAppCheck: init } = load(); const app = {};
  assert.equal(await init(app, config, null), 'SSR');
  assert.equal(await init(app, { ...config, mode: undefined }, browser()), 'DISABLED');
  assert.equal(await init(app, { ...config, mode: 'ENFORCE' }, browser()), 'DISABLED');
  assert.equal(await init(app, { ...config, siteKey: undefined }, browser()), 'INVALID_CONFIGURATION');
  assert.equal(await init(app, { ...config, useEmulators: true }, browser()), 'EMULATOR');
});
test('exact download and signature/verification route segments are excluded without reading bearer URL fields', async () => {
  const { initializeBrowserAppCheck: init, excludesAppCheckForPath: excludes } = load();
  for (const path of ['/descarga/documento', '/descarga/documento/', '/firma', '/firma/private-bearer', '/verificar/cotizacion/private-bearer', '/verificar/constancia/private-bearer', '/%66irma/bearer', '//verificar//token', '/FIRMA/token', '/bad%escape']) {
    assert.equal(excludes(path), true, path);
    assert.equal(await init({}, config, browser(path)), 'EXCLUDED_PUBLIC_DOCUMENT');
  }
  for (const path of ['/firmamento', '/verificador', '/descarga/documento-extra', '/descarga/documento/extra', '/pagos', '/login']) assert.equal(excludes(path), false, path);
});
test('public document exclusion remains sticky after token removal or SPA navigation', async () => {
  const { initializeBrowserAppCheck: init } = load(); const b = browser('/firma/private-bearer'); const app = {}; const s = sdk();
  assert.equal(await init(app, { ...config, mode: undefined }, b, s.load), 'EXCLUDED_PUBLIC_DOCUMENT');
  b.location.pathname = '/pagos';
  assert.equal(await load().initializeBrowserAppCheck(app, config, b, s.load), 'EXCLUDED_PUBLIC_DOCUMENT');
  assert.equal(s.stats.imports, 0);
});
test('concurrent initialization and HMR share one SDK instance for the Firebase app', async () => {
  const { initializeBrowserAppCheck: init } = load(); const app = {}; const b = browser(); const s = sdk();
  const first = init(app, config, b, s.load); const second = init(app, config, b, s.load);
  assert.equal(first, second);
  assert.equal(await first, 'INITIALIZED_OBSERVE_ONLY');
  assert.equal(await load().initializeBrowserAppCheck(app, config, b, s.load), 'INITIALIZED_OBSERVE_ONLY');
  assert.deepEqual(s.stats, { imports: 1, providers: 1, initialized: 1 });
});
test('navigation to public document during SDK loading cancels provider initialization', async () => {
  const { initializeBrowserAppCheck: init } = load(); const b = browser(); const s = sdk(); let resolve;
  const pending = init({}, config, b, () => new Promise(done => { resolve = done; }));
  b.location.pathname = '/descarga/documento'; resolve(s.value);
  assert.equal(await pending, 'EXCLUDED_PUBLIC_DOCUMENT'); assert.equal(s.stats.providers, 0);
});
test('debug override including accessor is blocked before import and rechecked after await', async () => {
  const { initializeBrowserAppCheck: init } = load(); const b = browser();
  Object.defineProperty(b, 'FIREBASE_APPCHECK_DEBUG_TOKEN', { get() { throw new Error('SECRET_DEBUG_TOKEN'); } });
  assert.equal(await init({}, config, b), 'DEBUG_OVERRIDE_BLOCKED');
  const late = browser(); const s = sdk(); let resolve;
  const pending = init({}, config, late, () => new Promise(done => { resolve = done; }));
  late.FIREBASE_APPCHECK_DEBUG_TOKEN = 'private-debug-value'; resolve(s.value);
  assert.equal(await pending, 'DEBUG_OVERRIDE_BLOCKED'); assert.equal(s.stats.providers, 0);
});
test('provider failures return only fixed status and do not loop/retry or expose errors', async () => {
  const { initializeBrowserAppCheck: init } = load(); const b = browser(); const app = {}; let count = 0;
  const loader = async () => { count++; throw new Error('secret-token=https://private.example'); };
  assert.equal(await init(app, config, b, loader), 'INITIALIZATION_FAILED');
  assert.equal(await init(app, config, b, loader), 'INITIALIZATION_FAILED'); assert.equal(count, 1);
});
test('already-loaded provider on later SPA public route is reported honestly rather than claiming unload', async () => {
  const { initializeBrowserAppCheck: init } = load(); const b = browser(); const app = {}; const s = sdk();
  await init(app, config, b, s.load); b.location.pathname = '/firma/private-bearer';
  assert.equal(await init(app, config, b, s.load), 'PUBLIC_DOCUMENT_WITH_EXISTING_PROVIDER');
  assert.equal(s.stats.initialized, 1);
});
