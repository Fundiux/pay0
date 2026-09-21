// Production read and one-time kickoff. Never calls IQ from this workstation.
const path = require('node:path');
const args = process.argv.slice(2), launch = args.includes('--launch'), inspect = args.includes('--inspect');
const cliPath = args[args.indexOf('--cli-lib') + 1];
if ((!launch && !inspect) || !cliPath || process.env.FIRESTORE_EMULATOR_HOST) throw Error('Use --launch or --inspect with the installed Firebase CLI lib');
process.env.DEBUG = '';
const cliAuth = require(path.join(cliPath, 'auth.js')), scopes = require(path.join(cliPath, 'scopes.js'));
const account = cliAuth.getProjectDefaultAccount(process.cwd());
if (!account?.tokens?.refresh_token) throw Error('Existing Firebase CLI authorization required');
const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'pay-0-system' }); const db = admin.firestore();
const { IQ_REP_CANARY_ID } = require('../functions/lib/modules/paymentApplications/complementCanary.js');
const { assessLocalIqRecovery } = require('../functions/lib/modules/paymentApplications/complementRecoveryPlan.js');
const { inventoryPage } = require('../functions/lib/modules/paymentApplications/complementInventory.js');
async function run() {
  const { OAuth2Client, GoogleAuth } = require('../functions/node_modules/google-auth-library');
  const token = await cliAuth.getAccessToken(account.tokens.refresh_token, [scopes.CLOUD_PLATFORM, scopes.FIREBASE_PLATFORM]);
  const authClient = new OAuth2Client(); authClient.setCredentials({ access_token: token.access_token, expiry_date: token.expires_at || Date.now() + 50 * 60000 });
  db.settings({ auth: new GoogleAuth({ authClient, projectId: 'pay-0-system' }) });
  const roots = await db.collection('controlCenterSnapshots').limit(2).get();
  if (roots.size !== 1 || roots.docs[0].data().rootId !== roots.docs[0].id) throw Error('Operational root ambiguous');
  const rootId = roots.docs[0].id;
  const metrics = { scanned: 0, detected: 0, processed: 0, pending: 0, errors: 0, excluded: 0 };
  let cursor = '', complete = false;
  while (!complete) {
    const page = await inventoryPage(rootId, cursor, 25);
    for (const key of Object.keys(metrics)) metrics[key] += page.counts[key];
    complete = page.complete; cursor = page.cursor || '';
  }
  const ref = db.doc(`hugoComplementCanaries/${IQ_REP_CANARY_ID}`);
  if (inspect) {
    const snap = await ref.get(), row = snap.data();
    console.log(JSON.stringify({ mode: 'INSPECT', metrics, canary: row ? { status: row.status, stage: row.stage, applicationFolio: row.applicationFolio,
      applicationId: row.applicationId, error: row.error || null, steps: row.steps || [] } : null, externalActions: 0 }));
    return;
  }
  if ((await ref.get()).exists) throw Error('Canary already launched; no replay');
  const candidates = await db.collection('pagoAplicaciones').where('rootId', '==', rootId).get();
  const ready = [];
  for (const doc of candidates.docs) {
    const folio = doc.data().folio;
    if (!['AP1C4U1E6', 'AP2C4U1E6', 'AP3C4U1E6', 'AP4C4U1E6'].includes(folio)) continue;
    const result = await assessLocalIqRecovery(rootId, doc.id);
    if (result.state === 'READY_FOR_IQ_LOOKUP') ready.push({ id: doc.id, folio });
  }
  ready.sort((a, b) => a.folio.localeCompare(b.folio, 'en'));
  if (ready.length !== 4 || ready[0].folio !== 'AP1C4U1E6' || metrics.detected !== 5 || metrics.processed !== 0)
    throw Error('Local cohort or baseline changed; canary stopped before IQ');
  await ref.create({ rootId, applicationFolio: ready[0].folio, applicationId: ready[0].id,
    capability: 'LOOKUP', status: 'QUEUED', stage: 'QUEUED', cohortSize: 1, selection: 'Four equivalent local evidence sets; first folio in stable order',
    baselineMetrics: metrics, createdAt: admin.firestore.FieldValue.serverTimestamp(), steps: [] });
  console.log(JSON.stringify({ mode: 'LAUNCHED', applicationFolio: ready[0].folio, baselineMetrics: metrics, cohortSize: 1 }));
}
run().then(() => process.exit(0)).catch(error => { console.error(String(error.code || error.message || 'Canary failed')); process.exit(1); });
