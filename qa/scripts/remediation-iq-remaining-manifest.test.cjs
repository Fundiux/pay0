'use strict';
// Real SDK/CLI options and PATCH; no PAY0 handler imports or provider traffic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
const ts=require(require.resolve('typescript',{paths:[root]}));
const sdk=path.resolve(path.dirname(require.resolve('firebase-functions/v2',{paths:[path.join(root,'functions')]})),'../..');
const cli=process.env.PAY0_FIREBASE_TOOLS_ROOT||path.join(process.env.APPDATA||'', 'npm/node_modules/firebase-tools');
const {Client}=require(path.join(cli,'lib/apiv2.js'));
const gcf=require(path.join(cli,'lib/gcp/cloudfunctionsv2.js'));
const backend=require(path.join(cli,'lib/deploy/functions/backend.js'));
const prepare=require(path.join(cli,'lib/deploy/functions/prepare.js'));
const providers={onCall:require(path.join(sdk,'lib/v2/providers/https.js')).onCall,onSchedule:require(path.join(sdk,'lib/v2/providers/scheduler.js')).onSchedule,onTaskDispatched:require(path.join(sdk,'lib/v2/providers/tasks.js')).onTaskDispatched};
require(path.join(sdk,'lib/v2/options.js')).setGlobalOptions({region:'us-central1'});
for(const mod of ['node:http','node:https']){const net=require(mod);net.request=net.get=()=>{throw Error('NETWORK_FORBIDDEN');};}
global.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
const cases=[
 ['iq/solicitudCreationCallables','createSolicitudIq','onCall',20,1,300,true],
 ['iq/solicitudCreateQueueCallables','processIqCreateOnDemandTask','onTaskDispatched',1,1,540,true],
 ['iq/solicitudCreateQueueCallables','processIqCreateQueue','onSchedule',20,80,540,true,'every 1 minutes'],
 ['iq/dispersionCreationCallables','createClientDispersionIq','onCall',1,1,540,false],
 ['iq/dispersionCreationCallables','processIqDispersionCreate','onSchedule',1,1,540,false,'every 5 minutes'],
 ['commissionDistributions/execution','executeUserCommissionDispersion','onCall',2,80,540,false],
];
let assertions=0,captured;
const eq=(a,b)=>{assert.deepEqual(a,b);assertions++;};
const original=Client.prototype.patch;
Client.prototype.patch=async function(resource,body,options){assert.match(resource,/^projects\/demo-pay0-manifest\/locations\/us-central1\/functions\//);captured={body:JSON.parse(JSON.stringify(body)),options};return{body:{name:'synthetic-operation'}};};
(async()=>{try{
 for(const [file,name,provider,max,concurrency,timeout,telegram,schedule] of cases){
  const source=ts.createSourceFile(file,fs.readFileSync(path.join(root,'functions/src/modules',file+'.ts'),'utf8'),ts.ScriptTarget.Latest,true);let literal;
  function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(source)===name){assert.equal(node.initializer.expression.getText(source),provider);literal=node.initializer.arguments[0].getText(source);}ts.forEachChild(node,visit);}visit(source);assert(literal);
  const options=vm.runInNewContext('('+literal+')',{IQ_CREDENTIALS_KEY:'IQ_CREDENTIALS_KEY',TELEGRAM_BOT_TOKEN:'TELEGRAM_BOT_TOKEN',USER_COMMISSION_IQ_SECRET:'IQ_CREDENTIALS_KEY',DEFAULT_IQ_TIME_ZONE:'America/Mexico_City'});
  eq(options.preserveExternalChanges,true);eq(options.maxInstances,max);eq(options.concurrency,concurrency);
  const manifest=JSON.parse(JSON.stringify(providers[provider](options,()=>{}).__endpoint));
  eq(manifest.availableMemoryMb,2048);eq(manifest.timeoutSeconds,timeout);eq(manifest.maxInstances,max);eq(manifest.concurrency,concurrency);
  eq(manifest.secretEnvironmentVariables.map(x=>x.key).sort(),telegram?['IQ_CREDENTIALS_KEY','TELEGRAM_BOT_TOKEN']:['IQ_CREDENTIALS_KEY']);
  for(const key of ['minInstances','ingressSettings','serviceAccountEmail','vpc'])eq(Object.hasOwn(manifest,key),false);
  if(schedule){eq(manifest.scheduleTrigger.schedule,schedule);eq(manifest.scheduleTrigger.timeZone,'America/Mexico_City');}
  if(provider==='onTaskDispatched'){
   eq(manifest.taskQueueTrigger.retryConfig.maxAttempts,1);eq(manifest.taskQueueTrigger.retryConfig.minBackoffSeconds,60);eq(manifest.taskQueueTrigger.retryConfig.maxBackoffSeconds,300);
   eq(manifest.taskQueueTrigger.rateLimits.maxConcurrentDispatches,1);eq(manifest.taskQueueTrigger.rateLimits.maxDispatchesPerSecond,1);eq(Object.hasOwn(manifest.taskQueueTrigger.retryConfig,'maxDoublings'),false);
  }
  for(const populated of [false,true]){
   const desired={...manifest,id:name,project:'demo-pay0-manifest',region:'us-central1',runtime:'nodejs22',entryPoint:name};
   const live={...desired,cpu:1,maxInstances:7,concurrency:3,...(populated?{minInstances:2,ingressSettings:'ALLOW_INTERNAL_ONLY',serviceAccountEmail:'synthetic@demo-pay0-manifest.iam.gserviceaccount.com',vpc:{connector:'projects/demo-pay0-manifest/locations/us-central1/connectors/synthetic',egressSettings:'ALL_TRAFFIC'}}:{})};
   const want=backend.of(desired);prepare.inferDetailsFromExisting(want,backend.of(live),true);prepare.resolveCpuAndConcurrency(want);
   await gcf.updateFunction(gcf.functionFromEndpoint(desired));
   const mask=captured.options.queryParams.updateMask.split(','),service=captured.body.serviceConfig;
   eq(service.maxInstanceCount,max);eq(service.maxInstanceRequestConcurrency,concurrency);eq(service.availableCpu,'1');eq(service.availableMemory,'2Gi');eq(service.timeoutSeconds,timeout);
   eq(mask.includes('serviceConfig.maxInstanceCount'),true);eq(mask.includes('serviceConfig.maxInstanceRequestConcurrency'),true);eq(mask.includes('serviceConfig'),false);
   for(const key of ['minInstanceCount','ingressSettings','serviceAccountEmail','vpcConnector','vpcConnectorEgressSettings'])eq(mask.includes('serviceConfig.'+key),false);
  }
  const unsafe=JSON.parse(JSON.stringify(providers[provider]({...options,preserveExternalChanges:false},()=>{}).__endpoint));eq(unsafe.minInstances,null);eq(unsafe.maxInstances,max);
 }
 console.log('IQ_REMAINING_MANIFEST_PASS functions=6 scenarios=12 assertions='+assertions+' SDK='+require(path.join(sdk,'package.json')).version+' CLI='+require(path.join(cli,'package.json')).version+' network=forbidden');
}finally{Client.prototype.patch=original;}})().catch(error=>{console.error(error instanceof assert.AssertionError?error.message:'IQ_REMAINING_MANIFEST_FAIL');process.exitCode=1;});
