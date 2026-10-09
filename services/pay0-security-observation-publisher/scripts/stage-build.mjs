import { mkdtemp, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
await import('./build.mjs');
const base = fileURLToPath(new URL('../', import.meta.url)), root = path.resolve(base, '../..');
const files = ['package.json', 'package-lock.json', 'publisher-manifest.json', 'Dockerfile', 'Dockerfile.dockerignore', 'cloudbuild.yaml',
  'scripts/build.mjs', 'src/config.mjs', 'src/logging.mjs', 'src/http.mjs', 'src/main.mjs'].map(file => `services/pay0-security-observation-publisher/${file}`);
files.push('functions/src/modules/securityObservation/publisher.ts');
const stage = await mkdtemp(path.join(base, '.build/context-'));
for (const file of files) { const destination = path.join(stage, file); await mkdir(path.dirname(destination), { recursive: true }); await copyFile(path.join(root, file), destination); }
console.log(JSON.stringify({ status: 'LOCAL_STAGE_ONLY', stage, files: files.length }));
