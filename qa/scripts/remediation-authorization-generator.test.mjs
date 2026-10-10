import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { renderRulesPolicyBlock, replaceRulesPolicyBlock, identifyRulesPolicyFormat, validatePolicy } from '../../scripts/lib/authorization-policy-generator.mjs';

const policy = JSON.parse(fs.readFileSync('config/authorization-policy.json', 'utf8'));
const actual = fs.readFileSync('firestore.rules', 'utf8');
const baseline = Object.fromEntries(['firestore', 'storage'].map(name => [name, fs.readFileSync(`qa/fixtures/remediation-restriction-baseline/${name}.rules`, 'utf8')]));
const original = baseline.firestore;
assert.ok(['legacy', 'cached-selector'].includes(identifyRulesPolicyFormat(actual, policy)));
const require = createRequire(import.meta.url);
const candidate = replaceRulesPolicyBlock(require('./remediation-restriction-rules-candidate.cjs').candidateRules(baseline).firestore, policy);
assert.equal(identifyRulesPolicyFormat(original, policy), 'legacy');
assert.equal(identifyRulesPolicyFormat(candidate, policy), 'cached-selector');
assert.equal(replaceRulesPolicyBlock(candidate, policy), candidate);
const blockPattern = /    \/\/ AUTHORIZATION_POLICY_GENERATED_START[^\r\n]*\r?\n[\s\S]*?    \/\/ AUTHORIZATION_POLICY_GENERATED_END/;
assert.equal(replaceRulesPolicyBlock(original, policy).replace(blockPattern, ''), original.replace(blockPattern, ''));
const crlf = original.replace(/\r?\n/g, '\r\n');
assert.equal(replaceRulesPolicyBlock(crlf, policy).replace(blockPattern, ''), crlf.replace(blockPattern, ''));

