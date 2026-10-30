const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const source = fs.readFileSync('src/app/mat/usuarios/page.tsx', 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function render(uid, linked = true) {
  const exports = {}, changed = [];
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    react: { useState: () => [true, value => changed.push(value)] },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/lib/auth': { useAuth: () => ({ user: uid ? { uid } : null }) },
    '@/components/NuevaSolicitudModal': { __esModule: true, default: 'CANONICAL_SOLICITUD_MODAL' },
    '@/components/Modal': { __esModule: true, default: 'CANONICAL_MODAL' },
    'next/dynamic': { __esModule: true, default: () => 'CANONICAL_RETURN_PAGE' },
    '@/components/mat/MatBalanceCard': { MatBalanceCard: 'BALANCE' },
    '@/components/mat/MatCarousel2D': { MatCarousel2D: 'CAROUSEL' },
    '@/components/mat/MatShell': { MatShell: 'SHELL' },
    '@/components/mat/useMatHome': { useMatUserHome: () => ({ home: { linked, pay0UserId: 'matched', role: 'operador', balance: {}, metrics: [], solicitudes: [], dispersiones: [], clients: [], movements: [] }, loading: false, error: '' }) },
    '@/lib/matSecurityPolicy': { formatMatTrustWindow: () => '' },
  };
  vm.runInNewContext(js, { exports, require: name => { assert.ok(name in dependencies, `Unexpected import ${name}`); return dependencies[name]; } });
  const tree = exports.default();
  return { tree, changed };
}
test('MAT mounts the existing canonical capture form only for the matching authenticated identity', () => {
  const { tree } = render('matched');
  const children = tree.props.children;
  assert.equal(children[1].type, 'CANONICAL_SOLICITUD_MODAL');
  assert.equal(children[1].props.open, true);
  for (const [uid, linked] of [[null, true], ['foreign', true], ['matched', false]]) {
    assert.equal(render(uid, linked).tree.props.children[1], false);
  }
});
test('MAT request opens its embedded form without replacing the canonical create service', () => {
  const { tree, changed } = render('matched');
  const slides = tree.props.children[0].props.slides;
  const solicitud = slides.find(slide => slide.id === 'solicitudes');
  const action = solicitud.children.props.children[0];
  assert.equal(typeof action.props.onPrimary, 'function');
  action.props.onPrimary();
  assert.deepEqual(changed, [true]);
  assert.equal(source.includes('createSolicitud('), false, 'business mutation remains in the existing canonical modal/service');
  const other = render('foreign').tree.props.children[0].props.slides.find(slide => slide.id === 'solicitudes').children.props.children[0];
  assert.equal(other.props.onPrimary, undefined);
  assert.equal(other.props.primaryHref, '/solicitudes');
});
test('MAT return uses the complete canonical page and only mounts under matching session', () => {
  const matched = render('matched').tree;
  assert.equal(matched.props.children[2].type, 'CANONICAL_MODAL');
  assert.equal(matched.props.children[2].props.children[1].type, 'CANONICAL_RETURN_PAGE');
  for (const [uid, linked] of [[null, true], ['foreign', true], ['matched', false]]) assert.equal(render(uid, linked).tree.props.children[2], false);
  assert.equal(source.includes('createClientDispersion('), false);
  assert.equal(source.includes('previewClientDispersionPricing('), false);
});
