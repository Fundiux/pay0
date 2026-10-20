import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

// Review-only by default. --write must be invoked by integration after approval.
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 1 && ['--check', '--write'].includes(args[0])), 'Use --check (default) or --write');
const manifestPath = 'docs/remediation/2026-10-09/RESTRICTION-CANDIDATE-HASHES.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.evidence.emulatorChecks, 325);
for (const [file, expected] of Object.entries(manifest.inputs)) {
  assert.equal(sha256(fs.readFileSync(file)), expected, `Input changed since review: ${file}`);
}
const require = createRequire(import.meta.url);
const { replaceRulesPolicyBlock } = await import('../../scripts/lib/authorization-policy-generator.mjs');
const candidate = require('./remediation-restriction-rules-candidate.cjs').candidateRules();
candidate.firestore = replaceRulesPolicyBlock(candidate.firestore, JSON.parse(fs.readFileSync('config/authorization-policy.json', 'utf8')));
const outputs = { 'firestore.rules': candidate.firestore, 'storage.rules': candidate.storage };
for (const [file, source] of Object.entries(outputs)) assert.equal(sha256(source), manifest.outputs[file], `Candidate output mismatch: ${file}`);
// Validate every input and both outputs before touching either local rules file.
// This is local materialization only; it never invokes Firebase or deployment.
if (args[0] === '--write') for (const [file, source] of Object.entries(outputs)) fs.writeFileSync(file, source, 'utf8');
console.log(JSON.stringify({ verified: true, written: args[0] === '--write', manifest: manifestPath, outputs: manifest.outputs, knownDelegatedStorageGaps: 24, securityClosure: false }));
