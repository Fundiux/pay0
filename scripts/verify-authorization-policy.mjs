import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validatePolicy, identifyRulesPolicyFormat } from './lib/authorization-policy-generator.mjs';
const args = process.argv.slice(2);
let rulesFile = 'firestore.rules';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--quiet') continue;
  if (args[i] === '--rules' && args[i + 1] && !args[i + 1].startsWith('--')) { rulesFile = args[++i]; continue; }
  throw new Error('Use --quiet and/or --rules <candidate-file>; verifier never writes');
}
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const policy = validatePolicy(JSON.parse(read('config/authorization-policy.json')));
const generatedSource = read('functions/src/modules/users/authorizationPolicy.generated.ts');
const match = generatedSource.match(/export const ROLE_DEFAULT_MODULES = (\{[\s\S]*\}) as const;/);
assert.ok(match, 'No se pudo leer ROLE_DEFAULT_MODULES generado.');
assert.deepEqual(JSON.parse(match[1]), policy.roleDefaults, 'El backend diverge de config/authorization-policy.json.');
const format = identifyRulesPolicyFormat(read(rulesFile), policy);
const frontend = read('src/lib/roles.ts');
assert.match(frontend, /config\/authorization-policy\.json/);
assert.match(frontend, /merged\[moduleKey\]\[actionKey\] === true/);
assert.match(frontend, /stored\[moduleKey\]\[actionKey\] === true/);
if (!args.includes('--quiet')) console.log(`PASS politica ${policy.policyId}@${policy.schemaVersion}: frontend, Functions y Firestore sincronizados (${format}).`);
