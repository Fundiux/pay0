import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { buildCandidate } from './build-functions-internal-bundle.mjs';
import { acquireBuildLock, installCandidate, PROVENANCE } from './install-functions-internal-bundle.mjs';
import { copyCanonicalAssets } from './copy-canonical-assets.mjs';

export function buildMode(environment) {
  const mode = environment.PAY0_FUNCTIONS_BUILD_MODE ?? 'NORMAL';
  if (!['NORMAL', 'BUNDLED_V1'].includes(mode)) throw Error('BUILD_MODE_INVALID');
  return mode;
}
export async function dispatchBuild({ repositoryRoot = path.resolve(import.meta.dirname, '..'), environment = process.env, normal, bundled } = {}) {
  const mode = buildMode(environment), root = fs.realpathSync(repositoryRoot);
  if (mode === 'BUNDLED_V1') {
    if (bundled) return bundled();
    const output = `.firebase/internal-bundle-candidates/build-${randomUUID()}`;
    await buildCandidate({ repositoryRoot: root, output });
    return installCandidate({ repositoryRoot: root, candidate: output });
  }
  if (normal) return normal();
  const lock = acquireBuildLock(root);
  try {
    const require = createRequire(path.join(root, 'functions/package.json'));
    const result = spawnSync(process.execPath, [require.resolve('typescript/lib/tsc.js')], { cwd: path.join(root, 'functions'), env: environment, stdio: 'inherit', windowsHide: true });
    if (result.status !== 0) throw Error('NORMAL_TSC_FAILED');
    await copyCanonicalAssets({ repositoryRoot: root });
    // A normal rebuild has a different entry and freshly emitted module maps.
    // Old inert .debug files are retained, but never advertised as its provenance.
    const provenance = path.join(root, PROVENANCE);
    if (fs.existsSync(provenance)) fs.unlinkSync(provenance);
    return { mode: 'NORMAL', status: 'BUILT' };
  } finally { lock.release(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2 && !(process.argv.length === 3 && process.argv[2] === '--normal')) throw Error('BUILD_ARGUMENTS');
    console.log(JSON.stringify(await dispatchBuild({ environment: process.argv[2] === '--normal' ? { ...process.env, PAY0_FUNCTIONS_BUILD_MODE: 'NORMAL' } : process.env })));
  } catch (error) { console.error(JSON.stringify({ result: 'BUILD_FAILED', code: /^[A-Z_]+$/.test(error.message) ? error.message : 'REDACTED' })); process.exitCode = 1; }
}
