// Acceptance of the real appendHugoVoiceHistory module (saveHugoVoiceHistory appendOnly path) transpiled in Node.
// Firestore transport is synthetic; no production calls. Mirrors the cases certified on the 539b66da overlay.
const fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto'), path = require('node:path');
const assert = require('node:assert/strict');
const ts = require(require.resolve('typescript', { paths: [path.resolve(__dirname, '../../functions'), process.cwd()] }));
const root = path.resolve(__dirname, '../..');
class Timestamp { constructor(value) { this.value = value; } toMillis() { return this.value; } static now() { return new Timestamp(Date.now()); } }
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const clone = value => value instanceof Timestamp ? new Timestamp(value.value) : Array.isArray(value) ? value.map(clone) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) : value;
const modules = {};
function load(name) {
  if (modules[name]) return modules[name];
  const aliases = { authGuard: 'functions/src/utils/authGuard.ts', usersAuthorization: 'functions/src/modules/users/authorization.ts',
    defaultModules: 'functions/src/modules/users/defaultModules.ts', restrictions: 'functions/src/modules/users/restrictions.ts',
    'authorizationPolicy.generated': 'functions/src/modules/users/authorizationPolicy.generated.ts' };
  const file = path.join(root, aliases[name] || `functions/src/modules/agent007/${name}.ts`), source = fs.readFileSync(file, 'utf8');
  const result = ts.transpileModule(source, { fileName: file, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, strict: true } });
  assert.equal((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} }; modules[name] = module.exports;
  const requireModule = id => {
    if (id === 'node:crypto') return crypto;
    if (id === 'firebase-admin/firestore') return { Timestamp };
    if (id === 'firebase-functions/v2/https') return { HttpsError };
    if (id === 'firebase-functions') return { https: { HttpsError } };
    if (id === '../../utils/authGuard') return load('authGuard');
    if (id === '../modules/users/authorization') return load('usersAuthorization');
    if (['./defaultModules', './restrictions', './authorizationPolicy.generated'].includes(id)) return load(id.slice(2));
    throw new Error('Unexpected dependency: ' + id);
  };
  vm.runInThisContext(`(function(require,module,exports){${result.outputText}\n})`, { filename: file })(requireModule, module, module.exports);
  modules[name] = module.exports; return module.exports;
}
const append = load('voiceHistoryAppend').appendHugoVoiceHistory;
const prefix = 'agent007Conversations/root_owner_global', sessionPath = prefix + '/voiceSessions/native';
const sid = (turn, speaker, response = 'input') => crypto.createHash('sha256').update(`${turn}:${speaker}:${response}`).digest('hex').slice(0, 40);
const sourcePath = `${sessionPath}/turns/${sid('answer', 'HUGO', 'response')}`;
const common = { rootId: 'root', ownerUid: 'owner', sessionId: 'native', status: 'COMPLETED', interrupted: false, transcriptionStatus: 'REALTIME_NATIVE' };
function fixture() {
  const rows = new Map(), versions = new Map(); let writes = 0, failCommit = false;
  rows.set('users/owner', { role: 'superadmin', status: 'ACTIVE', rootId: 'root' });
  rows.set(prefix, { rootId: 'root', ownerUid: 'owner', status: 'ACTIVE' });
  rows.set(sessionPath, { rootId: 'root', ownerUid: 'owner', sessionId: 'native', conversationId: 'root_owner_global', gatewayCallId: 'gateway', status: 'ACTIVE' });
  rows.set(sourcePath, { ...common, speaker: 'HUGO', turnId: 'answer', responseId: 'response', text: 'Respuesta original', timestampMs: 10, responseCorrection: { memoryId: 'memory', version: 1 } });
  const ref = p => ({ path: p, id: p.split('/').at(-1), collection: name => ({ doc: id => ref(`${p}/${name}/${id}`) }) });
  const db = { doc: ref, runTransaction: async callback => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const pending = [], readVersions = new Map();
      const result = await callback({ get: async r => {
        assert.equal(pending.length, 0, 'Firestore requires all reads before writes');
        readVersions.set(r.path, versions.get(r.path) || 0);
        const data = clone(rows.get(r.path));
        return { id: r.id, data: () => clone(data), exists: rows.has(r.path) };
      }, update: (r, value) => pending.push([r.path, value, 'update']),
      create: (r, value) => pending.push([r.path, value, 'create']),
      set: (r, value, options) => pending.push([r.path, value, options?.merge ? 'update' : 'set']) });
      if ([...readVersions].some(([p, version]) => (versions.get(p) || 0) !== version)) continue;
      if (pending.length && failCommit) { failCommit = false; throw new Error('SIMULATED_COMMIT_FAILURE'); }
      for (const [p, value, kind] of pending) {
        if (kind === 'create') assert(!rows.has(p));
        rows.set(p, kind === 'update' ? { ...rows.get(p), ...clone(value) } : clone(value));
        versions.set(p, (versions.get(p) || 0) + 1); writes++;
      }
      return result;
    }
    throw new Error('SYNTHETIC_TRANSACTION_RETRY_LIMIT');
  } };
  return { rows, db, writes: () => writes, failNextCommit: () => { failCommit = true; } };
}
let cases = 0;
async function reject(action, f) { const count = f.writes(); await assert.rejects(action); assert.equal(f.writes(), count, 'No partial writes'); cases++; }
(async () => {
  const actor = { uid: 'owner', rootId: 'root', conversationId: 'root_owner_global' };
  const userTurn = { ...common, speaker: 'USER', turnId: 'appended', text: 'Nueva declaración', timestampMs: 123 };
  const data = { sessionId: 'native', gatewayCallId: 'gateway', appendOnly: true, turns: [userTurn] };

  let f = fixture();
  Object.assign(f.rows.get(sessionPath), { audioUsage: { input: 321, output: 44 }, durationMs: 999, costs: { voiceCostUsd: 0.125 },
    model: 'preserved-model', voice: 'preserved-voice', endedAt: null, gateway: { revision: 'preserved' }, realtime: { vad: { type: 'preserved' } } });
  const originalSession = clone(f.rows.get(sessionPath));
  const receipt = await append(f.db, actor, data);
  assert.deepEqual({ ok: receipt.ok, appendOnly: receipt.appendOnly, appended: receipt.appended }, { ok: true, appendOnly: true, appended: 1 });
  for (const [key, value] of Object.entries(originalSession)) assert.deepEqual(f.rows.get(sessionPath)[key], value, `session.${key} preserved`);
  const stored = f.rows.get(`${sessionPath}/turns/${sid('appended', 'USER')}`);
  assert.equal(stored.text, 'Nueva declaración'); assert.equal(stored.ownerUid, 'owner'); cases++;
  const writesAfterFirst = f.writes(); await append(f.db, actor, data);
  assert.equal(f.rows.get(`${sessionPath}/turns/${sid('appended', 'USER')}`).text, 'Nueva declaración'); assert(f.writes() > writesAfterFirst); cases++;

  f = fixture(); f.rows.delete(sessionPath); f.rows.delete(prefix);
  await append(f.db, actor, data);
  assert.equal(f.rows.get(sessionPath).status, 'ACTIVE'); assert.equal(f.rows.get(sessionPath).gatewayCallId, 'gateway');
  assert.equal(f.rows.get(sessionPath).audioStored, false); assert.equal(f.rows.get(prefix).ownerUid, 'owner'); cases++;

  f = fixture(); f.rows.get(sessionPath).status = 'COMPLETED'; await reject(() => append(f.db, actor, data), f);
  f = fixture(); f.rows.get(sessionPath).gatewayCallId = 'foreign'; await reject(() => append(f.db, actor, data), f);
  f = fixture(); f.rows.get(sessionPath).ownerUid = 'intruder'; await reject(() => append(f.db, actor, data), f);
  f = fixture(); f.rows.get(prefix).status = 'DELETED'; await reject(() => append(f.db, actor, data), f);
  f = fixture(); f.rows.get('users/owner').active = false; await reject(() => append(f.db, actor, data), f);
  f = fixture(); f.rows.get('users/owner').role = 'admin'; await reject(() => append(f.db, actor, data), f);
  f = fixture(); f.rows.get('users/owner').rootId = 'other'; await reject(() => append(f.db, actor, data), f);
  f = fixture(); await reject(() => append(f.db, { ...actor, conversationId: 'root_other_global' }, data), f);
  f = fixture(); await reject(() => append(f.db, actor, { ...data, gatewayCallId: undefined }), f);
  f = fixture(); await reject(() => append(f.db, actor, { ...data, events: [{ type: 'session.created' }] }), f);
  f = fixture(); await reject(() => append(f.db, actor, { ...data, turns: [{ ...userTurn, interrupted: true }] }), f);
  f = fixture(); await reject(() => append(f.db, actor, { ...data, turns: [{ ...userTurn, speaker: 'HUGO' }] }), f);
  f = fixture(); await reject(() => append(f.db, actor, { ...data, turns: [userTurn, userTurn] }), f);
  f = fixture(); await reject(() => append(f.db, actor, { ...data, turns: Array.from({ length: 201 }, (_, i) => ({ ...userTurn, turnId: `t${i}` })) }), f);
  f = fixture(); await reject(() => append(f.db, actor, { ...data, turns: [{ ...f.rows.get(sourcePath), text: 'alteración' }] }), f);
  f = fixture(); f.failNextCommit(); const before = JSON.stringify([...f.rows]);
  await reject(() => append(f.db, actor, data), f); assert.equal(JSON.stringify([...f.rows]), before);

  const wrapper = fs.readFileSync(path.join(root, 'functions/src/modules/agent007/voiceHistory.ts'), 'utf8');
  const guardIndex = wrapper.indexOf('if (!validId(sessionId))'), appendIndex = wrapper.indexOf('if (data.appendOnly === true) return appendHugoVoiceHistory(db, actor, data);');
  assert(guardIndex > 0 && appendIndex > guardIndex, 'appendOnly dispatch runs after authenticated identity and session validation');
  assert(wrapper.indexOf('const actor = await identity(request)') < appendIndex); cases++;
  console.log(JSON.stringify({ status: 'PASS', cases, scope: 'real-module-synthetic-firestore-transport', production_changes: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
