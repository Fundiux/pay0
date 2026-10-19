const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { createRequire } = require('node:module');
const JSZip = require('../../functions/node_modules/jszip');
const root = path.resolve(__dirname, '../..');
const directory = path.resolve(root, process.env.PAY0_R14_ARTIFACT_DIR || '');
assert.ok(directory.startsWith(path.join(root, '.firebase/modular-release') + path.sep), 'PRIVATE_ARTIFACT_REQUIRED');
assert.match(process.env.PAY0_R14_ARCHIVE_SHA || '', /^[a-f0-9]{64}$/);
assert.match(process.env.GCLOUD_PROJECT || '', /^demo-pay0-e1-/);
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/);
const runtime = path.join(directory, 'runtime');
const archiveName = process.env.PAY0_R14_ARCHIVE_FILE || 'chat-r14.zip';
assert.equal(path.basename(archiveName), archiveName, 'ARCHIVE_BASENAME_REQUIRED');
const bytes = fs.readFileSync(path.join(directory, archiveName));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(bytes), process.env.PAY0_R14_ARCHIVE_SHA, 'ARCHIVE_CHANGED');
(async () => {
  const zip = await JSZip.loadAsync(bytes);
  async function verifyBytes() {
    for (const entry of Object.values(zip.files)) if (!entry.dir)
      assert.deepEqual(fs.readFileSync(path.join(runtime, entry.name)), await entry.async('nodebuffer'), `RUNTIME_CHANGED:${entry.name}`);
  }
  await verifyBytes();
  const load = createRequire(path.join(runtime, 'package.json'));
  const admin = load('firebase-admin');
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
  const db = admin.firestore();
  const { sendAgent007Message, listAgent007Messages } = load('./lib/modules/agent007/callables');
  let providerCalls = 0;
  global.fetch = async () => { providerCalls++; throw Error('EXTERNAL_PROVIDER_FORBIDDEN'); };
  const rootId = 'r14-synthetic-root', uid = 'r14-synthetic-user', auth = { uid, token: {} };
  const send = text => sendAgent007Message.run({ auth, data: { text, scope: 'GLOBAL' } });
  try {
    await db.doc(`users/${uid}`).set({ rootId, role: 'superadmin', active: true });
    for (const [id, owner, amount, date] of [
      ['allowed', rootId, 12.34, '2026-09-10'], ['foreign', 'foreign-root', 9000, '2026-09-10'],
      ['outside-period', rootId, 7000, '2026-08-10'],
    ]) await db.doc(`earningsDistributions/r14-${id}`).set({ rootId: owner, clienteId: 'pc-directo', clienteNombre: 'PC Directo', totalEarningsAmount: amount, createdAt: admin.firestore.Timestamp.fromDate(new Date(`${date}T12:00:00Z`)) });
    const conversation = db.doc(`agent007Conversations/${rootId}_${uid}_global`);
    const first = await send('Dame un reporte de utilidades de pc directo del mes de septiembre');
    assert.match(first.message.text, /año/);
    assert.equal(first.message.reportExport, undefined);
    let pending = (await conversation.get()).get('conversationState.pendingEarningsReport');
    assert.equal(pending.clientQuery, 'pc directo'); assert.equal(pending.periodMonth, 9);
    const format = await send('en pdf');
    assert.match(format.message.text, /PDF/); assert.match(format.message.text, /año/);
    assert.doesNotMatch(format.message.text, /no puedo|no tengo capacidad|generad[oa]|archivo listo/i);
    assert.equal(format.message.reportExport, undefined); assert.equal(providerCalls, 0);
    pending = (await conversation.get()).get('conversationState.pendingEarningsReport');
    assert.equal(pending.periodMonth, 9); assert.equal(pending.clientQuery, 'pc directo'); assert.equal(pending.format, 'PDF');
    const report = await send('2026');
    const payload = report.message.reportExport;
    assert.equal(payload.format, 'PDF'); assert.equal(payload.dateFrom, '2026-09-01'); assert.equal(payload.dateTo, '2026-09-30');
    assert.equal(payload.rows.length, 1); assert.equal(payload.rows[0].clienteId, 'pc-directo'); assert.equal(payload.rows[0].totalEarningsAmount, 12.34);
    assert.deepEqual((await db.doc(`agent007Messages/${report.message.id}`).get()).get('reportExport'), payload);
    const listed = await listAgent007Messages.run({ auth, data: { scope: 'GLOBAL' } });
    assert.deepEqual(listed.messages.find(row => row.id === report.message.id).reportExport, payload);
    const excel = await send('en excel');
    assert.equal(excel.message.reportExport.format, 'XLSX'); assert.equal(excel.message.reportExport.dateFrom, payload.dateFrom);
    assert.equal(excel.message.reportExport.rows[0].totalEarningsAmount, 12.34);
    for (const greeting of ['hola', 'hola María']) {
      const answer = await send(greeting); assert.match(answer.message.text, /^Hola\./); assert.equal(answer.message.reportExport, undefined);
      assert.equal((await conversation.get()).get('conversationState.pendingEarningsReport'), undefined);
    }
    const staleFormat = await send('en pdf'); assert.equal(staleFormat.message.reportExport, undefined);
    assert.equal(providerCalls, 0);
    await db.doc(`users/${uid}`).update({ active: false });
    await assert.rejects(send('en excel'), error => error.code === 'permission-denied');
    await verifyBytes();
    const proof = { status: 'PASS', archiveSha256: sha(bytes), testSha256: sha(fs.readFileSync(__filename)), realCallable: true, persistence: 'FIRESTORE_EMULATOR', syntheticDataOnly: true, providerCalls, scopeAndPeriodPreserved: true, formatPersisted: true, greetingReset: true, revocationEnforced: true };
    fs.writeFileSync(path.join(directory, 'natural-dialogue-proof.json'), JSON.stringify(proof, null, 2));
    console.log(JSON.stringify(proof));
  } finally { await db.terminate(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
