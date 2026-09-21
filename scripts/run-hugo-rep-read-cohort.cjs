// Fixed three-case B cohort. This script never contacts IQ or requests REP.
const path = require('node:path');
const args = process.argv.slice(2), mode = args.find(arg => ['--launch','--inspect','--signal'].includes(arg));
const folio = args[args.indexOf('--folio') + 1], cliPath = args[args.indexOf('--cli-lib') + 1];
const ids = { AP2C4U1E6:'iq-rep-read-ap2c4u1e6-v1', AP3C4U1E6:'iq-rep-read-ap3c4u1e6-v1', AP4C4U1E6:'iq-rep-read-ap4c4u1e6-v1' };
if (!mode || !ids[folio] || !cliPath || process.env.FIRESTORE_EMULATOR_HOST) throw Error('Fixed B cohort, --folio, --mode and Firebase CLI lib required');
process.env.DEBUG = '';
const cliAuth = require(path.join(cliPath, 'auth.js')), scopes = require(path.join(cliPath, 'scopes.js'));
const account = cliAuth.getProjectDefaultAccount(process.cwd());
if (!account?.tokens?.refresh_token) throw Error('Existing Firebase CLI authorization required');
const admin = require('../functions/node_modules/firebase-admin'); admin.initializeApp({ projectId:'pay-0-system' });
const db = admin.firestore();
const {IQ_REP_DEPOSIT_FIELD_PROBE_ID}=require('../functions/lib/modules/paymentApplications/repDepositFieldProbe.js');
const {assessLocalIqRecovery}=require('../functions/lib/modules/paymentApplications/complementRecoveryPlan.js');
const {complementRequestId}=require('../functions/lib/modules/paymentApplications/complementFollowup.js');
const {inventoryPage}=require('../functions/lib/modules/paymentApplications/complementInventory.js');
async function metrics(rootId) {
  const totals={scanned:0,detected:0,processed:0,pending:0,errors:0,excluded:0,
    waitingB:0,requestedC:0,uncertainC:0,attachmentAvailable:0,exceptionBlocked:0,otherPending:0};let cursor='',complete=false;
  while(!complete){const page=await inventoryPage(rootId,cursor,25);for(const key of Object.keys(totals))totals[key]+=page.counts[key];cursor=page.cursor||'';complete=page.complete;}
  return totals;
}
async function run(){
  const {OAuth2Client,GoogleAuth}=require('../functions/node_modules/google-auth-library');
  const token=await cliAuth.getAccessToken(account.tokens.refresh_token,[scopes.CLOUD_PLATFORM,scopes.FIREBASE_PLATFORM]);
  const authClient=new OAuth2Client();authClient.setCredentials({access_token:token.access_token,expiry_date:token.expires_at||Date.now()+50*60000});
  db.settings({auth:new GoogleAuth({authClient,projectId:'pay-0-system'})});
  const prior=(await db.doc(`hugoRepDepositFieldProbes/${IQ_REP_DEPOSIT_FIELD_PROBE_ID}`).get()).data();
  if(!prior?.rootId||prior.status!=='OBSERVED')throw Error('AP1 root evidence unavailable');
  const apps=await db.collection('pagoAplicaciones').where('rootId','==',prior.rootId).where('folio','==',folio).limit(2).get();
  if(apps.size!==1)throw Error('Cohort application ambiguous');
  const app=apps.docs[0].data(),applicationId=apps.docs[0].id;
  const plan=(await db.doc(`pagoApplicationIqPlans/${app.iqPlanId}`).get()).data();
  const depositId=String(plan?.plan?.pagoIqFolio||plan?.pagoIqFolio||'').trim();
  const ref=db.doc(`hugoRepReadCohort/${ids[folio]}`),row=(await ref.get()).data();
  const request=(await db.doc(`paymentComplementRequests/${complementRequestId(prior.rootId,applicationId)}`).get()).data();
  if(mode==='--inspect'){
    const sameDepositJobs=await db.collection('paymentComplementJobs').where('depositId','==',depositId).get();
    const iqRequestJobs=sameDepositJobs.docs.filter(doc=>doc.data().rootId===prior.rootId&&doc.data().provider==='IQ');
    console.log(JSON.stringify({mode:'INSPECT',folio,applicationId,depositId,metrics:await metrics(prior.rootId),
      iqRequestJobCount:iqRequestJobs.length,
      read:row?{status:row.status,stage:row.stage,error:row.error||null,deposit:row.deposit||null,
        attachmentClassification:row.attachmentClassification||null,attachmentShape:row.attachmentShape||null,
        validation:row.validation||null,nextCheckAt:row.nextCheckAt||null}:null,
      followup:request?{status:request.status,automationStatus:request.automationStatus,externalRequestSent:request.externalRequestSent,
        repAttachmentStatus:request.repAttachmentStatus||null,nextCheckAt:request.nextCheckAt||null}:null,externalCallsFromScript:0}));return;
  }
  if(mode==='--signal'){
    if(row?.status!=='QUEUED')throw Error('B command already claimed; no redispatch');
    await ref.update({dispatchSignalAt:admin.firestore.FieldValue.serverTimestamp()});
    console.log(JSON.stringify({mode:'SIGNALLED_EXISTING_B_COMMAND',folio,externalCallsFromScript:0}));return;
  }
  if(row)throw Error('B command already launched');
  const preview=await assessLocalIqRecovery(prior.rootId,applicationId);
  if(preview.state!=='READY_FOR_IQ_LOOKUP'||!/^\d{3,20}$/.test(depositId)||!request||request.externalRequestSent!==false||request.requestedAt||request.automationJobId)
    throw Error(`B local evidence not ready: ${preview.reason||'REQUEST_HISTORY_CHANGED'}`);
  await ref.create({rootId:prior.rootId,applicationId,applicationFolio:folio,expectedDepositId:depositId,
    expectedFingerprint:preview.planFingerprint,capability:'LOOKUP',status:'QUEUED',stage:'QUEUED',createdAt:admin.firestore.FieldValue.serverTimestamp()});
  console.log(JSON.stringify({mode:'LAUNCHED_B',folio,depositId,baselineMetrics:await metrics(prior.rootId),externalCallsFromScript:0}));
}
run().then(()=>process.exit(0)).catch(error=>{console.error(String(error.code||error.message||'B cohort failed'));process.exit(1)});
