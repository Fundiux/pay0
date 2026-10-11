import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { buildMode } from '../../scripts/build-functions.mjs';
import { verifyInstalled } from '../../scripts/install-functions-internal-bundle.mjs';
import { sha256, treeRows, checkedPath, assertSnapshot, currentHash } from '../../scripts/lib/functions-bundle-integrity.mjs';
import { cliRoot, verifyCloudBuildContract } from './helpers/functions-upload-contract.mjs';

// Never forward worker stderr: it may contain private paths or source details.
const workerStages = ['CONTRACT_OK', 'PACK_BEGIN', 'PACK_RETURN', 'ZIP_READ', 'CRC_OK', 'ROWS_OK', 'ZIP_REMOVED', 'RESULT_READY'];
export function createUploadProgressWriter(file, write = fs.writeFileSync, now = Date.now) {
  const started = now();
  return stage => {
    try { write(file, JSON.stringify({ stage, elapsedMs: now() - started })); return true; }
    catch { return false; } // Optional diagnostics must not replace the real result.
  };
}
export function uploadWorkerDiagnostic(child, elapsedMs, progress) {
  const knownErrors = ['ETIMEDOUT', 'ENOENT', 'EACCES', 'EPERM', 'ENOBUFS'];
  const knownCodes = ['REDACTED', 'CLI_VERSION_UNREVIEWED', 'CLI_CODE_UNREVIEWED',
    'ZIP_PRIVATE_SCOPE', 'ZIP_ENTRY_SCOPE', 'ZIP_CONTENT_MISMATCH', 'UPLOAD_ARGUMENTS'];
  let workerCode = null;
  const stderr = typeof child.stderr === 'string' ? child.stderr : '';
  if (Buffer.byteLength(stderr) <= 512) {
    try {
      const row = JSON.parse(stderr);
      if (row.result === 'UPLOAD_VERIFICATION_FAILED' && knownCodes.includes(row.code)) workerCode = row.code;
    } catch { /* Non-protocol output stays redacted. */ }
  }
  return {
    status: Number.isInteger(child.status) ? child.status : null,
    signal: ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGABRT'].includes(child.signal) ? child.signal : null,
    errorCode: child.error ? (knownErrors.includes(child.error.code) ? child.error.code : 'REDACTED') : null,
    workerCode, elapsedMs: Number.isSafeInteger(elapsedMs) && elapsedMs >= 0 ? elapsedMs : null,
    ...(workerStages.includes(progress?.stage) && Number.isSafeInteger(progress.elapsedMs) && progress.elapsedMs >= 0
      ? { stage: progress.stage, stageElapsedMs: progress.elapsedMs } : {}),
  };
}

