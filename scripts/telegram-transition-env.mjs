import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const OWN = ['TELEGRAM_DOWNLOAD_TRANSPORT_MODE', 'TELEGRAM_DOWNLOAD_LEGACY_STARTED_AT', 'TELEGRAM_DOWNLOAD_LEGACY_DEADLINE'];
const MAX_WINDOW = 60 * 60_000;
const fail = () => { throw new Error('TELEGRAM_ENV_REJECTED'); };
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function firebaseParser() {
  let api;
  for (const name of ['firebase-tools/lib/functions/env.js', ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib/functions/env.js')] : [])]) {
    try { api = require(name); break; } catch {}
  }
  if (typeof api?.parse !== 'function' || typeof api?.validateKey !== 'function') fail();
  return text => {
    // parseStrict logs validation details. Use its constituent pure checks and redact all errors.
    try {
      const { envs, errors } = api.parse(text);
      if (errors.length) fail();
      for (const key of Object.keys(envs)) api.validateKey(key);
      return envs;
    } catch { fail(); }
  };
}
function scan(bytes, parse) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 1024 * 1024) fail();
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { fail(); }
  if (!Buffer.from(text).equals(bytes) || text.includes('\0')) fail();
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  const body = text.slice(bom.length);
  const lines = body.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g).filter(Boolean);
  const seen = new Set(), rows = [];
  for (const raw of lines) {
    const eol = raw.endsWith('\r\n') ? '\r\n' : raw.endsWith('\n') ? '\n' : raw.endsWith('\r') ? '\r' : '';
    const line = raw.slice(0, raw.length - eol.length);
    if (eol === '\r') fail();
    if (/^[ \t]*(?:#.*)?$/.test(line)) { rows.push({ raw, eol, key: null }); continue; }
    // Conservative single-line grammar. Multiline/unterminated quoting is deliberately refused.
    const match = /^[ \t]*(?:export[ \t]+)?([A-Z_][A-Z0-9_]*)[ \t]*=[ \t]*(.*)$/.exec(line);
    if (!match || seen.has(match[1])) fail();
    const [, key, value] = match;
    if (value.startsWith('"') ? !/^"(?:[^"\\]|\\.)*"[ \t]*(?:#.*)?$/.test(value) :
        value.startsWith("'") ? !/^'(?:[^'\\]|\\.)*'[ \t]*(?:#.*)?$/.test(value) : /["'`]/.test(value.split('#')[0])) fail();
    const parsedLine = parse(line);
    if (Object.keys(parsedLine).length !== 1 || !Object.hasOwn(parsedLine, key)) fail();
    seen.add(key); rows.push({ raw, eol, key });
  }
  const values = parse(text);
  if (Object.keys(values).length !== seen.size || [...seen].some(key => !Object.hasOwn(values, key))) fail();
  return { bom, rows, values, eol: rows.find(row => row.eol)?.eol || '\n' };
}
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail();
  const result = Date.parse(value);
  if (!Number.isFinite(result) || new Date(result).toISOString() !== value) fail();
  return result;
}
function validateState(state) {
  if (!state || state.schema !== 'PAY0-TELEGRAM-TRANSITION@1' || !['PREPARED','BRIDGE_APPLIED','FINAL_APPLIED'].includes(state.phase)) fail();
  if (Object.keys(state).sort().join(',') !== 'deadline,phase,schema,startedAt') fail();
  if (state.phase === 'FINAL_APPLIED' && state.startedAt === null && state.deadline === null) return state;
  const start = instant(state.startedAt), end = instant(state.deadline);
  if (start <= 0 || end <= start || end - start > MAX_WINDOW) fail();
  return state;
}
export function planTransition(bytes, { mode, nowMs, state = null }, parse) {
  if (!['bridge','final'].includes(mode) || !Number.isSafeInteger(nowMs) || nowMs <= 0 || typeof parse !== 'function') fail();
  const before = scan(bytes, parse);
  if (state) validateState(state);
  const currentMode = before.values[OWN[0]];
  if (currentMode !== undefined && !['LEGACY_BRIDGE','POST_FRAGMENT'].includes(currentMode)) fail();
  let nextState = state ? { ...state } : null;
  if (mode === 'bridge') {
    if (state?.phase === 'FINAL_APPLIED') fail();
    const hasStart = Object.hasOwn(before.values, OWN[1]), hasEnd = Object.hasOwn(before.values, OWN[2]);
    if (hasStart || hasEnd || currentMode === 'LEGACY_BRIDGE') {
      if (!hasStart || !hasEnd || currentMode !== 'LEGACY_BRIDGE') fail();
      const old = validateState({ schema: 'PAY0-TELEGRAM-TRANSITION@1', phase: 'PREPARED', startedAt: before.values[OWN[1]], deadline: before.values[OWN[2]] });
      if (state && (state.startedAt !== old.startedAt || state.deadline !== old.deadline)) fail();
      nextState ||= old;
    }
    nextState ||= { schema: 'PAY0-TELEGRAM-TRANSITION@1', phase: 'PREPARED', startedAt: new Date(nowMs).toISOString(), deadline: new Date(nowMs + MAX_WINDOW).toISOString() };
    if (nowMs < instant(nextState.startedAt) || nowMs >= instant(nextState.deadline)) fail();
  }
  if (mode === 'final' && !nextState) nextState = { schema: 'PAY0-TELEGRAM-TRANSITION@1', phase: 'FINAL_APPLIED', startedAt: null, deadline: null };
  const replacement = { [OWN[0]]: mode === 'bridge' ? 'LEGACY_BRIDGE' : 'POST_FRAGMENT' };
  if (mode === 'bridge') Object.assign(replacement, { [OWN[1]]: nextState.startedAt, [OWN[2]]: nextState.deadline });
  const remaining = new Set(Object.keys(replacement));
  let output = before.bom;
  for (const row of before.rows) {
    if (!OWN.includes(row.key)) output += row.raw;
    else if (Object.hasOwn(replacement, row.key)) { output += `${row.key}=${replacement[row.key]}${row.eol}`; remaining.delete(row.key); }
  }
  if (remaining.size) {
    if (output !== before.bom && !output.endsWith('\n')) output += before.eol;
    output += [...remaining].map(key => `${key}=${replacement[key]}${before.eol}`).join('');
  }
  const afterBytes = Buffer.from(output), after = scan(afterBytes, parse);
  const foreign = values => Object.entries(values).filter(([key]) => !OWN.includes(key)).sort(([a],[b]) => a.localeCompare(b));
  if (JSON.stringify(foreign(before.values)) !== JSON.stringify(foreign(after.values))) fail();
  // Every original foreign line is copied verbatim; only a missing EOF separator may be appended.
  const foreignBefore = before.rows.filter(row => !OWN.includes(row.key)).map(row => row.raw);
  const foreignAfter = after.rows.filter(row => !OWN.includes(row.key)).map(row => row.raw);
  if (foreignBefore.length !== foreignAfter.length || foreignBefore.some((raw, i) => raw !== foreignAfter[i] && !(i === foreignBefore.length - 1 && !raw.endsWith('\n') && foreignAfter[i] === raw + before.eol))) fail();
  if (after.values[OWN[0]] !== replacement[OWN[0]] || (mode === 'final' && (Object.hasOwn(after.values, OWN[1]) || Object.hasOwn(after.values, OWN[2])))) fail();
  return { bytes: afterBytes, beforeHash: sha256(bytes), afterHash: sha256(afterBytes), changed: !bytes.equals(afterBytes), state: nextState };
}
function assertRegular(target, directory = false) {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) fail();
}
function atomicWrite(target, bytes, mode = 0o600) {
  const temporary = path.join(path.dirname(target), `.transition-${randomUUID()}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', mode); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temporary, target);
  } finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
