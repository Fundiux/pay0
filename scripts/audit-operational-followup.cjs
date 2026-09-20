// Read-only by default. --reconcile-complements updates only local follow-up.
// No invoice issuance, dispersion, IQ request or external message is invoked.
const path = require('node:path');
const args=process.argv.slice(2), cliPath=args[args.indexOf('--cli-lib')+1];
if(!args.includes('--cli-lib') || !cliPath || process.env.FIRESTORE_EMULATOR_HOST) throw Error('Installed CLI lib and production read context required');
process.env.DEBUG='';
const cliAuth=require(path.join(cliPath,'auth.js')), scopes=require(path.join(cliPath,'scopes.js'));
const account=cliAuth.getProjectDefaultAccount(process.cwd());
if(!account?.tokens?.refresh_token) throw Error('Existing Firebase CLI authorization required');
const admin=require('../functions/node_modules/firebase-admin');
admin.initializeApp({projectId:'pay-0-system'}); const db=admin.firestore();
async function run(){
  const {OAuth2Client,GoogleAuth}=require('../functions/node_modules/google-auth-library');
  const token=await cliAuth.getAccessToken(account.tokens.refresh_token,[scopes.CLOUD_PLATFORM,scopes.FIREBASE_PLATFORM]);
  const authClient=new OAuth2Client();authClient.setCredentials({access_token:token.access_token,expiry_date:token.expires_at||Date.now()+50*60000});
  db.settings({auth:new GoogleAuth({authClient,projectId:'pay-0-system'})});
  const roots=await db.collection('controlCenterSnapshots').limit(2).get();
  if(roots.size!==1||roots.docs[0].data().rootId!==roots.docs[0].id) throw Error('Cannot infer operational root');
  const rootId=roots.docs[0].id;
  if(args.includes('--check-indexes')) {
    for(const name of ['solicitudes','pagos','agent007Recommendations','agent007LearnedRules','paymentComplementRequests']) await db.collection(name).where('rootId','==',rootId).orderBy('createdAt','desc').limit(1).get();
    await db.collection('agent007Messages').where('rootId','==',rootId).where('conversationId','==',`${rootId}_${rootId}`).orderBy('createdAt','desc').limit(1).get();
    await db.collection('solicitudes').where('rootId','==',rootId).where('folio','==','__INDEX_CHECK__').limit(1).get();
    console.log(JSON.stringify({indexQueries:'PASS',checked:7}));
  }
  const read=async name=>(await db.collection(name).where('rootId','==',rootId).get()).docs.map(doc=>({id:doc.id,...doc.data()}));
  const [solicitudes,pagos,applications,invoices,files]=await Promise.all(['solicitudes','pagos','pagoAplicaciones','facturamaInvoices','materialityOperations'].map(read));
  const byId=rows=>new Map(rows.map(row=>[row.id,row]));const ss=byId(solicitudes),pp=byId(pagos),ff=byId(files);
  const anomalies={applicationMissingParent:0,issuedInvoiceMissingSolicitud:0,issuedUuidMismatch:0,issuedMaterialityMismatch:0,applicationSumMismatch:0};
  const applied=new Map();
  for(const row of applications){
    if(!ss.has(row.solicitudId)||!pp.has(row.pagoId)) anomalies.applicationMissingParent++;
    if(row.status==='APLICADA') applied.set(row.solicitudId,(applied.get(row.solicitudId)||0)+Math.round(Number(row.montoAplicado||0)*100));
  }
  for(const [id,sum] of applied){const row=ss.get(id);if(row&&Math.abs(Math.round(Number(row.totalAbonado||0)*100)-sum)>1) anomalies.applicationSumMismatch++;}
  const issued=invoices.filter(row=>row.environment==='PRODUCTION'&&row.status==='PRODUCTION_ISSUED');
  for(const row of issued){
    const solicitudId=row.sourceSolicitudId||row.solicitudId, solicitud=ss.get(solicitudId), file=ff.get(solicitudId);
    if(!solicitud){anomalies.issuedInvoiceMissingSolicitud++;continue;}
    if(!row.uuid||String(solicitud.facturaUuid||solicitud.uuidCfdi||'').toUpperCase()!==String(row.uuid).toUpperCase()) anomalies.issuedUuidMismatch++;
    if(!file||String(file.facturamaUuid||'').toUpperCase()!==String(row.uuid||'').toUpperCase()) anomalies.issuedMaterialityMismatch++;
  }
  console.log(JSON.stringify({mode:'READ_ONLY_AUDIT',counts:{solicitudes:solicitudes.length,pagos:pagos.length,applications:applications.length,issuedInvoices:issued.length,materiality:files.length},anomalies,externalActions:0}));
  if(args.includes('--reconcile-complements')){
    const {reconcilePaymentComplement}=require('../functions/lib/modules/paymentApplications/complementFollowup.js');
    for(const row of applications) await reconcilePaymentComplement(row.id);
    const followups=await read('paymentComplementRequests'); const statuses={};
    for(const row of followups) statuses[row.status]=(statuses[row.status]||0)+1;
    console.log(JSON.stringify({mode:'LOCAL_FOLLOWUP_RECONCILED',applicationsReviewed:applications.length,followups:followups.length,statuses,externalRequestsSent:0}));
  }
}
run().then(()=>process.exit(0)).catch(error=>{console.error(String(error.code||error.message||'Audit failed'));process.exit(1)});
