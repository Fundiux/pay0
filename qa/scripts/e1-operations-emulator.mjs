import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, copyFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const run = join(root, 'tmp', `e1-operations-${Date.now()}-${process.pid}`);
const cache = join(run, 'cache');
mkdirSync(cache, { recursive: true });
const cli = join(process.env.APPDATA || '', 'npm/node_modules/firebase-tools/lib/bin/firebase.js');
if (!existsSync(cli)) throw Error('Installed Firebase CLI required');
const previousCache = join(process.env.USERPROFILE || '', '.cache/firebase/emulators');
for (const file of readdirSync(previousCache).filter(name => /^cloud-firestore-emulator-.*\.jar$/.test(name))) copyFileSync(join(previousCache, file), join(cache, file));
async function port() {
  const server = createServer();
  await new Promise((yes, no) => server.once('error', no).listen(0, '127.0.0.1', yes));
  const value = server.address().port;
  await new Promise(yes => server.close(yes));
  return value;
}
const ports = [];
while (ports.length < 4) { const value = await port(); if (!ports.includes(value)) ports.push(value); }
const [firestore, websocketPort, hub, logging] = ports;
const project = `demo-pay0-e1-${process.pid}`;
const config = { emulators: { firestore: { host: '127.0.0.1', port: firestore, websocketPort }, hub: { host: '127.0.0.1', port: hub }, logging: { host: '127.0.0.1', port: logging }, ui: { enabled: false }, singleProjectMode: true } };
writeFileSync(join(run, 'firebase.json'), JSON.stringify(config));
const script = resolve(root, process.argv[2] || 'qa/scripts/e1-operations-emulator.test.cjs');
if (!script.startsWith(join(root, 'qa', 'scripts') + '/') && !script.startsWith(join(root, 'qa', 'scripts') + '\\')) throw Error('Only local QA scripts are accepted');
if (!existsSync(script)) throw Error('QA script missing');
const env = { ...process.env, GCLOUD_PROJECT: project, GOOGLE_CLOUD_PROJECT: project, FIRESTORE_EMULATOR_HOST: `127.0.0.1:${firestore}`, FIREBASE_EMULATORS_PATH: cache, XDG_CONFIG_HOME: join(run, 'config'), TMPDIR: run, TEMP: run, TMP: run, CI: 'true', FIREBASE_CLI_DISABLE_USAGE: 'true' };
delete env.GOOGLE_APPLICATION_CREDENTIALS;
delete env.FIREBASE_TOKEN;
delete env.FIREBASE_CONFIG;
delete env.DEBUG;
console.log(JSON.stringify({ project, ports: { firestore, websocketPort, hub, logging }, artifacts: run }));
const child = spawn(process.execPath, [cli, 'emulators:exec', '--only', 'firestore', '--project', project, '--config', join(run, 'firebase.json'), `node "${script}"`], { cwd: run, env, stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
