const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(root, "functions/src/modules/controlCenter/engineeringCatalog.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const moduleExports = {};
new Function("exports", compiled)(moduleExports);

test("curated engineering contracts reference actual modules and known dependencies", () => {
  const catalog = moduleExports.engineeringCatalog();
  const ids = new Set(catalog.modules.map(module => module.id));
  assert.equal(ids.size, catalog.modules.length);
  for (const module of catalog.modules) {
    assert.ok(fs.statSync(path.join(root, module.source)).isDirectory());
    assert.ok(module.responsibility && module.boundary && module.checks.length);
    for (const dependency of module.dependencies) {
      assert.ok(ids.has(dependency), `${module.id} references unknown ${dependency}`);
      assert.notEqual(module.id, dependency);
    }
  }
  const visit = (id, stack = []) => {
    assert.ok(!stack.includes(id), `Circular curated dependency: ${[...stack, id].join(" -> ")}`);
    catalog.modules.find(module => module.id === id).dependencies.forEach(dependency => visit(dependency, [...stack, id]));
  };
  ids.forEach(id => visit(id));
});

test("source contracts cannot attest deployment, certification or assigned owners", () => {
  const catalog = moduleExports.engineeringCatalog();
  assert.equal(catalog.coverage, "CURATED");
  assert.equal(catalog.release.deployedVersion, null);
  assert.equal(catalog.release.certification, "UNKNOWN");
  assert.equal(catalog.release.productionVerification, "UNKNOWN");
  assert.equal(catalog.engineeringAgents.environment, "CODEX");
  assert.ok(catalog.modules.every(module => module.technicalOwner === null && module.independence === "SHARED_FIREBASE_RUNTIME"));
});
