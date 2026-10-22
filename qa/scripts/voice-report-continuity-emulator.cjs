// Exact public VOICE entry, real demo Firestore. Auth context is synthetic, not JWT/audio.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { createRequire } = require('node:module'), Zip = require('../../functions/node_modules/jszip');
assert(/^demo-pay0-e1-/.test(process.env.GCLOUD_PROJECT || ''), 'DEMO_REQUIRED');
assert(/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || ''), 'EMULATOR_REQUIRED');
const root = path.resolve(__dirname, '../..'), directory = path.resolve(root, process.env.PAY0_VOICE_REPORT_ARTIFACT || '');
assert(directory.startsWith(path.join(root, '.firebase/modular-release') + path.sep), 'PRIVATE_ARTIFACT');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'))), runtime = path.join(directory, 'runtime');
const bytes = fs.readFileSync(path.join(directory, 'voice-report-continuity.zip'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex'); assert.equal(sha(bytes), manifest.archiveSha256);
const port = Number(process.env.FIRESTORE_EMULATOR_HOST.split(':')[1]), net = require('node:net'), connect = net.Socket.prototype.connect;
let providers = 0;
net.Socket.prototype.connect = function (...args) {
  let first = args[0]; if (Array.isArray(first)) first = first[0];
  const host = typeof first === 'object' ? first.host : args[1], actualPort = typeof first === 'object' ? Number(first.port) : Number(first);
  if (actualPort !== port || !['localhost', '127.0.0.1'].includes(host)) { providers++; throw Error('NON_EMULATOR_NETWORK'); }
  return connect.apply(this, args);
};
const deny = () => { providers++; throw Error('PROVIDER_FORBIDDEN'); };
require('node:http').request = deny; require('node:https').request = deny; require('node:tls').connect = deny; global.fetch = deny;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS; process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: process.env.GCLOUD_PROJECT });
process.chdir(runtime);
const load = createRequire(path.join(runtime, 'package.json')), admin = load('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore(), entry = load('./' + load('./package.json').main), moduleEntry = load('./lib/modules/agent007/voiceDelegation.js');
assert.equal(entry.delegateHugoVoiceTurn, moduleEntry.delegateHugoVoiceTurn, 'PUBLIC_HANDLER_IDENTITY');
const uid = 'voice-report-owner', rootId = 'voice-report-root', other = 'voice-report-other', foreign = 'voice-report-foreign';
let sequence = 0, reads = [];
const collection = db.collection.bind(db); db.collection = name => { reads.push(name); return collection(name); };
const invoke = (request, sessionId = 'rtc-main', actor = uid, toolInput) => entry.delegateHugoVoiceTurn.run({ ...(actor ? { auth: { uid: actor, token: {} } } : {}), data: {
  request, sessionId, turnId: 'turn-' + (++sequence), delegationId: 'call-' + sequence,
  ...(toolInput ? { toolName: 'getEarningsByClientReport', toolInput } : {}) } });
const query = { dateFrom: '2026-09-01', dateTo: '2026-09-30', includeCompensated: false, limit: 5000 };
const queryFor = clientQuery => ({ ...query, clientQuery });
const contextRef = (sessionId = 'rtc-main', owner = uid, scope = rootId) => db.doc(`agent007Conversations/${scope}_${owner}_global/voiceReportContexts/${crypto.createHash('sha256').update(sessionId).digest('hex')}`);
async function verify() { const zip = await Zip.loadAsync(bytes); for (const item of Object.values(zip.files)) if (!item.dir) assert(fs.readFileSync(path.join(runtime, item.name)).equals(await item.async('nodebuffer')), 'RUNTIME_ARCHIVE_CHANGED'); }
async function run() {
  await verify();
  for (const actor of [uid, other, foreign]) await db.doc('users/' + actor).set({ role: 'superadmin', active: true, rootId: actor === foreign ? 'foreign-root' : rootId });
  for (const [id, clientId, name, month, scope] of [['alpha-current','alpha','Alpha Demo','09',rootId],['alpha-prior','alpha','Alpha Demo','08',rootId],['beta-current','beta','Beta Demo','09',rootId],['beta-prior','beta','Beta Demo','08',rootId],['foreign','foreign','Foreign Demo','09','foreign-root']]) {
    await db.doc('earningsDistributions/' + id).set({ rootId: scope, clienteId: clientId, clienteNombre: name, grossAmount: 100, totalEarningsAmount: month === '09' ? 12.35 : 10,
      createdAt: admin.firestore.Timestamp.fromDate(new Date(`2026-${month}-10T12:00:00Z`)) });
  }
  let checks = 0;
  await invoke('Consulta el reporte de utilidades por cliente.', 'rtc-main', uid, queryFor('Alpha Demo'));
  const direct = await contextRef().get(); assert.equal(direct.get('report.query.clientQuery'), 'Alpha Demo');
  const comparison = await invoke('Comparalo con 2026-08-01 al 2026-08-31');
  assert.equal(comparison.route, 'DETERMINISTIC_TOOL'); assert.match(comparison.text, /2026-08-01/); assert.match(comparison.text, /Alpha Demo/);
  assert.equal((await contextRef().get()).get('report.query.compareDateFrom'), '2026-08-01'); checks++;
  await invoke('Reporte de utilidades por cliente del 2026-09-01 al 2026-09-30', 'rtc-core');
  const coreComparison = await invoke('Comparalo con 2026-08-01 al 2026-08-31', 'rtc-core');
  assert.match(coreComparison.text, /2026-08-01/); assert.equal((await contextRef('rtc-core').get()).get('report.query.compareDateFrom'), '2026-08-01'); checks++;
  const parent = db.doc(`agent007Conversations/${rootId}_${uid}_global`);
  const textState = { version: 2, rootId, turn: 7, lastIntent: 'TEXT_SENTINEL', lastEarningsReport: { query: queryFor('Beta Demo'), resolvedAt: Date.now(), turn: 7 }, pendingEarningsReport: { stage: 'CLIENT', format: 'PDF' } };
  await parent.set({ rootId, ownerUid: uid, conversationState: textState }, { mergeFields: ['rootId','ownerUid','conversationState'] });
  await invoke('Reporte de utilidades por cliente del 2026-09-01 al 2026-09-30', 'rtc-text-preserved');
  assert.deepEqual((await parent.get()).get('conversationState'), textState, 'VOICE_REPORT_PRESERVES_TEXT_MAP'); checks++;
  reads = []; const missing = await invoke('Comparalo con 2026-08-01 al 2026-08-31', 'rtc-absent');
  assert.match(missing.text, /ambos periodos/); assert(!reads.some(name => ['pagos','solicitudes','iqRequests'].includes(name))); checks++;
  for (const [session, actor] of [['rtc-other',uid],['rtc-main',other],['rtc-main',foreign]]) {
    const denied = await invoke('Comparalo con 2026-08-01 al 2026-08-31', session, actor); assert.match(denied.text, /ambos periodos/); assert.doesNotMatch(denied.text, /Alpha Demo/);
  } checks++;
  await invoke('Consulta el reporte de utilidades por cliente.', 'rtc-stale', uid, query);
  await contextRef('rtc-stale').update({ 'report.resolvedAt': Date.now() - 31 * 60000 });
  assert.match((await invoke('Comparalo con 2026-08-01 al 2026-08-31','rtc-stale')).text, /ambos periodos/); checks++;
  await invoke('Consulta el reporte de utilidades por cliente.', 'rtc-greeting', uid, query);
  const correction = db.doc(`agent007Conversations/${rootId}_${uid}_global/voiceSessions/sess-fixture`);
  await correction.set({ rootId, ownerUid: uid, sentinel: 'SESSION_PRESERVED' }); const before = (await correction.get()).data();
  await invoke('hola Maria', 'rtc-greeting'); assert.deepEqual((await correction.get()).data(), before);
  assert.match((await invoke('Comparalo con 2026-08-01 al 2026-08-31','rtc-greeting')).text, /ambos periodos/); checks++;
  await invoke('Consulta el reporte de utilidades por cliente.', 'rtc-unavailable', uid, queryFor('Alpha Demo'));
  await db.doc('earningsDistributions/alpha-current').update({ rootId: 'foreign-root' });
  const unavailable = await invoke('Comparalo con 2026-08-01 al 2026-08-31', 'rtc-unavailable');
  assert.match(unavailable.text, /Confirma el cliente/); assert.doesNotMatch(unavailable.text, /Alpha Demo/);
  assert.equal((await contextRef('rtc-unavailable').get()).get('report'), undefined);
  await db.doc('earningsDistributions/alpha-current').update({ rootId }); checks++;
  await db.doc('users/' + uid).update({ role: 'admin' });
  await assert.rejects(invoke('Comparalo con 2026-08-01 al 2026-08-31'), error => error.code === 'permission-denied');
  await db.doc('users/' + uid).update({ role: 'superadmin' }); checks++;
  const proto = Object.getPrototypeOf(db.collection('earningsDistributions').where('rootId','==',rootId)), originalGet = proto.get;
  let release, started; const gate = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { started = resolve; }); let pause = true;
  proto.get = async function (...args) {
    if (pause && this._queryOptions?.collectionId === 'earningsDistributions') { pause = false; started(); await gate; }
    return originalGet.apply(this, args);
  };
  try {
    const a = invoke('Consulta el reporte de utilidades por cliente.', 'rtc-race', uid, queryFor('Alpha Demo'));
    const outcomeA = a.then(value => ({ value }), error => ({ error }));
    await Promise.race([entered, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('QUERY_DELAY_HOOK_NOT_REACHED')), 20000); timer.unref(); })]);
    await invoke('Consulta el reporte de utilidades por cliente.', 'rtc-race', uid, queryFor('Beta Demo')); release();
    assert.equal((await outcomeA).error?.code, 'failed-precondition');
    assert.equal((await contextRef('rtc-race').get()).get('report.query.clientQuery'), 'Beta Demo'); checks++;
  } finally { release(); proto.get = originalGet; }
  let resumeText, textStarted; const textGate = new Promise(resolve => { resumeText = resolve; }), textEntered = new Promise(resolve => { textStarted = resolve; }); let pauseText = true;
  proto.get = async function (...args) {
    if (pauseText && this._queryOptions?.collectionId === 'earningsDistributions') { pauseText = false; textStarted(); await textGate; }
    return originalGet.apply(this, args);
  };
  try {
    const pendingVoice = invoke('Reporte de utilidades por cliente del 2026-09-01 al 2026-09-30', 'rtc-text-concurrent');
    const voiceOutcome = pendingVoice.then(value => ({ value }), error => ({ error }));
    await Promise.race([textEntered, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('TEXT_QUERY_DELAY_HOOK_NOT_REACHED')), 20000); timer.unref(); })]);
    const latestText = { ...textState, turn: 8, lastIntent: 'TEXT_NEWER_SENTINEL', lastEarningsReport: { ...textState.lastEarningsReport, query: queryFor('Alpha Demo'), turn: 8 } };
    await parent.update({ conversationState: latestText }); resumeText();
    const completed = await voiceOutcome; assert(!completed.error, 'VOICE_CAN_COMPLETE_WITH_CONCURRENT_TEXT');
    assert.deepEqual((await parent.get()).get('conversationState'), latestText, 'VOICE_CANNOT_RESTORE_STALE_TEXT'); checks++;
  } finally { resumeText(); proto.get = originalGet; }
  const rejected = await invoke('Consulta el reporte de utilidades por cliente.', 'rtc-race', uid, queryFor('Unknown Demo'));
  assert.match(rejected.text, /No encontr/); assert.equal((await contextRef('rtc-race').get()).get('report'), undefined);
  assert.match((await invoke('Comparalo con 2026-08-01 al 2026-08-31','rtc-race')).text, /ambos periodos/); checks++;
  await assert.rejects(invoke('Consulta el reporte.', 'rtc-main', null, query), error => error.code === 'unauthenticated'); checks++;
  for (const name of ['pagos','solicitudes','paymentApplications']) assert.equal((await db.collection(name).limit(1).get()).size, 0);
  assert.equal(providers, 0); await verify();
  const proof = { status: 'PASS', checks, archiveSha256: manifest.archiveSha256, scope: 'EXACT_PUBLIC_VOICE_RUN_REAL_FIRESTORE_SYNTHETIC_AUTH', providerCalls: providers,
    financialMutations: 0, runtimeArchivePrePost: true, testSha256: sha(fs.readFileSync(__filename)) };
  fs.writeFileSync(path.join(directory,'emulator-proof.json'),JSON.stringify(proof,null,2)); console.log(JSON.stringify(proof));
}
run().then(async () => { await db.terminate(); await Promise.all(admin.apps.map(app => app.delete())); process.exit(0); }, error => { console.error(error.code || error.message); process.exit(1); });
