// Bounded maintenance of already imported fiscal evidence. Dry-run by default.
// Requires official gcloud authentication; never reads cached CLI credentials.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const { promisify } = require('node:util');
const admin = require('../functions/node_modules/firebase-admin');
const { OAuth2Client } = require('../functions/node_modules/google-auth-library');
const { Storage } = require('../functions/node_modules/@google-cloud/storage');
const run = promisify(cp.execFile);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const { executeReviewedPlan, planDigest, validateEnvelope } = require('./rep-migration-plan.cjs');
const archive = path.resolve(__dirname, '../__untracked_archive/rep-historical-migration-20260928');
const projectId = 'pay-0-system';
const subscription = `projects/${projectId}/subscriptions/eventarc-nam5-enqueueautomaticpaymentcomplement-153886-sub-763`;
const sdk = path.join(process.env.LOCALAPPDATA || '', 'Google', 'Cloud SDK', 'google-cloud-sdk');
let accessToken, expiresAt = 0, stage = "INITIALIZE";
async function getAccessToken() {
  if (Date.now() >= expiresAt) {
    const result = await run(path.join(sdk, 'platform', 'bundledpython', 'python.exe'),
      [path.join(sdk, 'lib', 'gcloud.py'), 'auth', 'print-access-token', '--quiet'],
      { windowsHide: true, timeout: 60000 });
    accessToken = result.stdout.trim(); expiresAt = Date.now() + 45 * 60000;
  }
  return { access_token: accessToken, expires_in: Math.floor((expiresAt-Date.now())/1000) };
}
async function assertPaused() {
  const token = await getAccessToken();
  const response = await fetch('https://pubsub.googleapis.com/v1/' + subscription, {
    headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error('PAUSE_READ_FAILED');
  const config = await response.json();
  if (Object.keys(config.pushConfig || {}).length) throw Error('REP_DELIVERY_NOT_PAUSED');
}
async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const digest = args.find(arg => arg.startsWith('--plan-sha256='))?.split('=')[1];
  const bucket = args.find(arg => arg.startsWith('--bucket='))?.slice(9);
  const resumePath = args.find(arg => arg.startsWith('--resume-plan='))?.slice(14);
  if (!bucket || !/^pay-0-system\.(appspot\.com|firebasestorage\.app)$/.test(bucket) ||
      args.some(arg=>arg!=='--apply' && !arg.startsWith('--plan-sha256=') && !arg.startsWith('--bucket=') && !arg.startsWith('--resume-plan=')) ||
      (resumePath && !apply) ||
      (apply && !/^[a-f0-9]{64}$/.test(digest || ''))) throw Error('USAGE_BUCKET_AND_REVIEWED_DIGEST_REQUIRED');
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw Error('EMULATOR_ENVIRONMENT_NOT_ALLOWED');
  stage = "PAUSE_CHECK";
  await assertPaused();
  stage = "FIRESTORE_CLIENT";
  // Supply the official CLI token in memory through the Google clients' public
  // authClient option. Firebase Admin's Firestore/Storage bridges do not accept
  // a generic Credential implementation; no private credential file is read.
  const token = await getAccessToken();
  const authClient = new OAuth2Client();
  authClient.setCredentials({ access_token: token.access_token, expiry_date: expiresAt });
  admin.initializeApp({ projectId, storageBucket: bucket });
  const db = admin.firestore();
  db.settings({ authClient });
  const storage = new Storage({ projectId, authClient });
  admin.storage().bucket = name => storage.bucket(name || bucket);
  if (apply) {
    stage = 'VALIDATE_REVIEWED_PLAN';
    const planPath = path.resolve(resumePath || path.join(archive, `plan-${digest}.json`));
    if (!planPath.startsWith(archive + path.sep)) throw Error('IGNORED_PLAN_PATH_REQUIRED');
    const bytes = fs.readFileSync(planPath);
    if (sha(bytes) !== digest) throw Error('REVIEWED_PLAN_DIGEST_MISMATCH');
    const envelope = JSON.parse(bytes);
    validateEnvelope(envelope, digest, bucket);
    const beforePath = path.join(archive, `before-${digest}.json`);
    if (!fs.existsSync(beforePath)) fs.writeFileSync(beforePath, bytes, { flag: 'wx' });
    else if (sha(fs.readFileSync(beforePath)) !== digest) throw Error('ORIGINAL_BACKUP_CHANGED');
    const { adoptImportedIqComplementById } = require('../functions/lib/modules/paymentApplications/complementAutomation');
    stage = resumePath ? 'RESUME_REVIEWED_COHORT' : 'APPLY_REVIEWED_COHORT';
    const persist = (name, report) => {
      const file = path.join(archive, `${name}-${digest}.json`), temp = file + '.tmp';
      fs.writeFileSync(temp, JSON.stringify(report, null, 2));
      fs.renameSync(temp, file);
    };
    const report = await executeReviewedPlan({ envelope, digest, bucket, resume: !!resumePath, adapter: {
      assertPaused,
      read: async documentPath => {
        const snap = await db.doc(documentPath).get();
        return { data: snap.data() || null, revision: snap.exists ? { seconds: snap.updateTime.seconds, nanoseconds: snap.updateTime.nanoseconds } : null };
      },
      bytes: async row => (await storage.bucket(bucket).file(row.storagePath).download())[0],
      adopt: adoptImportedIqComplementById,
      checkpoint: report => persist('checkpoint', report),
    } });
    persist('after', report);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  stage = 'COHORT_READ';
  const imported = await db.collection('pagoAplicaciones').where('iqComplementStatus', '==', 'IMPORTED').limit(51).get();
  if (imported.size > 50) throw Error('COHORT_TOO_LARGE');
  const candidates = imported.docs.filter(doc => doc.data().iqComplementDocumentOwner !== 'PAGO_APPLICATION').sort((a,b)=>a.id.localeCompare(b.id));
  if (candidates.length !== 4) throw Error('EXPECTED_FOUR_HISTORICAL_APPLICATIONS');
  const roots = new Set(candidates.map(doc=>doc.data().rootId));
  if (roots.size !== 1 || ![...roots][0]) throw Error('COHORT_ROOT_MISMATCH');
  stage = 'LOAD_DOMAIN';
  const { complementRequestId } = require('../functions/lib/modules/paymentApplications/complementFollowup');
  const { assertSource } = require('../functions/lib/modules/paymentApplications/complementPolicy');
  const plan = [], backup = [];
  stage = 'VALIDATE_COHORT';
  for (const appSnap of candidates) {
    const app = appSnap.data();
    const refs = [db.doc(`solicitudes/${app.solicitudId}`), db.doc(`pagos/${app.pagoId}`),
      db.doc(`paymentComplementRequests/${complementRequestId(app.rootId, appSnap.id)}`),
      db.doc(`uploads/${app.iqComplementXmlUploadId}`), db.doc(`uploads/${app.iqComplementPdfUploadId}`)];
    const [solicitud, pago, request, xml, pdf] = await db.getAll(...refs);
    assertSource(app.rootId, app, solicitud.data(), pago.data());
    const r = request.data();
    if (!r || r.rootId !== app.rootId || r.applicationId !== appSnap.id || r.status !== 'RECEIVED' ||
        r.repAttachmentStatus !== 'REP_VALIDATED' || r.automationStatus === 'REVIEW_REQUIRED') throw Error('HISTORICAL_REQUEST_NOT_VALIDATED');
    const job = r.automationJobId ? await db.doc(`paymentComplementJobs/${r.automationJobId}`).get() : null;
    if (job && (!job.exists || job.data().rootId !== app.rootId || job.data().status === 'REVIEW_REQUIRED' || job.data().error === 'REP_SOURCE_REVERSED')) throw Error('HISTORICAL_JOB_REQUIRES_REVIEW');
    for (const [doc,type] of [[xml,'COMPLEMENTO_PAGO_XML'],[pdf,'COMPLEMENTO_PAGO_PDF']]) {
      const row = doc.data();
      if (!row || row.rootId !== app.rootId || row.pagoId !== app.pagoId ||
          (row.pagoAplicacionId || row.applicationId) !== appSnap.id || row.documentType !== type ||
          row.status !== 'READY' || row.active !== true || !row.storagePath || !row.sha256) throw Error('LEGACY_DOCUMENT_SCOPE_INVALID');
    }
    const snapshots = [appSnap, solicitud, pago, request, xml, pdf, ...(job ? [job] : [])];
    plan.push({ applicationId: appSnap.id, legacyUploadIds: [xml.id, pdf.id],
      revisions: snapshots.map(doc=>({path:doc.ref.path,updateTime:{seconds:doc.updateTime.seconds,nanoseconds:doc.updateTime.nanoseconds}})) });
    backup.push(...snapshots.map(doc=>({path:doc.ref.path,data:doc.data()})));
  }
  const envelope = { revision: 'ASTRA_REP_MIGRATION_PLAN_V2', projectId, bucket, rootId: [...roots][0], plan, backup };
  const planSha256 = planDigest(envelope);
  validateEnvelope(envelope, planSha256, bucket);
  fs.mkdirSync(archive, { recursive: true });
  const planPath = path.join(archive, `plan-${planSha256}.json`), bytes = JSON.stringify(envelope);
  if (!fs.existsSync(planPath)) fs.writeFileSync(planPath, bytes, { flag: 'wx' });
  else if (sha(fs.readFileSync(planPath)) !== planSha256) throw Error('EXISTING_PLAN_CHANGED');
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), projectId, apply: false, candidates: 4, roots: 1, planSha256,
    deliveryPaused: true, providerActions: 0, planFile: path.relative(archive, planPath), savedOriginalSnapshots: backup.length }, null, 2));
}
main().then(()=>process.exit(0)).catch(error=>{
  console.error(JSON.stringify({ok:false,stage,errorType:error.name,errorCode:String(error.code || '').replace(/[^A-Za-z0-9_/-]/g, '').slice(0,80),code:/^[A-Z0-9_]+$/.test(error.message)?error.message:'MIGRATION_FAILED_OUTPUT_WITHHELD'}));
  process.exitCode=1;
});
