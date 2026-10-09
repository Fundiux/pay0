import { validatePolicy } from './authorization-policy-generator.mjs';

// Preserve the reviewed policy's explicit ordering, including false permissions.
// Rendering the same policy is byte-deterministic; no generated backend is edited by hand.
export function renderBackendAuthorizationPolicy(policy) {
  validatePolicy(policy);
  const roles = Object.entries(policy.roleDefaults).map(([role, modules]) => {
    const lines = Object.entries(modules).map(([module, actions]) => {
      const pairs = Object.entries(actions).map(([action, enabled]) => `${JSON.stringify(action)}: ${JSON.stringify(enabled)}`);
      return `    ${JSON.stringify(module)}: { ${pairs.join(', ')} }`;
    });
    return `  ${JSON.stringify(role)}: {\n${lines.join(',\n')}\n  }`;
  });
  return '// GENERATED FROM config/authorization-policy.json. DO NOT EDIT BY HAND.\n' +
    `export const AUTHORIZATION_POLICY_SCHEMA_VERSION = ${policy.schemaVersion};\n` +
    `export const AUTHORIZATION_POLICY_ID = ${JSON.stringify(policy.policyId)};\n\n` +
    `export const ROLE_DEFAULT_MODULES = {\n${roles.join(',\n')}\n} as const;\n`;
}
