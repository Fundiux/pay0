import assert from 'node:assert/strict';
export const CANONICAL_ROLES = ['superadmin', 'admin', 'operador'];
const identifier = /^[A-Za-z][A-Za-z0-9_]*$/;
export function validatePolicy(policy) {
  assert.ok(policy && typeof policy === 'object' && !Array.isArray(policy));
  assert.deepEqual(Object.keys(policy).sort(), ['policyId', 'roleDefaults', 'schemaVersion']);
  assert.equal(policy.policyId, 'PAY0-USERS-PERMISSIONS');
  assert.equal(policy.schemaVersion, 1);
  assert.deepEqual(Object.keys(policy.roleDefaults).sort(), [...CANONICAL_ROLES].sort());
  for (const role of CANONICAL_ROLES) {
    const modules = policy.roleDefaults[role];
    assert.ok(modules && typeof modules === 'object' && !Array.isArray(modules));
    for (const [moduleKey, actions] of Object.entries(modules)) {
      assert.match(moduleKey, identifier);
      assert.ok(actions && typeof actions === 'object' && !Array.isArray(actions));
      for (const [action, enabled] of Object.entries(actions)) {
        assert.match(action, identifier);
        assert.equal(typeof enabled, 'boolean', `${role}.${moduleKey}.${action} must be boolean`);
      }
    }
  }
  return policy;
}
function allowedModules(policy, role, sort) {
  let entries = Object.entries(policy.roleDefaults[role]);
  if (sort) entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return entries.map(([key, actions]) => [key, Object.entries(actions).filter(([, on]) => on).map(([action]) => action)])
    .filter(([, actions]) => actions.length).map(([key, actions]) => [key, sort ? actions.sort() : actions]);
}
export function renderRulesPolicyBlock(policy, { format = 'cached-selector' } = {}) {
  validatePolicy(policy);
  assert.ok(['legacy', 'cached-selector'].includes(format));
  const lines = [`    // AUTHORIZATION_POLICY_GENERATED_START ${policy.policyId}@${policy.schemaVersion}`,
    '    function roleDefaultAllows(moduleKey, actionKey) {'];
  if (format === 'legacy') {
    lines.push('      return isSuperadmin()');
    for (const [role, predicate] of [['admin', 'isAdmin'], ['operador', 'isOperador']]) {
      lines.push(`        || (${predicate}() && (`);
      const entries = allowedModules(policy, role, false);
      entries.forEach(([moduleKey, actions], i) => lines.push(`          ${i ? '|| ' : ''}(moduleKey == ${JSON.stringify(moduleKey)} && actionKey ${actions.length === 1 ? '== ' + JSON.stringify(actions[0]) : 'in [' + actions.map(JSON.stringify).join(', ') + ']'})`));
      if (!entries.length) lines.push('          false');
      lines.push(role === 'admin' ? '        ))' : '        ));');
    }
  } else {
    lines.push('      // Canonical renderer v1: cache role and select modules by action.', '      let role = myRole();', '      let modules = role == "admin"', '        ? (');
    for (const [index, role] of ['admin', 'operador'].entries()) {
      const indent = index ? '            ' : '          ';
      const byAction = new Map();
      for (const [moduleKey, actions] of allowedModules(policy, role, true))
        for (const action of actions) byAction.set(action, [...(byAction.get(action) || []), moduleKey]);
      // view is the universal prerequisite; emit it first to bound common cost.
      const entries = [...byAction].sort(([a], [b]) => a === b ? 0 : a === 'view' ? -1 : b === 'view' ? 1 : a < b ? -1 : 1);
      entries.forEach(([action, modules], i) => lines.push(`${indent}${i ? ': ' : ''}actionKey == ${JSON.stringify(action)} ? [${modules.map(JSON.stringify).join(', ')}]`));
      lines.push(`${indent}${entries.length ? ': ' : ''}[]`);
      if (index === 0) lines.push('        )', '        : role == "operador"', '          ? (');
      else lines.push('          )', '          : [];');
    }
    lines.push('      return role == "superadmin" || moduleKey in modules;');
  }
  lines.push('    }', '    // AUTHORIZATION_POLICY_GENERATED_END');
  return lines.join('\n');
}
export function extractRulesPolicyBlock(source) {
  const matches = source.match(/    \/\/ AUTHORIZATION_POLICY_GENERATED_START[^\r\n]*\r?\n[\s\S]*?    \/\/ AUTHORIZATION_POLICY_GENERATED_END/g);
  assert.equal(matches?.length, 1, 'Exactly one canonical policy block is required');
  return matches[0];
}
export function identifyRulesPolicyFormat(source, policy) {
  const block = extractRulesPolicyBlock(source).replace(/\r\n/g, '\n');
  for (const format of ['cached-selector', 'legacy']) if (block === renderRulesPolicyBlock(policy, { format })) return format;
  throw new Error('Rules policy block differs from its complete canonical rendering');
}
export function replaceRulesPolicyBlock(source, policy) {
  const existing = extractRulesPolicyBlock(source);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  return source.replace(existing, renderRulesPolicyBlock(policy).replace(/\n/g, newline));
}
