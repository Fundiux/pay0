// One-case B read. Creates one command; IQ contact occurs only in the gated Function.
const path = require('node:path');
const args = process.argv.slice(2), launch = args.includes('--launch'), inspect = args.includes('--inspect');
const cliPath = args[args.indexOf('--cli-lib') + 1];
if ((!launch && !inspect) || !cliPath || process.env.FIRESTORE_EMULATOR_HOST) throw Error('Use --launch or --inspect with Firebase CLI lib');
process.env.DEBUG = '';
const cliAuth = require(path.join(cliPath, 'auth.js')), scopes = require(path.join(cliPath, 'scopes.js'));
const account = cliAuth.getProjectDefaultAccount(process.cwd());
if (!account?.tokens?.refresh_token) throw Error('Existing Firebase CLI authorization required');
const admin = require('../functions/node_modules/firebase-admin'); admin.initializeApp({ projectId: 'pay-0-system' });
const db = admin.firestore();
const { IQ_REP_CANARY_ID } = require('../functions/lib/modules/paymentApplications/complementCanary.js');
const { IQ_REP_ATTACHMENT_EXPERIMENT_ID } = require('../functions/lib/modules/paymentApplications/repAttachmentExperiment.js');
const { IQ_REP_DEPOSIT_FIELD_PROBE_ID } = require('../functions/lib/modules/paymentApplications/repDepositFieldProbe.js');
const { assessLocalIqRecovery } = require('../functions/lib/modules/paymentApplications/complementRecoveryPlan.js');
async function run() {
  const { OAuth2Client, GoogleAuth } = require('../functions/node_modules/google-auth-library');
  const token = await cliAuth.getAccessToken(account.tokens.refresh_token, [scopes.CLOUD_PLATFORM, scopes.FIREBASE_PLATFORM]);
  const authClient = new OAuth2Client(); authClient.setCredentials({ access_token: token.access_token, expiry_date: token.expires_at || Date.now() + 50 * 60000 });
  db.settings({ auth: new GoogleAuth({ authClient, projectId: 'pay-0-system' }) });
  const prior = (await db.doc(`hugoComplementCanaries/${IQ_REP_CANARY_ID}`).get()).data();
  const attachment = (await db.doc(`hugoRepAttachmentExperiments/${IQ_REP_ATTACHMENT_EXPERIMENT_ID}`).get()).data();
  const ref = db.doc(`hugoRepDepositFieldProbes/${IQ_REP_DEPOSIT_FIELD_PROBE_ID}`), snap = await ref.get();
  if (inspect) {
    const row = snap.data();
    console.log(JSON.stringify({ mode: 'INSPECT', probe: row ? { status: row.status, error: row.error || null,
      applicationFolio: row.applicationFolio, httpStatus: row.httpStatus || null, observation: row.observation || null } : null,
      externalCallsFromScript: 0 }));
    return;
  }
  if (snap.exists) throw Error('Field probe already launched; no replay');
  if (!prior || prior.status !== 'STOPPED' || prior.applicationFolio !== 'AP1C4U1E6' || !prior.rootId || !prior.applicationId ||
      !attachment || attachment.rootId !== prior.rootId || attachment.applicationId !== prior.applicationId ||
      attachment.repAttachmentStatus !== 'REP_ATTACHMENT_NOT_AVAILABLE') throw Error('Previous B evidence does not match');
  const preview = await assessLocalIqRecovery(prior.rootId, prior.applicationId);
  if (preview.state !== 'READY_FOR_IQ_LOOKUP') throw Error(`Local evidence not ready: ${preview.reason}`);
  await ref.create({ rootId: prior.rootId, applicationId: prior.applicationId, applicationFolio: 'AP1C4U1E6',
    capability: 'LOOKUP', expectedFingerprint: preview.planFingerprint, status: 'QUEUED',
    createdAt: admin.firestore.FieldValue.serverTimestamp() });
  console.log(JSON.stringify({ mode: 'LAUNCHED', applicationFolio: 'AP1C4U1E6', capability: 'LOOKUP', externalCallsFromScript: 0 }));
}
run().then(() => process.exit(0)).catch(error => { console.error(String(error.code || error.message || 'Field probe failed')); process.exit(1); });