// Execute the actual restricted Rules function bodies, with strict Rules map
// lookups and boolean equality. This is equivalence evidence, not an emulator.
function body(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const open = source.indexOf('{', start);
  let depth = 1, end = open + 1;
  while (depth) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; end++; assert.ok(end <= source.length); }
  return source.slice(open + 1, end - 1)
    .replace(/(actionKey|moduleKey) in (\[[^\]]*\]|actions|modules)/g, '($2).includes($1)')
    .replace(/(?<![=!])==(?!=)/g, '===');
}
function map(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return { get(key, fallback) { return map(Object.hasOwn(value, key) ? value[key] : fallback); } };
}
function evaluator(source, rawRole, profile) {
  const role = rawRole === 'operator' ? 'operador' : rawRole;
  const bindings = {
    myRole: () => role, isSuperadmin: () => role === 'superadmin',
    isAdmin: () => role === 'admin', isOperador: () => role === 'operador',
    signedIn: () => true, authenticated: () => true, userExists: () => true,
    me: () => 'synthetic-user', userDoc: () => map({ ...profile, role: rawRole }),
  };
  for (const name of ['roleDefaultAllowsForRole', 'roleDefaultAllows', 'userLifecycleActive', 'individualAllows', 'individualAllowsViewAndAction', 'individualAllowsViewAndActionForUser', 'hasModuleAction']) {
    if (!source.includes(`function ${name}(`)) continue;
    const signature = source.slice(source.indexOf(`function ${name}(`) + `function ${name}(`.length).split(')')[0].split(',').map(value => value.trim());
    bindings[name] = new Function(...Object.keys(bindings), ...signature, body(source, name)).bind(null, ...Object.values(bindings));
  }
  return (name, module, action) => { try { return bindings[name](module, action) === true; } catch { return false; } };
}
function reference(rawRole, profile, module, action, individual) {
  const role = rawRole === 'operator' ? 'operador' : rawRole;
  if (role === 'superadmin') return true;
  const defaults = policy.roleDefaults[role]?.[module];
  if (!individual) return defaults?.[action] === true;
  if (defaults?.view !== true || defaults?.[action] !== true) return false;
  const modules = Object.hasOwn(profile, 'modules') ? profile.modules : {};
  if (!modules || typeof modules !== 'object' || Array.isArray(modules)) return false;
  const access = Object.hasOwn(modules, module) ? modules[module] : {};
  if (!access || typeof access !== 'object' || Array.isArray(access)) return false;
  return (!Object.hasOwn(access, 'view') || access.view === true)
    && (!Object.hasOwn(access, action) || access[action] === true);
}
const roles = ['superadmin', 'admin', 'operador', 'operator', 'unknown', '', 'ADMIN', null];
const modules = [...new Set(Object.values(policy.roleDefaults).flatMap(Object.keys)), 'unknownModule'];
const actions = [...new Set(Object.values(policy.roleDefaults).flatMap(m => Object.values(m).flatMap(Object.keys))), 'unknownAction'];
assert.equal(roles.length * modules.length * actions.length, 2760);
let policyCases = 0, guardCases = 0;
for (const role of roles) {
  const oldPolicy = evaluator(original, role, {}), newPolicy = evaluator(candidate, role, {});
  for (const module of modules) for (const action of actions) {
    const expectedPolicy = reference(role, {}, module, action, false);
    assert.equal(oldPolicy('roleDefaultAllows', module, action), expectedPolicy);
    assert.equal(newPolicy('roleDefaultAllows', module, action), expectedPolicy);
    policyCases++;
    const profiles = [{}, { modules: {} }, { modules: { [module]: {} } },
      { modules: { [module]: { view: true, [action]: true } } },
      { modules: { [module]: { [action]: true, view: false } } },
      { modules: { [module]: { view: true, [action]: false } } },
      { modules: { [module]: { view: false, [action]: false } } },
      { modules: { [module]: false } }, { modules: { [module]: null } },
      { modules: { [module]: { [action]: true, view: 'true' } } },
      { modules: false }, { modules: { [module]: { [action]: true } } }];
    for (const [index, profile] of profiles.entries()) {
      const expected = reference(role, profile, module, action, true);
      for (const [label, source] of [['legacy', original], ['candidate', candidate], ['actual', actual]])
        assert.equal(evaluator(source, role, profile)('hasModuleAction', module, action), expected, JSON.stringify({label, role, module, action, index}));
      guardCases++;
    }
  }
}
assert.equal(guardCases, 33120);
const reorder = value => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
assert.equal(renderRulesPolicyBlock(reorder(policy)), renderRulesPolicyBlock(policy));
assert.throws(() => validatePolicy({ ...policy, unexpected: true }));
const invalid = structuredClone(policy); invalid.roleDefaults.admin.dashboard.view = 'true';
assert.throws(() => validatePolicy(invalid));
const unsafeKey = structuredClone(policy); unsafeKey.roleDefaults.admin['invalid-key'] = { view: true };
assert.throws(() => validatePolicy(unsafeKey));
const unknownRole = structuredClone(policy); unknownRole.roleDefaults.guest = {};
assert.throws(() => validatePolicy(unknownRole));
for (const rawRole of ['admin', 'operador']) for (const scalar of [1, 0, [], 'true']) {
  const profile = { modules: { solicitudes: { view: scalar, create: true } } };
  assert.equal(evaluator(original, rawRole, profile)('hasModuleAction', 'solicitudes', 'create'), false);
  assert.equal(evaluator(candidate, rawRole, profile)('hasModuleAction', 'solicitudes', 'create'), false);
  assert.equal(evaluator(actual, rawRole, profile)('hasModuleAction', 'solicitudes', 'create'), false);
}
assert.throws(() => identifyRulesPolicyFormat(candidate.replace('|| moduleKey in modules;', '|| true || moduleKey in modules;'), policy));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pay0-policy-candidate-'));
try {
  const file = path.join(dir, 'candidate.rules'); fs.writeFileSync(file, candidate);
  execFileSync(process.execPath, ['scripts/verify-authorization-policy.mjs', '--rules', file, '--quiet']);
  const preview = JSON.parse(execFileSync(process.execPath, ['scripts/generate-authorization-policy.mjs'], { encoding: 'utf8' }));
  assert.equal(preview.written, false);
  assert.equal(fs.readFileSync('firestore.rules', 'utf8'), actual);
} finally { fs.rmSync(dir, { recursive: true }); }
console.log(JSON.stringify({ policyCases, guardCases, equivalent: true, deterministic: true, deployableRulesChanged: false }));