export async function verifyArchive({ repositoryRoot, expected, config = {}, toolsRoot = cliRoot(), onProgress = () => {} }) {
  const root = fs.realpathSync(repositoryRoot), source = path.join(root, 'functions');
  await verifyCloudBuildContract(toolsRoot);
  onProgress('CONTRACT_OK');
  const require = createRequire(path.join(toolsRoot, 'package.json'));
  // This process is isolated by the caller. No file logger is installed and
  // ordinary packer path/size messages are disabled, not forwarded to stdout.
  require('./lib/logger').logger.silent = true;
  const pack = require('./lib/deploy/functions/prepareFunctionsUpload').prepareFunctionsUpload;
  const JSZip = createRequire(path.join(root, 'functions/package.json'))('jszip');
  onProgress('PACK_BEGIN');
  const packed = await pack(root, source, structuredClone(config), [], undefined);
  onProgress('PACK_RETURN');
  const privateTemp = fs.realpathSync(process.env.TMPDIR || process.env.TEMP || '');
  const archivePath = fs.realpathSync(packed.pathToSource);
  if (!archivePath.startsWith(privateTemp + path.sep) || !privateTemp.startsWith(root + path.sep)) throw Error('ZIP_PRIVATE_SCOPE');
  try {
    const bytes = fs.readFileSync(archivePath);
    onProgress('ZIP_READ');
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
    onProgress('CRC_OK');
    const names = Object.keys(zip.files);
    if (names.some(name => name.includes('\\') || name.split('/').includes('..') || name.startsWith('/') || name.split('/').includes('node_modules'))) throw Error('ZIP_ENTRY_SCOPE');
    for (const row of expected) {
      checkedPath(source, row.file);
      const entry = zip.file(row.file);
      if (!entry || sha256(await entry.async('nodebuffer')) !== row.sha256) throw Error('ZIP_CONTENT_MISMATCH');
    }
    onProgress('ROWS_OK');
    return { result: 'UPLOAD_ARTIFACT_VERIFIED', filesVerified: expected.length, archiveSha256: sha256(bytes), cloudCalls: 0, actualUploadVerified: false };
  } finally { fs.unlinkSync(archivePath); onProgress('ZIP_REMOVED'); }
}
export function verifyUploadGate({ repositoryRoot = path.resolve(import.meta.dirname, '../..'), environment = process.env } = {}) {
  if (buildMode(environment) === 'NORMAL') return { result: 'NORMAL_BUILD_NO_BUNDLE_CLAIM' };
  const root = fs.realpathSync(repositoryRoot), report = verifyInstalled(root);
  const expected = report.outputs.map(row => ({ ...row, file: row.file.slice('functions/'.length) }));
  for (const relative of ['functions/src', 'functions/package.json', 'functions/package-lock.json', 'functions/tsconfig.json']) {
    expected.push(...treeRows(root, relative).map(row => ({ ...row, file: row.file.slice('functions/'.length) })));
  }
  // Preserve existing dotenv bytes without emitting values or per-file hashes.
  // The selector is a build-process control, never a Functions runtime key.
  for (const name of fs.readdirSync(path.join(root, 'functions')).filter(name => /^\.env(?:\.|$)/.test(name))) {
    const file = checkedPath(root, `functions/${name}`), bytes = fs.readFileSync(file);
    if (/^\s*(?:export\s+)?PAY0_FUNCTIONS_BUILD_MODE\s*=/m.test(bytes.toString('utf8'))) throw Error('SELECTOR_IN_DOTENV');
    expected.push({ file: name, sha256: sha256(bytes) });
  }
  const firebaseBytes = fs.readFileSync(path.join(root, 'firebase.json'));
  const config = JSON.parse(firebaseBytes.toString('utf8')).functions;
  if (Array.isArray(config) || config.source !== 'functions') throw Error('FUNCTIONS_CONFIG_SCOPE');
  const privateRelative = `.firebase/internal-bundle-upload/${randomUUID()}`, privateRoot = checkedPath(root, privateRelative);
  fs.mkdirSync(privateRoot, { recursive: true });
  const request = path.join(privateRoot, 'request.json');
  fs.writeFileSync(request, JSON.stringify({ repositoryRoot: root, expected, config: config.ignore ? { ignore: config.ignore } : {}, toolsRoot: cliRoot(environment) }));
  const started = Date.now();
  const child = spawnSync(process.execPath, [path.resolve(import.meta.dirname, 'verify-functions-upload-artifact.mjs'), '--worker', request], { cwd: privateRoot, env: { ...environment, DEBUG: '', TEMP: privateRoot, TMP: privateRoot, TMPDIR: privateRoot }, encoding: 'utf8', maxBuffer: 65536, timeout: 120000, windowsHide: true });
  if (child.status !== 0) {
    let progress;
    try {
      const progressFile = path.join(privateRoot, 'worker-progress.json');
      if (fs.statSync(progressFile).size <= 4096) {
        const bytes = fs.readFileSync(progressFile);
        if (bytes.length <= 4096) progress = JSON.parse(bytes.toString('utf8'));
      }
    } catch { /* Optional diagnostics never mask the failure. */ }
    throw Object.assign(Error('UPLOAD_WORKER_FAILED'), { worker: uploadWorkerDiagnostic(child, Date.now() - started, progress) });
  }
  let result; try { result = JSON.parse(child.stdout); } catch { throw Error('UPLOAD_WORKER_OUTPUT'); }
  if (result.result !== 'UPLOAD_ARTIFACT_VERIFIED') throw Error('UPLOAD_WORKER_OUTPUT');
  assertSnapshot(root, report.sourceInputs); verifyInstalled(root);
  if (currentHash(path.join(root, 'firebase.json')) !== sha256(firebaseBytes)) throw Error('PACK_CONFIG_DRIFT');
  for (const row of expected) if (currentHash(checkedPath(path.join(root, 'functions'), row.file)) !== row.sha256) throw Error('PACK_INPUT_DRIFT');
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    let result;
    if (process.argv.length === 4 && process.argv[2] === '--worker') {
      const progressFile = path.join(path.dirname(process.argv[3]), 'worker-progress.json');
      const onProgress = createUploadProgressWriter(progressFile);
      result = await verifyArchive({ ...JSON.parse(fs.readFileSync(process.argv[3], 'utf8')), onProgress });
      onProgress('RESULT_READY');
    }
    else if (process.argv.length === 2) result = verifyUploadGate();
    else throw Error('UPLOAD_ARGUMENTS');
    console.log(JSON.stringify(result));
  } catch (error) { console.error(JSON.stringify({ result: 'UPLOAD_VERIFICATION_FAILED', code: /^[A-Z_]+$/.test(error.message) ? error.message : 'REDACTED', ...(error.worker ? { worker: error.worker } : {}) })); process.exitCode = 1; }
}
