const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const ts = require("../../functions/node_modules/typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const root = path.resolve(__dirname, "../..");
const parse = p => ts.createSourceFile(p, fs.readFileSync(path.join(root, p), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const solicitudes = parse("src/app/solicitudes/page.tsx"), reportes = parse("src/app/reportes/page.tsx");
function find(sf, predicate) { let found; function visit(n) { if (predicate(n)) found = n; ts.forEachChild(n, visit); } visit(sf); assert(found, "Expected navigation source contract"); return found; }
const link = find(solicitudes, n => ts.isConditionalExpression(n) && n.condition.getText(solicitudes) === "isSuperAdmin(role)" && n.whenTrue.getText(solicitudes).includes('href="/reportes#complementos-pago"'));
const jsx = ts.transpileModule(`const result = (${link.getText(solicitudes)});`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 } }).outputText;
const rolesPath = path.join(root, "src/lib/roles.ts"), roles = {};
new Function("require", "exports", ts.transpileModule(fs.readFileSync(rolesPath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText)(createRequire(rolesPath), roles);
const renderLink = role => renderToStaticMarkup(new Function("React", "role", "isSuperAdmin", `${jsx};return result;`)(React, role, roles.isSuperAdmin));

test("existing Solicitudes link is visible only to superadmin", () => {
  assert.match(renderLink("superadmin"), /Proveedores y complementos de pago/);
  assert.match(renderLink("superadmin"), /href="\/reportes#complementos-pago"/);
  for (const role of ["admin", "operador", "", "unknown"]) assert.equal(renderLink(role), "");
});

test("hash target remains within the existing superadmin control panel", () => {
  const section = find(reportes, n => ts.isJsxElement(n) && n.openingElement.attributes.properties.some(a => a.name?.getText(reportes) === "id" && a.initializer?.text === "complementos-pago"));
  assert.match(section.getText(reportes), /tabIndex=\{-1\}/);
  assert.match(section.getText(reportes), /<PaymentComplementFollowup \/>/);
  let parent = section.parent, roleGuard = false, controlGuard = false;
  while (parent) {
    if (ts.isConditionalExpression(parent)) {
      roleGuard ||= parent.condition.getText(reportes).includes('=== "superadmin"');
      controlGuard ||= parent.condition.getText(reportes) === 'activeTab === "control"';
    }
    parent = parent.parent;
  }
  assert(roleGuard && controlGuard);
  assert.equal((reportes.text.match(/<PaymentComplementFollowup\s*\/>/g) || []).length, 1);
});

const hook = find(reportes, n => ts.isCallExpression(n) && n.expression.getText(reportes) === "useEffect" && n.getText(reportes).includes('window.location.hash !== "#complementos-pago"'));
const hookJs = ts.transpileModule(hook.getText(reportes), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
function browser() {
  const listeners = new Map(), handled = { current: false }, calls = [], element = { scrollIntoView: () => calls.push("scroll"), focus: () => calls.push("focus") };
  const window = { location: { hash: "#complementos-pago" }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); } };
  let cleanup;
  function render(activeTab = "control", allowed = true, loading = false, mounted = true) {
    cleanup?.();
    new Function("useEffect", "activeTab", "canNavigateComplements", "profileLoading", "complementHashHandled", "window", "document", "setActiveTab", hookJs)(
      fn => { cleanup = fn(); }, activeTab, allowed, loading, handled, window,
      { getElementById: id => id === "complementos-pago" && mounted ? element : null }, tab => calls.push(tab));
  }
  return { render, calls, listeners, handled, window };
}

test("late profile/panel arrival focuses the section once without a render loop", () => {
  const b = browser(); b.render("control", true, true); assert.deepEqual(b.calls, []);
  b.render("control", true, false, false); assert.deepEqual(b.calls, []);
  b.render(); assert.deepEqual(b.calls, ["scroll", "focus"]);
  b.render(); assert.deepEqual(b.calls, ["scroll", "focus"]);
  b.render("earnings"); assert.deepEqual(b.calls, ["scroll", "focus"]);
});

test("new hash navigation selects control then focuses the mounted section", () => {
  const b = browser(); b.render("earnings"); assert.deepEqual(b.calls, ["control"]);
  b.render("control"); assert.deepEqual(b.calls, ["control", "scroll", "focus"]);
  b.render("earnings"); b.listeners.get("hashchange")();
  assert.equal(b.calls.at(-1), "control");
});

test("other hashes and unauthorized profiles cannot focus the restricted section", () => {
  const b = browser(); b.render("control", false); assert.deepEqual(b.calls, []); assert.equal(b.listeners.size, 0);
  b.window.location.hash = "#other"; b.render(); assert.deepEqual(b.calls, []);
});
