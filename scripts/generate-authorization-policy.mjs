import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { replaceRulesPolicyBlock } from './lib/authorization-policy-generator.mjs';
const args = process.argv.slice(2);
if (args.some(arg => !['--write', '--check'].includes(arg)) || (args.includes('--write') && args.includes('--check'))) throw new Error('Use no option (preview), --check, or --write');
const policy = JSON.parse(fs.readFileSync('config/authorization-policy.json', 'utf8'));
const source = fs.readFileSync('firestore.rules', 'utf8');
const output = replaceRulesPolicyBlock(source, policy);
const changed = output !== source;
// Read-only by default. Do not run --write until the isolated candidate is approved.
if (args.includes('--write') && changed) fs.writeFileSync('firestore.rules', output);
console.log(JSON.stringify({ policy: `${policy.policyId}@${policy.schemaVersion}`, format: 'cached-selector', changed, written: args.includes('--write') && changed, sha256: createHash('sha256').update(output).digest('hex') }));
if (args.includes('--check') && changed) process.exitCode = 1;
