import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { checkedPath, currentHash, sha256, assertSnapshot, treeRows } from './lib/functions-bundle-integrity.mjs';

const LOCK = '.firebase/internal-bundle-install.lock';
export const PROVENANCE = 'functions/.bundle-provenance.json';
const owned = relative => relative === PROVENANCE || /^functions\/(?:lib|\.debug\/compiled)\//.test(relative);
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
export function acquireBuildLock(root) {
  const file = checkedPath(root, LOCK);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const owner = { id: randomUUID(), pid: process.pid };
  fs.writeFileSync(file, JSON.stringify(owner), { flag: 'wx' });
  return { owner, release() {
    if (fs.readFileSync(file, 'utf8') !== JSON.stringify(owner)) throw Error('LOCK_OWNERSHIP');
    fs.unlinkSync(file);
  }};
}
function validateRows(base, rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 20000) throw Error('MANIFEST_ROWS');
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.file) || !/^[a-f0-9]{64}$/.test(row.sha256)) throw Error('MANIFEST_ROWS');
    seen.add(row.file);
    if (currentHash(checkedPath(base, row.file)) !== row.sha256) throw Error('ARTIFACT_DRIFT');
  }
}
export function verifyInstalled(root) {
  const report = JSON.parse(fs.readFileSync(checkedPath(root, PROVENANCE), 'utf8'));
  if (report.schema !== 'PAY0-INTERNAL-BUNDLE-INSTALLED@1' || report.mode !== 'BUNDLED_V1' || report.outputs.some(row => !owned(row.file) || row.file === PROVENANCE)) throw Error('INSTALLED_SCHEMA');
  assertSnapshot(root, report.sourceInputs);
  validateRows(root, report.outputs);
  return report;
}
export function restoreJournal(root, journalRelative) {
  if (!/^\.firebase\/internal-bundle-install\/[a-f0-9-]{36}\/journal.json$/.test(journalRelative)) throw Error('JOURNAL_SCOPE');
  const file = checkedPath(root, journalRelative), journal = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (journal.schema !== 'PAY0-BUNDLE-INSTALL-JOURNAL@1' || !Array.isArray(journal.files) || journal.files.length > 20000) throw Error('JOURNAL_SCHEMA');
  // Validate every target and backup before restoring anything. An external
  // mutation is retained for review; recovery never overwrites it.
  for (const row of journal.files) {
    if (!owned(row.file) || !/^\d+\.bak$/.test(row.backup)) throw Error('RECOVERY_SCOPE');
    const actual = currentHash(checkedPath(root, row.file));
    if (actual !== row.before && actual !== row.after) throw Error('RECOVERY_CONFLICT');
    if (row.before !== null && currentHash(checkedPath(root, `${path.posix.dirname(journalRelative)}/${row.backup}`)) !== row.before) throw Error('BACKUP_DRIFT');
  }
  for (const row of [...journal.files].reverse()) {
    const target = checkedPath(root, row.file), actual = currentHash(target);
    if (actual === row.before) continue;
    if (actual !== row.after) throw Error('RECOVERY_CONFLICT');
    if (row.before === null) fs.unlinkSync(target);
    else fs.writeFileSync(target, fs.readFileSync(checkedPath(root, `${path.posix.dirname(journalRelative)}/${row.backup}`)));
  }
  journal.status = 'RESTORED'; writeJson(file, journal);
  return { status: journal.status, files: journal.files.length };
}
export function recoverInstallation(root, id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('RECOVERY_ID');
  const file = checkedPath(root, LOCK), original = fs.readFileSync(file, 'utf8'), owner = JSON.parse(original);
  if (owner.id !== id || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw Error('LOCK_OWNERSHIP');
  try { process.kill(owner.pid, 0); throw Error('OWNER_STILL_ALIVE'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  const relative = `.firebase/internal-bundle-install/${id}/journal.json`, journal = JSON.parse(fs.readFileSync(checkedPath(root, relative), 'utf8'));
  if (JSON.stringify(journal.owner) !== JSON.stringify(owner)) throw Error('LOCK_OWNERSHIP');
  const result = restoreJournal(root, relative);
  if (fs.readFileSync(file, 'utf8') !== original) throw Error('LOCK_OWNERSHIP');
  fs.unlinkSync(file);
  return result;
}
export function installCandidate({ repositoryRoot, candidate, beforeWrite = () => {} }) {
  const root = fs.realpathSync(repositoryRoot);
  if (!/^\.firebase\/internal-bundle-candidates\/[^/]+$/.test(candidate)) throw Error('CANDIDATE_SCOPE');
  const directory = checkedPath(root, candidate), artifact = checkedPath(root, `${candidate}/artifact`), raw = checkedPath(root, `${candidate}/raw`);
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'provenance.json'), 'utf8'));
  if (report.schema !== 'PAY0-INTERNAL-BUNDLE-CANDIDATE@1' || report.esbuild !== '0.28.2') throw Error('CANDIDATE_SCHEMA');
  assertSnapshot(root, report.sourceInputs);
  validateRows(artifact, report.outputs); validateRows(raw, report.inputs);
  const byFile = (a,b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
  const actualOutputs = treeRows(root, `${candidate}/artifact`).map(row => ({ ...row, file: row.file.slice(`${candidate}/artifact/`.length) })).sort(byFile);
  if (JSON.stringify(actualOutputs) !== JSON.stringify([...report.outputs].sort(byFile))) throw Error('ARTIFACT_EXTRA_FILES');
  const planned = new Map();
  const readVerified = (base, row) => {
    const bytes = fs.readFileSync(checkedPath(base, row.file));
    if (sha256(bytes) !== row.sha256) throw Error('ARTIFACT_DRIFT');
    return bytes;
  };
  for (const row of report.inputs) {
    if (!/\.(?:js|json)$/.test(row.file)) throw Error('RAW_EXTENSION');
    if (row.file !== 'index.js') planned.set(`functions/lib/${row.file}`, readVerified(raw, row));
  }
  for (const row of report.outputs) {
    if (row.file === 'package.json') continue;
    if (!/^(?:lib\/assets\/|\.debug\/compiled\/)/.test(row.file) && !['lib/index.js', 'lib/index.js.map'].includes(row.file)) throw Error('OUTPUT_SCOPE');
    planned.set(`functions/${row.file}`, readVerified(artifact, row));
  }
  if (!planned.has('functions/lib/index.js') || !planned.has('functions/lib/index.js.map')) throw Error('ENTRY_REQUIRED');
  const outputs = [...planned].map(([file, bytes]) => ({ file, sha256: sha256(bytes) })).sort((a,b) => a.file.localeCompare(b.file));
  planned.set(PROVENANCE, Buffer.from(JSON.stringify({ schema: 'PAY0-INTERNAL-BUNDLE-INSTALLED@1', mode: 'BUNDLED_V1', sourceInputs: report.sourceInputs, outputs }, null, 2) + '\n'));
  // The entry is published last; none of the earlier paths is claimed to form
  // an atomic directory transaction. The owned lock blocks release builds.
  const order = [...planned.keys()].filter(file => file !== 'functions/lib/index.js').concat('functions/lib/index.js');
  const lock = acquireBuildLock(root), journalRelative = `.firebase/internal-bundle-install/${lock.owner.id}/journal.json`, journalFile = checkedPath(root, journalRelative);
  let safeRelease = false;
  const journal = { schema: 'PAY0-BUNDLE-INSTALL-JOURNAL@1', owner: lock.owner, status: 'PREPARED', files: [] };
  try {
    fs.mkdirSync(path.dirname(journalFile), { recursive: true });
    for (const [index, file] of order.entries()) {
      const target = checkedPath(root, file), before = currentHash(target), backup = `${index}.bak`;
      if (before !== null) fs.copyFileSync(target, path.join(path.dirname(journalFile), backup));
      if (before !== null && currentHash(path.join(path.dirname(journalFile), backup)) !== before) throw Error('BACKUP_DRIFT');
      journal.files.push({ file, before, after: sha256(planned.get(file)), backup });
    }
    writeJson(journalFile, journal);
    assertSnapshot(root, report.sourceInputs);
    for (const [index, row] of journal.files.entries()) {
      beforeWrite({ index, file: row.file });
      if (row.file === 'functions/lib/index.js') assertSnapshot(root, report.sourceInputs);
      const target = checkedPath(root, row.file);
      if (currentHash(target) !== row.before) throw Error('TARGET_DRIFT');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, planned.get(row.file));
    }
    verifyInstalled(root);
    journal.status = 'INSTALLED'; writeJson(journalFile, journal); safeRelease = true;
    return { status: 'INSTALLED', files: outputs.length, bundleSha256: sha256(planned.get('functions/lib/index.js')), journal: journalRelative };
  } catch (error) {
    if (fs.existsSync(journalFile)) {
      try { restoreJournal(root, journalRelative); safeRelease = true; } catch { throw Error('RECOVERY_REQUIRED'); }
    } else safeRelease = true;
    throw error;
  } finally { if (safeRelease) lock.release(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || !['--candidate', '--recover'].includes(args[0])) throw Error('EXPLICIT_CANDIDATE_REQUIRED');
    const repositoryRoot = path.resolve(import.meta.dirname, '..');
    console.log(JSON.stringify(args[0] === '--recover' ? recoverInstallation(repositoryRoot, args[1]) : installCandidate({ repositoryRoot, candidate: args[1] })));
  } catch (error) { console.error(JSON.stringify({ result: 'INSTALL_FAILED', code: /^[A-Z_]+$/.test(error.message) ? error.message : 'REDACTED' })); process.exitCode = 1; }
}
