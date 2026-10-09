import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { replaceRulesPolicyBlock } from './lib/authorization-policy-generator.mjs';
import { renderBackendAuthorizationPolicy } from './lib/backend-authorization-policy-generator.mjs';

const args = process.argv.slice(2);
if (args.some(arg => !['--write', '--check'].includes(arg)) || (args.includes('--write') && args.includes('--check'))) throw new Error('Use no option (preview), --check, or --write');
const policy = JSON.parse(fs.readFileSync('config/authorization-policy.json', 'utf8'));
const source = fs.readFileSync('firestore.rules', 'utf8');
const output = replaceRulesPolicyBlock(source, policy);
const backendPath = 'functions/src/modules/users/authorizationPolicy.generated.ts';
const backendSource = fs.existsSync(backendPath) ? fs.readFileSync(backendPath, 'utf8') : null;
const backendRendered = renderBackendAuthorizationPolicy(policy);
const backendOutput = backendSource?.includes('\r\n') ? backendRendered.replace(/\n/g, '\r\n') : backendRendered;
// Compute and validate BOTH artifacts before any explicit write. Preview/check are read-only.
const outputs = [
  { file: 'firestore.rules', content: output, changed: output !== source },
  { file: backendPath, content: backendOutput, changed: backendOutput !== backendSource },
];
const changed = outputs.some(item => item.changed);
if (args.includes('--write')) for (const item of outputs) if (item.changed) fs.writeFileSync(item.file, item.content, 'utf8');
console.log(JSON.stringify({ policy: `${policy.policyId}@${policy.schemaVersion}`, format: 'cached-selector', changed,
  written: args.includes('--write') && changed, sha256: createHash('sha256').update(output).digest('hex'),
  outputs: outputs.map(({ file, content, changed }) => ({ file, changed, sha256: createHash('sha256').update(content).digest('hex') })),
}));
if (args.includes('--check') && changed) process.exitCode = 1;
