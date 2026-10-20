const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { createRequire } = require('node:module');
if (!/^demo-pay0-e1-/.test(process.env.GCLOUD_PROJECT || '') || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('ISOLATED_EMULATOR_REQUIRED');
const workspace = path.resolve(__dirname, '../..');
const directory = path.join(workspace, '.firebase/modular-release/d1-after-r15-candidate');
const runtime = path.join(directory, 'runtime');
const archive = fs.readFileSync(path.join(directory, 'd1-after-r15.zip'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const archiveSha256 = '763134cfafb9854ef2f1b24c25ada58b59d0d95e848c5070f3ad27d045abfc62';
assert.equal(sha(archive), archiveSha256, 'LEGACY_ARCHIVE_CHANGED');
const JSZip = require('../../functions/node_modules/jszip');
const loadLegacy = createRequire(path.join(runtime, 'package.json'));
const producerRuntime = path.resolve(process.env.PAY0_MEMORY_ROLLBACK_PRODUCER_RUNTIME || path.join(workspace, 'functions'));
const loadProducer = createRequire(path.join(producerRuntime, 'package.json'));
const producerArchivePath = process.env.PAY0_MEMORY_ROLLBACK_PRODUCER_ARCHIVE;
const producerArchiveSha256 = process.env.PAY0_MEMORY_ROLLBACK_PRODUCER_SHA;
if (process.env.PAY0_MEMORY_ROLLBACK_PRODUCER_RUNTIME) assert(producerArchivePath && /^[a-f0-9]{64}$/.test(producerArchiveSha256 || ''), 'EXACT_PRODUCER_ARCHIVE_REQUIRED');
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
let externalCalls = 0;
global.fetch = async () => { externalCalls++; throw Error('EXTERNAL_PROVIDER_FORBIDDEN'); };
for (const protocol of ['http', 'https']) {
  const api = require('node:' + protocol), original = api.request;
  api.request = function (url, ...args) {
    const host = typeof url === 'string' || url instanceof URL ? new URL(url).hostname : String(url.hostname || url.host || '').split(':')[0];
    assert.ok(['127.0.0.1', 'localhost'].includes(host), 'EXTERNAL_HTTP_FORBIDDEN');
    return original.call(this, url, ...args);
  };
}

(async () => {
  const zip = await JSZip.loadAsync(archive);
  const verifyLegacy = async () => {
    for (const entry of Object.values(zip.files)) if (!entry.dir) assert.deepEqual(fs.readFileSync(path.join(runtime, entry.name)), await entry.async('nodebuffer'), 'LEGACY_RUNTIME_CHANGED:' + entry.name);
  };
  await verifyLegacy();
  let producerZip;
  if (producerArchivePath) {
    const bytes = fs.readFileSync(producerArchivePath);
    assert.equal(sha(bytes), producerArchiveSha256, 'PRODUCER_ARCHIVE_CHANGED');
    producerZip = await JSZip.loadAsync(bytes);
  }
  const verifyProducer = async () => {
    if (producerZip) for (const entry of Object.values(producerZip.files)) if (!entry.dir) assert.deepEqual(fs.readFileSync(path.join(producerRuntime, entry.name)), await entry.async('nodebuffer'), 'PRODUCER_RUNTIME_CHANGED:' + entry.name);
  };
  await verifyProducer();
  const producerNames = ['callables', 'firestoreHugoDataStore', 'conversationCorrections'];
  const producerFiles = producerNames.map(name => path.join(producerRuntime, 'lib/modules/agent007', name + '.js'));
  const producerPins = producerFiles.map(file => ({ file: path.relative(workspace, file), sha256: sha(fs.readFileSync(file)) }));
  const current = producerZip ? loadProducer('./' + JSON.parse(fs.readFileSync(path.join(producerRuntime, 'package.json'), 'utf8')).main) : loadProducer('./lib/modules/agent007/callables');
  const { emptyConversationState } = loadProducer('./lib/modules/agent007/hugoCore/conversationState');
  const { FirestoreHugoDataStore } = loadLegacy('./lib/modules/agent007/firestoreHugoDataStore');
  const { HugoConversationCore } = loadLegacy('./lib/modules/agent007/hugoCore/conversationCore');
  const { buildHugoContextV2 } = loadLegacy('./lib/modules/agent007/hugoCore/contextBuilderV2');
  const { hugoV2Prompt } = loadLegacy('./lib/modules/agent007/hugoCore/hugoV2Prompt');
  const rootId = 'rollback-root', actors = ['rollback-owner-a', 'rollback-owner-b'];
  const privateContents = ['PRIVATE_CORRECTION_ALPHA', 'PRIVATE_CORRECTION_BETA'];
  const privateIds = [];
  for (const [index, uid] of actors.entries()) {
    const conversationId = `${rootId}_${uid}_global`, messageId = `rollback-answer-${index}`;
    await db.doc(`users/${uid}`).set({ rootId, role: 'superadmin', active: true });
    await db.doc(`agent007Conversations/${conversationId}`).set({ rootId, ownerUid: uid, status: 'ACTIVE', conversationState: { ...emptyConversationState(rootId), turn: 1 } });
    await db.doc(`agent007Messages/${messageId}`).set({ rootId, conversationId, role: 'assistant', recipientUid: uid, text: 'Original synthetic answer', turn: 1, createdAt: admin.firestore.Timestamp.now() });
    const result = await current.createAgent007MemoryCandidate.run({ auth: { uid, token: {} }, data: { kind: 'CONVERSATION_CORRECTION', content: privateContents[index], responseCorrection: { messageId, scope: 'GLOBAL', confirm: true, expectedVersion: 0, expectedText: 'Original synthetic answer', rememberFor: { kind: 'TOPIC', label: 'Synthetic private topic' } } } });
    const memory = (await db.doc(`agent007Memory/${result.id}`).get()).data();
    assert.equal(memory.kind, 'USER_STATEMENT'); assert.equal(memory.status, 'CONFIRMED'); assert.equal(memory.validUntil, null);
    assert.equal(memory.authorUid, uid); assert.equal(memory.entityKey, `HUGO:CONVERSATION:${conversationId}`); assert.equal(memory.scope.level, 'ENTITY');
    privateIds.push(result.id);
  }
  const publicId = 'rollback-public-memory';
  await db.doc(`agent007Memory/${publicId}`).set({ id: publicId, rootId, kind: 'USER_STATEMENT', status: 'CONFIRMED', source: 'EXPLICIT_HUMAN', sourceSystem: 'USER', authorUid: actors[0], content: 'SAFE_LEGACY_PUBLIC_MEMORY', entityKey: 'PAY0:SOLICITUD:synthetic-request', scope: { level: 'ENTITY', rootId, system: 'PAY0', entityType: 'SOLICITUD', entityId: 'synthetic-request' }, entityReference: { sourceSystem: 'PAY0', entityType: 'SOLICITUD', entityId: 'synthetic-request' }, createdAt: new Date().toISOString(), validUntil: null });

  const queriedKeys = [], returnedIds = [], captures = [];
  function queryProxy(query) {
    return new Proxy(query, { get(target, key) {
      if (key === 'where') return (...args) => { if (args[0] === 'entityKey') queriedKeys.push(args[2]); return queryProxy(target.where(...args)); };
      if (key === 'get') return async (...args) => { const result = await target.get(...args); returnedIds.push(...result.docs.map(doc => doc.id)); return result; };
      const value = Reflect.get(target, key); return typeof value === 'function' ? (...args) => { const result = value.apply(target, args); return result && typeof result.where === 'function' && typeof result.get === 'function' ? queryProxy(result) : result; } : value;
    } });
  }
  const observedDb = new Proxy(db, { get(target, key) {
    if (key === 'collection') return name => name === 'agent007Memory' ? queryProxy(target.collection(name)) : target.collection(name);
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const store = new FirestoreHugoDataStore(observedDb);
  const router = { assertIdentity: identity => { assert.equal(identity.rootId, rootId); assert(actors.includes(identity.uid)); assert.equal(identity.role, 'superadmin'); }, execute: async request => {
    const data = request.name === 'getSolicitud' ? { id: 'synthetic-request', folio: 'S12345', monto: 120, estado: 'PENDIENTE' } : request.name === 'getPago' ? { id: 'synthetic-payment', folio: 'P12345', monto: 34, estado: 'RECIBIDO' } : [];
    return { sourceSystem: 'PAY0', tool: request.name, scope: { rootId }, retrievedAt: new Date().toISOString(), completeness: ['getSolicitud', 'getPago'].includes(request.name) ? 'COMPLETE' : 'PARTIAL', evidence: [], data, trace: { latencyMs: 0, result: 'OK' } };
  } };
  const model = { generateCanonical: async request => {
    const prompt = hugoV2Prompt(request.task.userInput, request.task.name, request.intelligence.contextSnapshot, request.conversation.history);
    captures.push({ context: request.intelligence, prompt });
    return { text: 'Synthetic legacy response', answer: 'Synthetic legacy response', model: 'SYNTHETIC', modelVersion: 'test', promptVersion: 'hugo-v2', tokenUsage: null };
  } };
  const core = new HugoConversationCore(router, model, store);
  for (const uid of actors) {
    const context = await buildHugoContextV2({ message: 'Describe S12345 y P12345 con otras palabras.', rootId, conversationState: emptyConversationState(rootId), router, dataStore: store });
    const serialized = JSON.stringify(context);
    assert(serialized.includes(publicId), 'POSITIVE_LEGACY_MEMORY_CONTROL_NOT_READ');
    for (const sentinel of [...privateIds, ...privateContents]) assert(!serialized.includes(sentinel), 'PRIVATE_CORRECTION_IN_LEGACY_CONTEXT');
    const beforeCalls = captures.length;
    const output = await core.respond({ channel: 'WEB', conversationId: `${rootId}_${uid}_global`, identity: { uid, rootId, role: 'superadmin' }, name: 'Synthetic', message: 'Describe S12345 y P12345 con otras palabras.', scope: 'GLOBAL', promptVersion: 'hugo-v2' });
    assert(captures.length > beforeCalls, 'LEGACY_MODEL_PROMPT_PATH_NOT_EXERCISED');
    for (const sentinel of [...privateIds, ...privateContents]) assert(!JSON.stringify(output).includes(sentinel), 'PRIVATE_CORRECTION_IN_LEGACY_OUTPUT');
  }
  assert(queriedKeys.includes('PAY0:SOLICITUD:synthetic-request')); assert(queriedKeys.includes('PAY0:PAGO:synthetic-payment')); assert(queriedKeys.includes(null));
  assert(queriedKeys.every(key => key === null || /^PAY0:(SOLICITUD|PAGO):/.test(key)), 'NON_CHAT_ENTITY_KEY_QUERIED');
  assert(returnedIds.includes(publicId)); assert(privateIds.every(id => !returnedIds.includes(id)), 'PRIVATE_MEMORY_DOCUMENT_RETURNED');
  for (const capture of captures) for (const sentinel of [...privateIds, ...privateContents]) assert(!JSON.stringify(capture).includes(sentinel), 'PRIVATE_CORRECTION_IN_PROVIDER_PROMPT');
  for (const file of producerFiles) assert.equal(sha(fs.readFileSync(file)), producerPins.find(pin => pin.file === path.relative(workspace, file)).sha256, 'NEW_PRODUCER_CHANGED_DURING_TEST');
  await verifyLegacy(); await verifyProducer(); assert.equal(externalCalls, 0);
  const proof = { status: 'PASS', legacyArchiveSha256: archiveSha256, producerArchiveSha256: producerZip ? producerArchiveSha256 : null, newProducer: producerZip ? 'EXACT_ARCHIVE_PACKAGE_MAIN_REAL_FIRESTORE' : 'CURRENT_COMPILED_CANONICAL_CALLABLE_REAL_FIRESTORE', producerPins, actors: actors.length, actualPrivateRecords: privateIds.length, legacyContextRuns: actors.length, legacyCoreRuns: captures.length, queriedEntityKeys: [...new Set(queriedKeys)], privateMemoryRowsReturned: 0, privateCorrectionsInProviderPrompts: 0, ordinaryLegacyMemoryPreserved: true, externalProviders: 0, productionWrites: 0 };
  const proofPath = path.resolve(process.env.PAY0_MEMORY_ROLLBACK_PROOF || path.join(workspace, 'tmp', `memory-rollback-legacy-chat-${crypto.randomUUID()}.json`));
  assert(proofPath.startsWith(workspace + path.sep), 'PROOF_MUST_STAY_IN_WORKSPACE');
  fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(proof)); await admin.app().delete();
})().catch(error => { console.error(error); process.exitCode = 1; });
