// Real public-entry integration of three separately pinned TEXT artifacts.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const Zip = require('../../functions/node_modules/jszip');
const root = path.resolve(__dirname, '../..');
assert.match(process.env.GCLOUD_PROJECT || '', /^demo-pay0-e1-/); assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/);
const paths = {};
for (const [kind, variable] of [['chat', 'PAY0_CORRECTIONS_CHAT'], ['readers', 'PAY0_CORRECTIONS_READERS'], ['producer', 'PAY0_CORRECTIONS_PRODUCER']]) {
  const directory = path.resolve(root, process.env[variable] || ''); assert(directory.startsWith(path.join(root, '.firebase/modular-release') + path.sep), 'PRIVATE_ARTIFACT_REQUIRED');
  paths[kind] = directory;
}
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function verify() {
  for (const [kind, directory] of Object.entries(paths)) {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'))), name = kind === 'chat' ? 'conversation-corrections-chat.zip' : `conversation-corrections-memory-${kind}.zip`;
    const bytes = fs.readFileSync(path.join(directory, name)); assert.equal(sha(bytes), manifest.archiveSha256, 'ARCHIVE_CHANGED');
    const zip = await Zip.loadAsync(bytes);
    for (const entry of Object.values(zip.files)) if (!entry.dir) assert(fs.readFileSync(path.join(directory, 'runtime', entry.name)).equals(await entry.async('nodebuffer')), 'RUNTIME_CHANGED:' + entry.name);
  }
}
(async () => {
  await verify();
  const scenario = process.env.PAY0_MEMORY_CASES || 'SCOPE'; assert(['SCOPE', 'TEXT'].includes(scenario), 'EXACT_SCENARIO_REQUIRED');
  const commit = scenario === 'TEXT' ? '40bf096fcdd81c0a40e33c5574444a8f8c672e1e' : '0382fcc97a42ed6064e3528c8d99faaca9f753f3';
  const file = scenario === 'TEXT' ? 'qa/scripts/conversation-corrections-emulator.test.cjs' : 'qa/scripts/conversation-correction-scope-emulator.test.cjs';
  const original = execFileSync('git', ['show', commit + ':' + file], { cwd: root }).toString('utf8');
  let source = original;
  const replace = (before, after) => { assert.equal(source.split(before).length, 2, 'QA_ADAPTATION_ANCHOR'); source = source.replace(before, after); };
  replace("const workspace = path.resolve(__dirname, '../..');", `const workspace = ${JSON.stringify(root)};`);
  const route = `{...require(${JSON.stringify(path.join(paths.chat, 'runtime'))}),createAgent007MemoryCandidate:require(${JSON.stringify(path.join(paths.producer, 'runtime'))}).createAgent007MemoryCandidate,listAgent007MemoryDiagnostics:require(${JSON.stringify(path.join(paths.readers, 'runtime'))}).listAgent007MemoryDiagnostics,reviewAgent007MemoryCandidate:require(${JSON.stringify(path.join(paths.readers, 'runtime'))}).reviewAgent007MemoryCandidate}`;
  if (scenario === 'SCOPE') {
    replace("require('../../functions/node_modules/firebase-admin')", `require(${JSON.stringify(path.join(paths.chat, 'runtime/node_modules/firebase-admin'))})`);
    replace("api = require(path.join(library, 'modules/agent007/callables'))", `api = ${route}`);
  } else replace("const api = require(base + 'callables'),", `const api = ${route},`);
  const extra = `  await t.test('public reader isolates owner and public reviewer protects private supersession', async () => {
    const own = await invoke('listAgent007MemoryDiagnostics', {}), another = await invoke('listAgent007MemoryDiagnostics', {}, other);
    assert(own.memories.some(row => row.id === clientResult.id)); assert(!another.memories.some(row => row.id === clientResult.id));
    await assert.rejects(invoke('createAgent007MemoryCandidate', payload('scope-client', {kind:'CLIENT'}), other), error => error.code === 'permission-denied');
    const candidate = await invoke('createAgent007MemoryCandidate', {kind:'USER_STATEMENT',content:'Declaracion generica sintetica',entityReference:{sourceSystem:'HUGO',entityType:'CONVERSATION',entityId:conversationId,displayReference:'Conversacion sintetica'}}, other);
    await assert.rejects(invoke('reviewAgent007MemoryCandidate', {memoryId:candidate.id,decision:'CONFIRM',supersedesId:clientResult.id}, other), error => error.code === 'permission-denied');
    assert.equal((await db.doc('agent007Memory/'+clientResult.id).get()).get('status'),'CONFIRMED');
  });
  await t.test('public legacy create/review stays usable and revoked users cannot mutate corrections', async () => {
    const legacy = await invoke('createAgent007MemoryCandidate',{kind:'PREFERENCE',content:'Explica brevemente el estado sintetico.'}); assert.equal(legacy.status,'CANDIDATE');
    assert.equal((await invoke('reviewAgent007MemoryCandidate',{memoryId:legacy.id,decision:'CONFIRM'})).changed,true);
    for(const patch of [{active:false},{active:true,role:'operador'},{role:'superadmin',rootId:'foreign-root'}]){
      await db.doc('users/'+uid).update(patch);
      await assert.rejects(invoke('createAgent007MemoryCandidate',payload('scope-client',{kind:'CLIENT'})),error=>error.code==='permission-denied');
      await assert.rejects(invoke('reviewAgent007MemoryCandidate',{memoryId:clientResult.id,decision:'REJECT'}),error=>['permission-denied','not-found'].includes(error.code));
    }
    await db.doc('users/'+uid).set({rootId,role:'superadmin',active:true});
  });
`;
  if (scenario === 'SCOPE') replace("  await t.test('owner can withdraw guidance; another actor cannot withdraw it'", extra + "  await t.test('owner can withdraw guidance; another actor cannot withdraw it'");
  process.env.PAY0_CORRECTIONS_LIB = path.join(paths.chat, 'runtime/lib');
  process.env.PAY0_CORRECTIONS_SCOPE = 'TEXT';
  const target = path.join(paths.readers, `qa-combined-memory-${scenario.toLowerCase()}.cjs`); fs.writeFileSync(target, source);
  fs.writeFileSync(path.join(paths.readers, `combined-qa-${scenario.toLowerCase()}-provenance.json`), JSON.stringify({ originalCommit: commit, file, originalSha256: sha(Buffer.from(original)), adaptedSha256: sha(Buffer.from(source)), adaptation: 'Public-entry producer/readers routing; chat exact datastore lookup; SCOPE adds two authorization/legacy checks', scope: 'THREE_ARTIFACT_PUBLIC_ENTRIES', scenario, productionWrites: 0 }, null, 2));
  require(target);
  require('node:test').after(async () => { await verify(); console.log(JSON.stringify({ scope: 'THREE_ARTIFACT_PUBLIC_ENTRIES', byteChecks: 'PASS', productionWrites: 0 })); });
})().catch(error => { console.error(error.message); process.exitCode = 1; });
