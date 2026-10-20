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
  assert.ok(['legacy', 'cached-selector', 'cached-selector-actor-only'].includes(format));
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
  lines.push('    }');
  if (format === 'cached-selector') {
    // Derive the explicit-role selector from the same canonical rendering.
    // Preserve the existing actor function byte-for-byte for old callers.
    const actor = lines.slice(1).join('\n');
    lines.push(actor.replace('roleDefaultAllows(moduleKey, actionKey)', 'roleDefaultAllowsForRole(role, moduleKey, actionKey)')
      .replace('      let role = myRole();\n', ''));
    // Specialize only the fixed grantor module pair from canonical policy.
    // Superadmin keeps the existing selector's unconditional policy bypass.
    const delegationRoles = CANONICAL_ROLES.filter(role => role !== 'superadmin'
      && policy.roleDefaults[role].usuarios?.view === true
      && policy.roleDefaults[role].usuarios?.clientDelegations === true);
    lines.push('    function roleAllowsClientDelegation(role) {',
      `      return role == "superadmin" || role in [${delegationRoles.map(JSON.stringify).join(', ')}];`,
      '    }');
  }
  lines.push('    // AUTHORIZATION_POLICY_GENERATED_END');
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
  if (block === renderRulesPolicyBlock(policy, { format: 'cached-selector-actor-only' })) return 'cached-selector';
  throw new Error('Rules policy block differs from its complete canonical rendering');
}
export function replaceRulesPolicyBlock(source, policy) {
  const existing = extractRulesPolicyBlock(source);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  return source.replace(existing, renderRulesPolicyBlock(policy).replace(/\n/g, newline));
}

// The bounded document evaluator specializes these fixed call sites. Fail
// verification if canonical defaults or callers change instead of silently
// retaining a broader role shortcut. Other actions use the generated selector.
export function verifyOperationalReadSpecialization(source, policy) {
  if (!source.includes('function documentActorAllowed(')) return;
  const pairs = [['clientes', 'view'], ['solicitudes', 'view'], ['solicitudes', 'comment'], ['pagos', 'view'], ['wallet', 'view'], ['wallet', 'dispersiones']];
  for (const role of ['admin', 'operador']) for (const [module, action] of pairs)
    assert.equal(policy.roleDefaults[role]?.[module]?.[action], true, `Re-specialize bounded document policy: ${role}.${module}.${action}`);
  for (const line of source.split(/\r?\n/)) {
    if (line.includes('canReadOperationalDocument(') && !line.includes('function ')) {
      const match = line.match(/, '(solicitudes|pagos)', '(operateSolicitudes|operatePagos)', '(view|comment)'\);/);
      assert.ok(match, 'Bounded document callers require fixed, reviewed module/action pairs');
      assert.ok(match[1] === 'solicitudes' ? match[2] === 'operateSolicitudes' : match[2] === 'operatePagos' && match[3] === 'view');
    }
    if (line.includes('documentActorAllowed(') && !line.includes('function '))
      assert.ok(line.includes('documentActorAllowed(user, uid, role, moduleKey, actionKey)') || line.includes("documentActorAllowed(user, uid, role, 'clientes', 'view')"), 'Unreviewed bounded actor caller');
  }
}
