// Build a minimal local upload directory. Does not invoke Cloud Build or Docker.
import { copyFile, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, sep } from 'node:path';
const service = new URL('../', import.meta.url);
const root = new URL('../../', service);
await mkdir(new URL('.build/', service), { recursive: true });
const directory = await mkdtemp(fileURLToPath(new URL('.build/context-', service)));
const destination = pathToFileURL(directory + sep);
const manifest = JSON.parse(await readFile(new URL('core-manifest.json', service), 'utf8'));
const core = ['schema.ts', 'policy.ts', 'detector.ts', 'store.ts', 'transactionalStore.ts', 'ingress.ts'];
const files = ['package.json', 'package-lock.json', 'core-manifest.json', 'Dockerfile', 'Dockerfile.dockerignore', 'scripts/build.mjs',
  'src/strictJson.mjs', 'src/signedVerifier.mjs', 'src/trusted-producers.json', 'src/config.mjs', 'src/transport.mjs', 'src/persistence.mjs', 'src/http.mjs', 'src/main.mjs'];
for (const name of core) {
  const path = `functions/src/modules/sentinel/${name}`;
  const value = (await readFile(new URL(path, root), 'utf8')).replace(/\r\n/g, '\n');
  if (createHash('sha256').update(value).digest('hex') !== manifest.files[name]) throw new Error('CORE_CHANGED_REVIEW_REQUIRED');
}
const signedPath = 'functions/src/modules/securityObservation/signedContract.ts';
const signedSource = (await readFile(new URL(signedPath, root), 'utf8')).replace(/\r\n/g, '\n');
if (createHash('sha256').update(signedSource).digest('hex') !== manifest.signedContractSha256) throw new Error('SIGNED_CONTRACT_CHANGED_REVIEW_REQUIRED');
for (const path of [signedPath, ...core.map(name => `functions/src/modules/sentinel/${name}`), ...files.map(name => `services/pay0-sentinel-observation/${name}`)]) {
  const target = new URL(path, destination);
  await mkdir(new URL('./', target), { recursive: true });
  await copyFile(new URL(path, root), target);
}
await copyFile(new URL('cloudbuild.yaml', service), new URL('cloudbuild.yaml', destination));
console.log(JSON.stringify({ action: 'LOCAL_STAGE_ONLY', directory: `.build/${basename(directory)}`, files: core.length + files.length + 2 }));
