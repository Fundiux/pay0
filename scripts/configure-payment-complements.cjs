// Explicit prospective activation only. Does not enqueue historical payments.
const path=require('node:path');
const args=process.argv.slice(2),cliPath=args[args.indexOf('--cli-lib')+1];
if(!args.includes('--cli-lib')||!cliPath||process.env.FIRESTORE_EMULATOR_HOST)throw Error('Production CLI context required');
process.env.DEBUG='';
const cliAuth=require(path.join(cliPath,'auth.js')),scopes=require(path.join(cliPath,'scopes.js'));
const admin=require('../functions/node_modules/firebase-admin');admin.initializeApp({projectId:'pay-0-system'});
async function run(){
 const account=cliAuth.getProjectDefaultAccount(process.cwd());if(!account?.tokens?.refresh_token)throw Error('Existing CLI authentication required');
 const token=await cliAuth.getAccessToken(account.tokens.refresh_token,[scopes.CLOUD_PLATFORM,scopes.FIREBASE_PLATFORM]);
 const {OAuth2Client,GoogleAuth}=require('../functions/node_modules/google-auth-library'),client=new OAuth2Client();
 client.setCredentials({access_token:token.access_token,expiry_date:token.expires_at||Date.now()+3000000});
 const db=admin.firestore();db.settings({auth:new GoogleAuth({authClient:client,projectId:'pay-0-system'})});
 const roots=await db.collection('controlCenterSnapshots').limit(2).get();if(roots.size!==1)throw Error('Ambiguous root');
 const root=roots.docs[0];if(root.data().rootId!==root.id)throw Error('Root mismatch');
 const owner=(await db.doc(`users/${root.id}`).get()).data();if(owner?.role!=='superadmin')throw Error('Superadmin owner required');
 const schedulerResponse=await fetch('https://cloudscheduler.googleapis.com/v1/projects/pay-0-system/locations/us-central1/jobs',{headers:{Authorization:`Bearer ${token.access_token}`}});
 if(!schedulerResponse.ok)throw Error('Scheduler verification failed');
 const scheduler=(await schedulerResponse.json()).jobs?.find(job=>job.name.endsWith('/firebase-schedule-checkPaymentComplementsDaily-us-central1'));
 if(!scheduler||scheduler.schedule!=='0 19 * * *'||scheduler.timeZone!=='America/Mexico_City'||scheduler.state!=='ENABLED')throw Error('Scheduler contract mismatch');
 const ref=db.doc(`paymentComplementConfigs/${root.id}`);
 if(args.includes('--activate-future'))await db.runTransaction(async tx=>{
   const old=await tx.get(ref);if(old.exists)throw Error('Configuration exists: use authorized UI to avoid changing activation scope');
   tx.create(ref,{rootId:root.id,iqEnabled:true,facturamaEnabled:true,activatedAt:admin.firestore.FieldValue.serverTimestamp(),updatedAt:admin.firestore.FieldValue.serverTimestamp(),updatedBy:root.id,authorizationSource:'USER_REQUEST_AUTOMATIC_COMPLEMENTS_2026_09_20'});
 });
 const config=(await ref.get()).data();
 const queued=await db.collection('paymentComplementJobs').where('rootId','==',root.id).get();
 console.log(JSON.stringify({iqEnabled:config?.iqEnabled===true,facturamaEnabled:config?.facturamaEnabled===true,activationRecorded:!!config?.activatedAt,jobs:queued.size,historicalEnqueue:false,schedule:scheduler.schedule,timeZone:scheduler.timeZone,schedulerState:scheduler.state}));
}
run().then(()=>process.exit(0)).catch(()=>{console.error('Configuration verification failed; no credentials printed.');process.exit(1)});
