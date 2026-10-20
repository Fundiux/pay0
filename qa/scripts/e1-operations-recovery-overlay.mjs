import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url), ts = require('typescript');
const file = 'lib/modules/controlCenter/recovery.js';
const deployed = readFileSync(join(root, 'tmp/e1-deployed-recovery/queueOperationRecovery/recovery.js'), 'utf8');
const second = readFileSync(join(root, 'tmp/e1-deployed-recovery/reconcileOperationRecovery/recovery.js'), 'utf8');
assert.equal(deployed, second, 'both workers must share the verified baseline module');
const candidate = readFileSync(join(root, 'functions', file), 'utf8');
const hash = text => createHash('sha256').update(text).digest('hex');
const imports = text => [...new Set([...text.matchAll(/require\("([^"]+)"\)/g)].map(match => match[1]))].sort();
assert.deepEqual(imports(candidate), imports(deployed), 'a recovery overlay must not add a dependency');
const mutable = new Set(['enqueueRecovery', 'reconcileRecoverySource', 'executeRecovery', 'recoverySourceIsTerminal']);
function fixedStatements(text) {
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  return ast.statements.filter(node => !(ts.isFunctionDeclaration(node) && mutable.has(node.name?.text)) && !node.getText(ast).startsWith('exports.recoverySourceIsTerminal ='))
    .map(node => node.getText(ast).replace(/\s+/g, ' ').trim());
}
assert.deepEqual(fixedStatements(candidate), fixedStatements(deployed), 'unexpected code outside the reviewed finite guards');
const output = join(root, 'tmp/e1-operations-release');
mkdirSync(output, { recursive: true });
const descriptor = { schemaVersion: 1, state: 'VERIFIED_OVERLAY_DESCRIPTOR_NOT_DEPLOYMENT_ARTIFACT',
  baseArchiveSha256: '6e600ff51ba1df79097b778664c1081e2271b59dec2c71103d5e74b64aaa0df4',
  targets: ['queueOperationRecovery', 'reconcileOperationRecovery'], region: 'us-central1',
  replacements: [{ file, beforeSha256: hash(deployed), afterSha256: hash(candidate) }],
  allowedChanges: [...mutable], dependencyChange: false,
  unchanged: ['processRecoveryJobs', 'queueOperationRecovery registration', 'reconcileOperationRecovery schedule', 'all other files from the deployed archive'],
  rollback: 'Restore the original deployed archive for these two existing functions; preserve all job/source/audit documents.',
};
writeFileSync(join(output, 'recovery-overlay.json'), JSON.stringify(descriptor, null, 2) + '\n');
console.log(JSON.stringify(descriptor));
