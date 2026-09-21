// One-case B experiment. This workstation writes only the one-time command; IQ
// contact happens inside the gated Function. --inspect is read-only.
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
const { assessLocalIqRecovery } = require('../functions/lib/modules/paymentApplications/complementRecoveryPlan.js');
async function run() {
  const { OAuth2Client, GoogleAuth } = require('../functions/node_modules/google-auth-library');
  const token = await cliAuth.getAccessToken(account.tokens.refresh_token, [scopes.CLOUD_PLATFORM, scopes.FIREBASE_PLATFORM]);
  const authClient = new OAuth2Client(); authClient.setCredentials({ access_token: token.access_token, expiry_date: token.expires_at || Date.now() + 50 * 60000 });
  db.settings({ auth: new GoogleAuth({ authClient, projectId: 'pay-0-system' }) });
  const prior = (await db.doc(`hugoComplementCanaries/${IQ_REP_CANARY_ID}`).get()).data();
  const ref = db.doc(`hugoRepAttachmentExperiments/${IQ_REP_ATTACHMENT_EXPERIMENT_ID}`), snap = await ref.get();
  if (inspect) {
    const row = snap.data();
    console.log(JSON.stringify({ mode: 'INSPECT', previousCanary: prior ? { status: prior.status, error: prior.error } : null,
      experiment: row ? { status: row.status, stage: row.stage, applicationFolio: row.applicationFolio, applicationId: row.applicationId,
        httpStatus: row.httpStatus, responseShape: row.responseShape, repGenerationStatus: row.repGenerationStatus,
        repAttachmentStatus: row.repAttachmentStatus, validation: row.validation, nextCheckAt: row.nextCheckAt,
        error: row.error, steps: row.steps } : null, externalCallsFromScript: 0 }));
    return;
  }
  if (snap.exists) throw Error('Experiment already launched; no replay');
  if (!prior || prior.status !== 'STOPPED' || prior.error !== 'IQ_REP_REQUEST_STATE_REQUIRES_REVIEW' ||
      prior.applicationFolio !== 'AP1C4U1E6' || !prior.applicationId || !prior.rootId) throw Error('Previous canary does not match');
  const preview = await assessLocalIqRecovery(prior.rootId, prior.applicationId);
  if (preview.state !== 'READY_FOR_IQ_LOOKUP' ||
      preview.planFingerprint !== prior.steps?.find(step => step.stage === 'LOCAL_EVIDENCE_VERIFIED')?.fingerprint)
    throw Error('Local evidence changed; experiment not launched');
  await ref.create({ rootId: prior.rootId, applicationId: prior.applicationId, applicationFolio: 'AP1C4U1E6', capability: 'LOOKUP',
    status: 'QUEUED', stage: 'QUEUED', cohortSize: 1, priorCanary: IQ_REP_CANARY_ID, expectedFingerprint: preview.planFingerprint,
    createdAt: admin.firestore.FieldValue.serverTimestamp(), steps: [] });
  console.log(JSON.stringify({ mode: 'LAUNCHED', applicationFolio: 'AP1C4U1E6', cohortSize: 1, externalCallsFromScript: 0 }));
}
run().then(() => process.exit(0)).catch(error => { console.error(String(error.code || error.message || 'Experiment failed')); process.exit(1); });
