// Local synthetic route QA only. Run prepare after the Functions build; then start and seed.
// No deployment, cloud credentials, real users or exported background triggers.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../..');
const base = path.join(root, 'output/receipt-ui-emulator'), source = path.join(base, 'functions');
const { spawnSync } = require('node:child_process');
function prepare() {


fs.mkdirSync(source, { recursive: true });
fs.writeFileSync(path.join(source,'.env.local'),'PAY0_FIREBASE_WEB_API_KEY=synthetic-local-only\n');
fs.writeFileSync(path.join(source,'.secret.local'),'TELEGRAM_BOT_TOKEN=\nTELEGRAM_WEBHOOK_SECRET=\nPAY0_WEB_CONTROL_CODE=\nPAY0_TELEGRAM_USERS_BOT_TOKEN=\nPAY0_TELEGRAM_CLIENTS_BOT_TOKEN=\nIQ_CREDENTIALS_KEY=\nFACTURAMA_SANDBOX_USERNAME=\nFACTURAMA_SANDBOX_PASSWORD=\nOPENAI_API_KEY=\n');
const pkg = JSON.parse(fs.readFileSync(path.join(root,'functions/package.json'),'utf8'));
fs.cpSync(path.join(root,'functions/lib'),path.join(source,'lib'),{recursive:true});
pkg.main = 'emulator-entry.cjs'; delete pkg.scripts;
fs.writeFileSync(path.join(source,'package.json'),JSON.stringify(pkg,null,2));
if (!fs.existsSync(path.join(source,'node_modules'))) fs.symlinkSync(path.join(root,'functions/node_modules'),path.join(source,'node_modules'),'junction');
const config = {
  functions: { source:'functions', runtime:'nodejs22' },
  firestore:{ rules:path.join(root,'firestore.rules'), indexes:path.join(root,'firestore.indexes.json') },
  storage:{ rules:path.join(root,'storage.rules') },
  emulators: { auth:{host:'127.0.0.1',port:9099}, functions:{host:'127.0.0.1',port:5001}, firestore:{host:'127.0.0.1',port:8080}, storage:{host:'127.0.0.1',port:9199}, hub:{host:'127.0.0.1',port:14409}, logging:{host:'127.0.0.1',port:14509}, ui:{enabled:false}, singleProjectMode:true }
};
fs.writeFileSync(path.join(base,'firebase.json'),JSON.stringify(config,null,2));
const names = ['parsePagoReceiptPdf','correctPagoReceiptSemanticField','createPago','listPagos','listClientsCanonical','getClientCanonical','listAuthorizedRelatedRecords','getAuthorizedOperationalRecord','listCompaniesCanonical','initPagoDocumentUpload','finalizePagoDocumentUpload','logAuthEventCallable'];
fs.writeFileSync(path.join(source,'synthetic-adc.json'),JSON.stringify({type:'authorized_user',client_id:'synthetic-local-only',client_secret:'synthetic-local-only',refresh_token:'invalid-local-only'}));
const entry = `process.env.GOOGLE_APPLICATION_CREDENTIALS=require('node:path').join(__dirname,'synthetic-adc.json');
const assert=require('node:assert/strict');
assert.equal(process.env.GCLOUD_PROJECT,'demo-pay0-receipt-ui');
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST']) assert.match(process.env[key]||'',/^127\\.0\\.0\\.1:\\d+$/);
const config=JSON.parse(process.env.FIREBASE_CONFIG||'{}');
config.projectId='demo-pay0-receipt-ui';config.storageBucket='pay-0-system.firebasestorage.app';
process.env.FIREBASE_CONFIG=JSON.stringify(config);
const local=host=>['127.0.0.1','localhost','[::1]','::1'].includes(host);
for(const protocol of ['http','https']){const api=require('node:'+protocol),request=api.request;api.request=function(url,...args){const host=typeof url==='string'||url instanceof URL?new URL(url).hostname:String(url.hostname||url.host||'').split(':')[0];assert.ok(local(host),'EXTERNAL_TRANSPORT_FORBIDDEN');return request.call(this,url,...args);};}
const fetch=global.fetch;global.fetch=function(url,...args){assert.ok(local(new URL(typeof url==='string'?url:url.url||url).hostname),'EXTERNAL_FETCH_FORBIDDEN');return fetch(url,...args);};
// Firebase CLI binds namespace methods, losing their static Firestore exports.
// Preserve its emulator-aware methods and restore the real Admin SDK statics.
const admin=require('firebase-admin'), firestore=admin.firestore;
for(const [key,value] of Object.entries(require('firebase-admin/firestore'))) if(!(key in firestore)) Object.defineProperty(firestore,key,{value,enumerable:true});
require.cache[require.resolve('firebase-admin')].exports=new Proxy(admin,{get(target,key){return key==='firestore'?firestore:Reflect.get(target,key);}});
if(!admin.apps.length) admin.initializeApp({projectId:'demo-pay0-receipt-ui',storageBucket:'pay-0-system.firebasestorage.app'});
const original=require('./lib/index.js');
for(const name of ${JSON.stringify(names)}) { assert.equal(typeof original[name],'function',name);exports[name]=original[name]; }
`;
fs.writeFileSync(path.join(source,'emulator-entry.cjs'),entry);
console.log(JSON.stringify({source, exportedCallables:names.length, triggers:0, compiledLibCopied:true}));



}
async function seed() {
 for (const port of [8080,9099]) {
  const deadline=Date.now()+120000;
  while (!await new Promise(resolve=>{const socket=require('node:net').connect(port,'127.0.0.1');socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.setTimeout(1000,()=>{socket.destroy();resolve(false);});})) {
   if(Date.now()>deadline) throw Error('Local emulator not ready: '+port);
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
 }

process.env.GOOGLE_APPLICATION_CREDENTIALS=path.join(source,'synthetic-adc.json');
process.env.GCLOUD_PROJECT='demo-pay0-receipt-ui';
process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST='127.0.0.1:9199';
const admin=require(path.join(root,'functions/node_modules/firebase-admin'));
admin.initializeApp({projectId:process.env.GCLOUD_PROJECT,storageBucket:'pay-0-system.firebasestorage.app'});
const fixture={projectId:process.env.GCLOUD_PROJECT,uid:'receipt-ui-super',rootId:'receipt-ui-root',email:'receipt-ui@example.test',password:require('node:crypto').randomBytes(24).toString('base64url'),clientId:'receipt-ui-client',companyId:'receipt-ui-company',despachoId:'receipt-ui-dispatch',operationTypeKey:'RECEIPT_UI_TEST'};

 const auth=admin.auth();
 try{await auth.createUser({uid:fixture.uid,email:fixture.email,password:fixture.password,displayName:'QA Comprobantes'});}catch(e){if(e.code!=='auth/uid-already-exists')throw e;await auth.updateUser(fixture.uid,{password:fixture.password});}
 const db=admin.firestore(), batch=db.batch();
 batch.set(db.doc('users/'+fixture.uid),{uid:fixture.uid,rootId:fixture.rootId,role:'superadmin',active:true,userNumber:3,email:fixture.email,name:'QA Comprobantes',displayName:'QA Comprobantes'});
 batch.set(db.doc('clients/'+fixture.clientId),{rootId:fixture.rootId,active:true,clientNumber:7,razonSocial:'Cliente Prueba',nombre:'Cliente Prueba',rfc:'ABC010101AB1',adminId:fixture.uid,createdBy:fixture.uid});
 batch.set(db.doc('companies/'+fixture.companyId),{rootId:fixture.rootId,active:true,companyNumber:5,razonSocial:'Empresa Prueba',nombre:'Empresa Prueba',rfc:'DEF020202CD2',despachoId:fixture.despachoId});
 batch.set(db.doc('despachos/'+fixture.despachoId),{rootId:fixture.rootId,active:true,nombre:'Despacho Prueba',iqEnabled:false});
 batch.set(db.doc('operationTypes/'+fixture.operationTypeKey),{rootId:fixture.rootId,active:true,name:'Operacion sintetica',nombre:'Operacion sintetica',key:fixture.operationTypeKey});
 batch.set(db.doc(`clients/${fixture.clientId}/costos/${fixture.despachoId}__${fixture.operationTypeKey}`),{active:true,assignedCost:5,pricingMode:'PERCENT',calculationBaseType:'TOTAL'});
 batch.set(db.doc(`despachos/${fixture.despachoId}/costos/${fixture.operationTypeKey}`),{active:true,baseCost:2,pricingMode:'PERCENT',calculationBaseType:'TOTAL'});
 await batch.commit();
 require('node:fs').writeFileSync(path.join(base,'fixture.json'),JSON.stringify(fixture,null,2),{mode:0o600});
 console.log(JSON.stringify({seeded:true,projectId:fixture.projectId,documents:7,fixture:'output/receipt-ui-emulator/fixture.json'}));
 await admin.app().delete();


}

function start() {
  if (!fs.existsSync(path.join(source,'lib/index.js'))) throw Error('Run prepare after building Functions');
  const env = { ...process.env, FUNCTIONS_DISCOVERY_TIMEOUT:'60', GCLOUD_PROJECT:'demo-pay0-receipt-ui', GOOGLE_CLOUD_PROJECT:'demo-pay0-receipt-ui',
    GOOGLE_APPLICATION_CREDENTIALS:path.join(source,'synthetic-adc.json'), XDG_CONFIG_HOME:path.join(base,'xdg') };
  fs.mkdirSync(env.XDG_CONFIG_HOME,{recursive:true});
  const binary = process.platform === 'win32' ? 'firebase.cmd' : 'firebase';
  const result = spawnSync(binary,['emulators:start','--non-interactive','--only','auth,firestore,storage,functions','--project','demo-pay0-receipt-ui','--config','output/receipt-ui-emulator/firebase.json'],{cwd:root,env,stdio:'inherit',shell:process.platform === 'win32'});
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
if(require.main===module) {
  const mode=process.argv[2];
  Promise.resolve().then(()=> {
    if(mode==='prepare')return prepare();
    if(mode==='start')return start();
    if(mode==='seed')return seed();
    throw Error('Usage: node qa/scripts/receipt-inline-emulators.cjs prepare|start|seed');
  }).catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
}