// Workspace injection exists for synthetic filesystem tests; CLI has no path override.
export function transitionLocal({ workspace, mode, execute = false, nowMs = Date.now(), parse = firebaseParser(), ignored = root => spawnSync('git', ['check-ignore', '--quiet', '--no-index', '.firebase/telegram-transition/check.env.backup'], { cwd: root, stdio: 'ignore' }).status === 0 }) {
  const root = fs.realpathSync(workspace), target = path.join(root, 'functions/.env.pay-0-system');
  assertRegular(path.join(root, 'functions'), true); assertRegular(target);
  const firebaseDir = path.join(root, '.firebase'), directory = path.join(firebaseDir, 'telegram-transition');
  for (const folder of [firebaseDir, directory]) if (fs.existsSync(folder)) assertRegular(folder, true);
  const statePath = path.join(directory, 'state.json');
  const readState = () => { if (!fs.existsSync(statePath)) return null; assertRegular(statePath); if (fs.statSync(statePath).size > 4096) fail(); return validateState(JSON.parse(fs.readFileSync(statePath, 'utf8'))); };
  const readTarget = () => { assertRegular(target); if (fs.statSync(target).size > 1024 * 1024) fail(); return fs.readFileSync(target); };
  if (!execute) {
    const plan = planTransition(readTarget(), { mode, nowMs, state: readState() }, parse);
    return { mode: 'DRY_RUN', changed: plan.changed, beforeHash: plan.beforeHash, afterHash: plan.afterHash };
  }
  if (!ignored(root)) fail();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const folder of [firebaseDir, directory]) assertRegular(folder, true);
  const lock = path.join(directory, 'transition.lock');
  const fd = fs.openSync(lock, 'wx', 0o600);
  try {
    const original = readTarget();
    const plan = planTransition(original, { mode, nowMs, state: readState() }, parse);
    if (!plan.changed) {
      // Adopt an existing bridge window even when its file bytes need no edit.
      atomicWrite(statePath, Buffer.from(JSON.stringify({ ...plan.state, phase: mode === 'bridge' ? 'BRIDGE_APPLIED' : 'FINAL_APPLIED' }, null, 2)+'\n'));
      return { mode: 'NO_CHANGE', changed: false, beforeHash: plan.beforeHash, afterHash: plan.afterHash };
    }
    const id = randomUUID(), backup = path.join(directory, `${id}.env.backup`), manifest = path.join(directory, `${id}.manifest.json`);
    atomicWrite(backup, original);
    if (sha256(fs.readFileSync(backup)) !== plan.beforeHash) fail();
    const journal = { schema: 'PAY0-TELEGRAM-LOCAL-CHANGE@1', at: new Date(nowMs).toISOString(), mode, phase: 'PREPARED', beforeHash: plan.beforeHash, afterHash: plan.afterHash, backup: path.basename(backup) };
    atomicWrite(manifest, Buffer.from(JSON.stringify(journal, null, 2)+'\n'));
    // Persist fixed window before target mutation. Recovery cannot silently renew it.
    if (plan.state) atomicWrite(statePath, Buffer.from(JSON.stringify({ ...plan.state, phase: mode === 'bridge' ? 'PREPARED' : 'FINAL_APPLIED' }, null, 2)+'\n'));
    if (sha256(readTarget()) !== plan.beforeHash) fail();
    // Stage secret-bearing bytes inside ignored directory, on the same workspace volume.
    const staged = path.join(directory, `${id}.env.staged`);
    atomicWrite(staged, plan.bytes, fs.statSync(target).mode & 0o777);
    try { fs.renameSync(staged, target); } finally { if (fs.existsSync(staged)) fs.unlinkSync(staged); }
    if (sha256(readTarget()) !== plan.afterHash) fail();
    if (plan.state) atomicWrite(statePath, Buffer.from(JSON.stringify({ ...plan.state, phase: mode === 'bridge' ? 'BRIDGE_APPLIED' : 'FINAL_APPLIED' }, null, 2)+'\n'));
    atomicWrite(manifest, Buffer.from(JSON.stringify({ ...journal, phase: 'APPLIED' }, null, 2)+'\n'));
    return { mode: 'APPLIED_LOCAL', changed: true, beforeHash: plan.beforeHash, afterHash: plan.afterHash };
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (![2,3].includes(args.length) || args[0] !== '--mode' || !['bridge','final'].includes(args[1]) || (args.length === 3 && args[2] !== '--execute-local')) fail();
    const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const result = transitionLocal({ workspace, mode: args[1], execute: args[2] === '--execute-local' });
    console.log(`TELEGRAM_ENV:${result.mode}`);
    console.log(`BYTE_CHANGE:${result.changed ? 'YES' : 'NO'}`);
    console.log(`SHA256_BEFORE:${result.beforeHash}`); console.log(`SHA256_AFTER:${result.afterHash}`);
  } catch { console.error('TELEGRAM_ENV:FAILED_REVIEW_REQUIRED'); process.exitCode = 1; }
}
