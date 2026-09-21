// One authorized C command. IQ contact occurs only inside the gated Function.
const path = require('node:path');
const args = process.argv.slice(2), launch = args.includes('--launch'), inspect = args.includes('--inspect'), signal = args.includes('--signal');
const cliPath = args[args.indexOf('--cli-lib') + 1];
if ((!launch && !inspect && !signal) || !cliPath || process.env.FIRESTORE_EMULATOR_HOST) throw Error('Use --launch, --inspect or --signal with Firebase CLI lib');
process.env.DEBUG = '';
const cliAuth = require(path.join(cliPath, 'auth.js')), scopes = require(path.join(cliPath, 'scopes.js'));
const account = cliAuth.getProjectDefaultAccount(process.cwd());
if (!account?.tokens?.refresh_token) throw Error('Existing Firebase CLI authorization required');
const admin = require('../functions/node_modules/firebase-admin'); admin.initializeApp({ projectId: 'pay-0-system' });
const db = admin.firestore();
const { IQ_REP_DEPOSIT_FIELD_PROBE_ID } = require('../functions/lib/modules/paymentApplications/repDepositFieldProbe.js');
const { IQ_REP_REQUEST_CANARY_ID } = require('../functions/lib/modules/paymentApplications/repRequestCanary.js');
const { iqRepRequestId } = require('../functions/lib/modules/paymentApplications/complementRequestIdentity.js');
const { assessLocalIqRecovery } = require('../functions/lib/modules/paymentApplications/complementRecoveryPlan.js');
const { inventoryPage } = require('../functions/lib/modules/paymentApplications/complementInventory.js');
async function metrics(rootId) {
  const totals = { scanned:0, detected:0, processed:0, pending:0, errors:0, excluded:0 };
  let cursor = '', complete = false;
  while (!complete) {
    const page = await inventoryPage(rootId,cursor,25);
    for (const key of Object.keys(totals)) totals[key] += page.counts[key];
    cursor = page.cursor || ''; complete = page.complete;
  }
  return totals;
}
async function run() {
  const { OAuth2Client, GoogleAuth } = require('../functions/node_modules/google-auth-library');
  const token = await cliAuth.getAccessToken(account.tokens.refresh_token, [scopes.CLOUD_PLATFORM, scopes.FIREBASE_PLATFORM]);
  const authClient = new OAuth2Client(); authClient.setCredentials({ access_token: token.access_token, expiry_date: token.expires_at || Date.now() + 50 * 60000 });
  db.settings({ auth: new GoogleAuth({ authClient, projectId: 'pay-0-system' }) });
  const field = (await db.doc(`hugoRepDepositFieldProbes/${IQ_REP_DEPOSIT_FIELD_PROBE_ID}`).get()).data();
  if (!field || field.status !== 'OBSERVED' || field.applicationFolio !== 'AP1C4U1E6' || field.observation?.depositId !== '220483')
    throw Error('Previous field observation invalid');
  const ref = db.doc(`hugoRepRequestCanaries/${IQ_REP_REQUEST_CANARY_ID}`), snap = await ref.get();
  const currentMetrics = await metrics(field.rootId);
  if (inspect) {
    const row = snap.data(), jobId = iqRepRequestId(field.rootId,'220483');
    const job = (await db.doc(`paymentComplementJobs/${jobId}`).get()).data();
    const followupId = require('../functions/lib/modules/paymentApplications/complementFollowup.js').complementRequestId(field.rootId,field.applicationId);
    const followup = (await db.doc(`paymentComplementRequests/${followupId}`).get()).data();
    console.log(JSON.stringify({ mode:'INSPECT', metrics:currentMetrics,
      canary:row?{status:row.status,stage:row.stage,error:row.error||null,response:row.response||null,
        currentDeposit:row.currentDeposit||null,attachmentClassification:row.attachmentClassification||null,
        currentAttachment:row.currentAttachment||null,nextCheckAt:row.nextCheckAt||null,jobId:row.jobId||null}:null,
      job:job?{status:job.status,requestIdentity:job.requestIdentity,attemptedAt:job.attemptedAt||null,
        requestedAt:job.requestedAt||null,nextCheckAt:job.nextCheckAt||null,error:job.error||null,
        iqRequestResponse:job.iqRequestResponse||null}:null,
      followup:followup?{status:followup.status,automationStatus:followup.automationStatus,
        externalRequestSent:followup.externalRequestSent,requestedAt:followup.requestedAt||null,
        nextCheckAt:followup.nextCheckAt||null,repAttachmentStatus:followup.repAttachmentStatus||null}:null,
      externalCallsFromScript:0 })); return;
  }
  if (signal) {
    if (snap.data()?.status !== 'QUEUED') throw Error('C canary already claimed; no redispatch');
    const existingJob = await db.doc(`paymentComplementJobs/${iqRepRequestId(field.rootId,'220483')}`).get();
    if (existingJob.exists) throw Error('C job already exists; no redispatch');
    await ref.update({ dispatchSignalAt: admin.firestore.FieldValue.serverTimestamp() });
    console.log(JSON.stringify({ mode:'SIGNALLED_EXISTING_COMMAND',applicationFolio:'AP1C4U1E6',depositId:'220483',externalCallsFromScript:0 })); return;
  }
  if (snap.exists) throw Error('C canary already launched; no replay');
  const preview = await assessLocalIqRecovery(field.rootId,field.applicationId);
  if (preview.state !== 'READY_FOR_IQ_LOOKUP') throw Error(`Local evidence not ready: ${preview.reason}`);
  const existingJobs = await db.collection('paymentComplementJobs').where('depositId','==','220483').get();
  if (existingJobs.docs.some(doc=>doc.data().rootId===field.rootId && doc.data().provider==='IQ')) throw Error('Existing C job; no launch');
  await ref.create({ rootId:field.rootId,applicationId:field.applicationId,applicationFolio:'AP1C4U1E6',
    depositId:'220483',capability:'REQUEST',expectedFingerprint:preview.planFingerprint,
    status:'QUEUED',baselineMetrics:currentMetrics,createdAt:admin.firestore.FieldValue.serverTimestamp() });
  console.log(JSON.stringify({mode:'LAUNCHED',applicationFolio:'AP1C4U1E6',depositId:'220483',baselineMetrics:currentMetrics,
    externalCallsFromScript:0}));
}
run().then(()=>process.exit(0)).catch(error=>{console.error(String(error.code||error.message||'C canary failed'));process.exit(1)});
