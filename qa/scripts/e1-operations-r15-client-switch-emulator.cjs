const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { createRequire } = require('node:module');
const JSZip = require('../../functions/node_modules/jszip');
const root = path.resolve(__dirname, '../..');
const directory = path.resolve(root, process.env.PAY0_R15_ARTIFACT_DIR || '');
assert.ok(directory.startsWith(path.join(root, '.firebase/modular-release') + path.sep), 'PRIVATE_ARTIFACT_REQUIRED');
assert.match(process.env.PAY0_R15_ARCHIVE_SHA || '', /^[a-f0-9]{64}$/);
assert.match(process.env.GCLOUD_PROJECT || '', /^demo-pay0-e1-/);
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/);
const runtime = path.join(directory, 'runtime');
const archiveName = process.env.PAY0_R15_ARCHIVE_FILE || 'chat-r15.zip';
assert.equal(path.basename(archiveName), archiveName, 'ARCHIVE_BASENAME_REQUIRED');
const bytes = fs.readFileSync(path.join(directory, archiveName));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(bytes), process.env.PAY0_R15_ARCHIVE_SHA, 'ARCHIVE_CHANGED');
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
  const rootId = 'r15-synthetic-root', uid = 'r15-synthetic-user', auth = { uid, token: {} };
  const send = text => sendAgent007Message.run({ auth, data: { text, scope: 'GLOBAL' } });
  const conversation = db.doc(`agent007Conversations/${rootId}_${uid}_global`);
  async function expectReport(answer, clientId, total, month = '09') {
    const payload = answer.message.reportExport;
    assert.ok(payload, 'REPORT_EXPORT_REQUIRED');
    assert.equal(payload.format, 'PDF');
    assert.equal(payload.dateFrom, `2026-${month}-01`);
    assert.equal(payload.dateTo, `2026-${month}-${month === '09' ? '30' : '31'}`);
    assert.equal(payload.rows.length, 1);
    assert.equal(payload.rows[0].clienteId, clientId);
    assert.equal(payload.rows[0].totalEarningsAmount, total);
    assert.doesNotMatch(answer.message.text, /folio|no tengo la capacidad|ya te di/i);
    assert.deepEqual((await db.doc(`agent007Messages/${answer.message.id}`).get()).get('reportExport'), payload);
    return payload;
  }
  try {
    await db.doc(`users/${uid}`).set({ rootId, role: 'superadmin', active: true });
    for (const [id, owner, clientId, name, amount, date] of [
      ['alfa', rootId, 'alfa-directo', 'Alfa Directo', 12.34, '2026-09-10'],
      ['servicio', rootId, 'inservice-demo', 'Inservice Demo', 56.78, '2026-09-12'],
      ['foreign', 'foreign-root', 'inservice-demo', 'Inservice Demo', 9000, '2026-09-10'],
      ['outside', rootId, 'inservice-demo', 'Inservice Demo', 7000, '2026-08-10'],
      ['october', rootId, 'inservice-demo', 'Inservice Demo', 23.45, '2026-10-10'],
    ]) await db.doc(`earningsDistributions/r15-${id}`).set({ rootId: owner, clienteId: clientId, clienteNombre: name, totalEarningsAmount: amount,
      createdAt: admin.firestore.Timestamp.fromDate(new Date(`${date}T12:00:00Z`)) });
    const first = await send('Dame un reporte de utilidades de alfa directo del mes de septiembre');
    assert.match(first.message.text, /año/); assert.equal(first.message.reportExport, undefined);
    const year = await send('2026');
    assert.match(year.message.text, /PDF.*Excel/); assert.equal(year.message.reportExport, undefined);
    await expectReport(await send('pdf'), 'alfa-directo', 12.34);
    const ambiguous = await send('ahora dame uno de inservice de septiembre');
    assert.equal(ambiguous.message.reportExport, undefined, 'AMBIGUOUS_NAME_REQUIRES_CLARIFICATION');
    assert.match(ambiguous.message.text, /cliente|nombre/i); assert.doesNotMatch(ambiguous.message.text, /folio/i);
    assert.equal((await conversation.get()).get('conversationState.pendingEarningsReport.clientQuery'), undefined);
    await expectReport(await send('Inservice Demo'), 'inservice-demo', 56.78);
    await expectReport(await send('ahora dame uno de inservice del mes de septiembre'), 'inservice-demo', 56.78);
    const change = await send('ahora ocupo de otro cliente');
    assert.equal(change.message.reportExport, undefined);
    assert.match(change.message.text, /cliente|nombre/i); assert.doesNotMatch(change.message.text, /folio/i);
    const pending = (await conversation.get()).get('conversationState.pendingEarningsReport');
    assert.equal(pending.stage, 'CLIENT'); assert.equal(pending.clientQuery, undefined);
    assert.equal(pending.dateFrom, '2026-09-01'); assert.equal(pending.dateTo, '2026-09-30'); assert.equal(pending.format, 'PDF');
    await expectReport(await send('Inservice Demo'), 'inservice-demo', 56.78);
    await expectReport(await send('quiero el reporte de septiembre'), 'inservice-demo', 56.78);
    await expectReport(await send('INSERVICE DEMO es el nombre del cliente quiero el reporte de todo el mes de septiembre'), 'inservice-demo', 56.78);
    await expectReport(await send('ahora dame uno de inservice del mes de octubre'), 'inservice-demo', 23.45, '10');
    const listed = await listAgent007Messages.run({ auth, data: { scope: 'GLOBAL' } });
    const reports = listed.messages.filter(row => row.reportExport);
    assert.ok(reports.length >= 7, 'PERSISTED_REPORTS_REQUIRED');
    assert.equal(reports.filter(row => row.reportExport.rows[0]?.clienteId === 'alfa-directo').length, 1);
    const hello = await send('hola');
    assert.match(hello.message.text, /^Hola\./); assert.equal(hello.message.reportExport, undefined);
    assert.equal((await conversation.get()).get('conversationState.pendingEarningsReport'), undefined);
    assert.equal(providerCalls, 0);
    await db.doc(`users/${uid}`).update({ active: false });
    await assert.rejects(send('en excel'), error => error.code === 'permission-denied');
    await verifyBytes();
    const proof = { status: 'PASS', archiveSha256: sha(bytes), testSha256: sha(fs.readFileSync(__filename)), realCallable: true,
      persistence: 'FIRESTORE_EMULATOR', syntheticDataOnly: true, providerCalls, clientSwitch: true, unnamedClientClarification: true,
      declarationRecovery: true, ambiguousNameClarification: true, explicitContextYearReused: true, monthChanged: true, scopeAndPeriodPreserved: true,
      formatPersisted: true, greetingReset: true, revocationEnforced: true };
    fs.writeFileSync(path.join(directory, 'client-switch-dialogue-proof.json'), JSON.stringify(proof, null, 2));
    console.log(JSON.stringify(proof));
  } finally { await db.terminate(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
