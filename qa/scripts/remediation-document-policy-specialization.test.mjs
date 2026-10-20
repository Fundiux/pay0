import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyOperationalReadSpecialization } from '../../scripts/lib/authorization-policy-generator.mjs';
const policy = JSON.parse(fs.readFileSync('config/authorization-policy.json', 'utf8'));
const source = fs.readFileSync(process.env.PAY0_RULES_SOURCE_ROOT ? `${process.env.PAY0_RULES_SOURCE_ROOT}/firestore.rules` : 'firestore.rules', 'utf8');
assert.ok(source.includes('function documentActorAllowed('));
verifyOperationalReadSpecialization(source, policy);
let checks = 1;
for (const role of ['admin', 'operador']) for (const [module, action] of [['clientes', 'view'], ['solicitudes', 'view'], ['solicitudes', 'comment'], ['pagos', 'view'], ['wallet', 'view'], ['wallet', 'dispersiones']]) {
  const changed = structuredClone(policy); changed.roleDefaults[role][module][action] = false;
  assert.throws(() => verifyOperationalReadSpecialization(source, changed), /Re-specialize/); checks++;
}
assert.throws(() => verifyOperationalReadSpecialization(source + "\nallow read: if canReadOperationalDocument(resource.data, 'pagos', 'operatePagos', 'comment');", policy)); checks++;
assert.throws(() => verifyOperationalReadSpecialization(source + '\nallow read: if canReadOperationalDocument(resource.data, module, permission, action);', policy)); checks++;
assert.throws(() => verifyOperationalReadSpecialization(source + "\nreturn documentActorAllowed(user, uid, role, 'usuarios', 'view');", policy)); checks++;
console.log(`PASS bounded document canonical policy: ${checks} checks`);
