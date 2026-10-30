'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process'),path=require('node:path');
const gate=require('../../scripts/lib/dispersion-notes-create-only.cjs');const key='SYNTHETIC_PUBLIC_KEY_123456789',keySha=crypto.createHash('sha256').update(key).digest('hex');
const endpoint=()=>({id:gate.NAME,project:'pay-0-system',region:'us-central1',platform:'gcfv2',callableTrigger:{}});
const plan=()=>({region:{endpointsToCreate:[endpoint()],endpointsToUpdate:[],endpointsToDelete:[],endpointsToSkip:[]}});
const api=()=>({name:gate.RESOURCE,labels:{'deployment-callable':'true'},buildConfig:{runtime:'nodejs22',entryPoint:gate.NAME},serviceConfig:{timeoutSeconds:60,availableMemory:'256Mi',availableCpu:1,maxInstanceRequestConcurrency:1,environmentVariables:{PAY0_FIREBASE_WEB_API_KEY:key,GCLOUD_PROJECT:'pay-0-system'}}});
function fixture(){let calls=0;const events=[];class Fabricator{async applyPlan(p){calls++;return p;}}const v2={createFunction:async()=>{calls++;return{};},updateFunction:()=>calls++,deleteFunction:()=>calls++},v1={...v2},run={setInvokerCreate:async()=>calls++,setInvokerUpdate:()=>calls++,updateService:()=>calls++};gate.installGuard({Fabricator,v2,v1,run,expectedKeySha:keySha,emit:state=>events.push({state})});return{Fabricator,v2,v1,run,events,get calls(){return calls;}};}
test('single exact create plus own invoker passes with an activation receipt',async()=>{const f=fixture();await new f.Fabricator().applyPlan(plan());await f.v2.createFunction(api());await f.run.setInvokerCreate('pay-0-system','projects/pay-0-system/locations/us-central1/services/listclientdispersionnotes',['public']);gate.validateReceipt(f.events);assert.equal(f.calls,3);});
test('update/delete/extra/skipped/wrong endpoint plans cannot reach original methods',async()=>{for(const mutate of [p=>p.region.endpointsToUpdate.push({endpoint:endpoint()}),p=>p.region.endpointsToDelete.push(endpoint()),p=>p.region.endpointsToSkip.push(endpoint()),p=>p.region.endpointsToCreate.push(endpoint()),p=>p.region.endpointsToCreate[0].id='other',p=>p.region.endpointsToCreate[0].project='other',p=>p.region.endpointsToCreate=[],p=>{delete p.region.endpointsToCreate[0].callableTrigger;p.region.endpointsToCreate[0].httpsTrigger={};},p=>p.region.endpointsToCreate[0].httpsTrigger={}]){const f=fixture(),p=plan();mutate(p);await assert.rejects(new f.Fabricator().applyPlan(p));assert.equal(f.calls,0);}});
test('private GCF mutators and Run update paths fail closed independent of plan',()=>{for(const owner of ['v1','v2'])for(const method of ['updateFunction','deleteFunction']){const f=fixture();assert.throws(()=>f[owner][method]({}));assert.equal(f.calls,0);}const f=fixture();assert.throws(()=>f.v1.createFunction(api()));for(const method of ['setInvokerUpdate','updateService'])assert.throws(()=>f.run[method]({}));assert.equal(f.calls,0);});
test('runtime create config, environment pin, and replay are checked before API dispatch',async()=>{for(const mutate of [x=>x.name+='x',x=>delete x.labels['deployment-callable'],x=>x.serviceConfig.maxInstanceCount=20,x=>x.serviceConfig.maxInstanceRequestConcurrency=80,x=>x.serviceConfig.availableMemory='512Mi',x=>x.serviceConfig.timeoutSeconds=61,x=>x.serviceConfig.minInstanceCount=1,x=>x.serviceConfig.vpcConnector='vpc',x=>x.serviceConfig.secretEnvironmentVariables=[{key:'SECRET'}],x=>x.serviceConfig.environmentVariables.extra='value',x=>x.serviceConfig.environmentVariables.PAY0_FIREBASE_WEB_API_KEY='OTHER_SYNTHETIC_KEY_12345678']){const f=fixture();await new f.Fabricator().applyPlan(plan());const x=api();mutate(x);await assert.rejects(f.v2.createFunction(x));assert.equal(f.calls,1);}const f=fixture();await assert.rejects(f.v2.createFunction(api()));await new f.Fabricator().applyPlan(plan());await f.v2.createFunction(api());await assert.rejects(f.v2.createFunction(api()));assert.equal(f.calls,2);});
test('invoker cannot target another service or add another member',async()=>{for(const mutate of [x=>x[1]+='other',x=>x[2]=['private'],x=>x[0]='other']){const f=fixture();await new f.Fabricator().applyPlan(plan());await f.v2.createFunction(api());const x=['pay-0-system','projects/pay-0-system/locations/us-central1/services/listclientdispersionnotes',['public']];mutate(x);await assert.rejects(f.run.setInvokerCreate(...x));assert.equal(f.calls,2);}});
test('sanitization preserves ordinary usage/config env but cannot inherit preload or extended timeout',()=>{const input={DEBUG:'*',NODE_OPTIONS:'--require other',FUNCTIONS_DISCOVERY_TIMEOUT:'99',FIREBASE_CLI_DISABLE_USAGE:'true',XDG_CONFIG_HOME:'private',PAY0_NOTES_GUARD_RECEIPT:'stale',PAY0_FUNCTIONS_BUILD_MODE:'NORMAL'};const output=gate.cleanEnvironment(input);for(const key of ['DEBUG','NODE_OPTIONS','FUNCTIONS_DISCOVERY_TIMEOUT','PAY0_NOTES_GUARD_RECEIPT'])assert.equal(output[key],undefined);assert.equal(output.FIREBASE_CLI_DISABLE_USAGE,'true');assert.equal(output.XDG_CONFIG_HOME,'private');assert.equal(output.PAY0_FUNCTIONS_BUILD_MODE,'BUNDLED_V1');assert.equal(output.FIREBASE_FUNCTIONS_DISCOVERY_OUTPUT_PATH,'true');assert.equal(input.NODE_OPTIONS,'--require other');});
test('missing or blocked guard receipt cannot count as successful CLI run',()=>{assert.throws(()=>gate.validateReceipt([]));assert.throws(()=>gate.validateReceipt([{state:'GUARD_ACTIVE'}]));assert.throws(()=>gate.validateReceipt([{state:'GUARD_ACTIVE'},{state:'MUTATION_BLOCKED'}]));});
test('PowerShell library-only CAS and postflight fixtures; no external effects',()=>{
 const script=String.raw`
$ErrorActionPreference='Stop'
. ./scripts/deploy-dispersion-notes.ps1 -LibraryOnly
function Invoke-RestMethod {throw 'NETWORK_FORBIDDEN'}
function gcloud.cmd {throw 'NETWORK_FORBIDDEN'}
$checks=0
function Reject([scriptblock]$action){try{&$action;throw 'EXPECTED_REJECTION_MISSING'}catch{if($_.Exception.Message -eq 'EXPECTED_REJECTION_MISSING'){throw}}}
$original=[Text.Encoding]::UTF8.GetBytes("PAY0_FIREBASE_WEB_API_KEY=SYNTHETIC_PUBLIC_KEY_123456789"+[char]13+[char]10+"TELEGRAM_DOWNLOAD_TRANSPORT_MODE=POST_FRAGMENT"+[char]13+[char]10)
$envMap=Get-NotesLocalEnv $original (Get-IqHash $original)
if($envMap.Count -ne 1){throw 'ENV_SCOPE'}
Reject {Get-NotesLocalEnv $original ('0'*64)}
Assert-NotesAbsent @{absent=$true};Reject {Assert-NotesAbsent @{state='ACTIVE'}};Reject {Assert-NotesAbsent $null}
function Snapshot {
 return @{name=$script:NotesResource;state='ACTIVE';buildConfig=@{runtime='nodejs22';entryPoint='listClientDispersionNotes';source=@{storageSource=@{bucket='gcf-v2-sources-751158244178-us-central1';object='listClientDispersionNotes/function-source.zip';generation='123456'}}};serviceConfig=@{timeoutSeconds=60;availableMemory='256Mi';availableCpu='1';maxInstanceRequestConcurrency=1;minInstanceCount=$null;maxInstanceCount=20;ingressSettings='ALLOW_ALL';serviceAccountEmail='751158244178-compute@developer.gserviceaccount.com';environmentVariables=@{PAY0_FIREBASE_WEB_API_KEY='SYNTHETIC_PUBLIC_KEY_123456789';K_SERVICE='managed'};service='projects/pay-0-system/locations/us-central1/services/listclientdispersionnotes';revision='listclientdispersionnotes-00001-abc';vpcConnector=$null;secretEnvironmentVariables=@();secretVolumes=@()}}|ConvertTo-Json -Depth 12|ConvertFrom-Json
}
$r=Snapshot;$result=Assert-NotesPostflight $r $envMap
if($result.hostingApproved -ne $false -or $result.maxStatus -ne 'REQUIRES_REVIEW'){throw 'MAX_SILENTLY_APPROVED'}
$r.serviceConfig.maxInstanceCount=$null;$r.serviceConfig.minInstanceCount=0;$result=Assert-NotesPostflight $r $envMap
if($result.hostingApproved -ne $false -or $result.maxStatus -ne 'REQUIRES_REVIEW'){throw 'MISSING_MAX_SILENTLY_APPROVED'}
foreach($field in @('timeoutSeconds','availableMemory','availableCpu','maxInstanceRequestConcurrency','minInstanceCount','ingressSettings','serviceAccountEmail','service','revision','maxInstanceCount')){$r=Snapshot;$r.serviceConfig.$field='wrong';Reject {Assert-NotesPostflight $r $envMap}}
$r=Snapshot;$r.serviceConfig.secretEnvironmentVariables=@(@{key='SECRET'});Reject {Assert-NotesPostflight $r $envMap}
$r=Snapshot;$r.serviceConfig.secretVolumes=@(@{mountPath='/secret'});Reject {Assert-NotesPostflight $r $envMap}
$r=Snapshot;$r.serviceConfig.vpcConnector='other';Reject {Assert-NotesPostflight $r $envMap}
$r=Snapshot;$r.serviceConfig.environmentVariables|Add-Member EXTRA 'value';Reject {Assert-NotesPostflight $r $envMap}
$r=Snapshot;$r.buildConfig.source.storageSource.generation='0';Reject {Assert-NotesPostflight $r $envMap}
$r=Snapshot;$r.name+='other';Reject {Assert-NotesPostflight $r $envMap}
$dir=Join-Path ([IO.Path]::GetTempPath()) ('pay0-notes-cas-'+[guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($dir)|Out-Null
$file=Join-Path $dir 'fixture.env'
try {
 [IO.File]::WriteAllBytes($file,$original)
 Invoke-NotesPhase $file $original $envMap {if([IO.File]::ReadAllText($file).Contains('TELEGRAM')){throw 'STAGE_SCOPE'}} {param($state)}
 if((Get-IqHash ([IO.File]::ReadAllBytes($file))) -ne (Get-IqHash $original)){throw 'RESTORE'}
 Reject {Invoke-NotesPhase $file $original $envMap {throw 'SYNTHETIC_DEPLOY_FAIL'} {param($state)}}
 if((Get-IqHash ([IO.File]::ReadAllBytes($file))) -ne (Get-IqHash $original)){throw 'FAIL_RESTORE'}
 Reject {Invoke-NotesPhase $file $original $envMap {[IO.File]::WriteAllText($file,'CONCURRENT')} {param($state)}}
 if([IO.File]::ReadAllText($file) -ne 'CONCURRENT'){throw 'CONCURRENT_OVERWRITTEN'}
}finally{Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue;Remove-Item -LiteralPath $dir -Force}
Write-Output 'NOTES_LOCAL_CAS_FIXTURES_PASS'
`;
 const encoded=Buffer.from(script,'utf16le').toString('base64');const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encoded],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(result.status,0,'POWERSHELL_LOCAL_FIXTURE_FAILED');assert.match(result.stdout,/NOTES_LOCAL_CAS_FIXTURES_PASS/);
});

test('concurrent API attempts reserve the sole dispatch before awaiting pin checks',async()=>{let release;const wait=new Promise(resolve=>release=resolve);let dispatched=0;class Fabricator{async applyPlan(){}}const v1={createFunction(){},updateFunction(){},deleteFunction(){}},v2={...v1,createFunction:async()=>{dispatched++;return{};}},run={setInvokerCreate:async()=>{},setInvokerUpdate(){},updateService(){}};gate.installGuard({Fabricator,v1,v2,run,expectedKeySha:keySha,emit:()=>{},beforeCreate:()=>wait});await new Fabricator().applyPlan(plan());const first=v2.createFunction(api());await assert.rejects(v2.createFunction(api()));assert.equal(dispatched,0);release();await first;assert.equal(dispatched,1);});
test('uncertain create cannot be retried or followed by invoker mutation',async()=>{let dispatched=0,iam=0;class Fabricator{async applyPlan(){}}const v1={createFunction(){},updateFunction(){},deleteFunction(){}},v2={...v1,createFunction:async()=>{dispatched++;throw Error('SYNTHETIC_503');}},run={setInvokerCreate:async()=>iam++,setInvokerUpdate(){},updateService(){}};gate.installGuard({Fabricator,v1,v2,run,expectedKeySha:keySha,emit:()=>{}});await new Fabricator().applyPlan(plan());await assert.rejects(v2.createFunction(api()),/SYNTHETIC_503/);await assert.rejects(v2.createFunction(api()));await assert.rejects(run.setInvokerCreate('pay-0-system','projects/pay-0-system/locations/us-central1/services/listclientdispersionnotes',['public']));assert.equal(dispatched,1);assert.equal(iam,0);});

test('captured347 manifest through actual CLI15.3.1 backend/planner/API and callable invoker branch, zero transport',async()=>{
 const fs=require('node:fs'),net=require('node:net'),http=require('node:http'),https=require('node:https');const {root:cli}=gate.cliInfo();
 const manifestFile=path.resolve(__dirname,'../../.worktrees/pay0-remediation-integration-20261009/.firebase/internal-bundle-manifests/notes347-normal-33e7a98.json');
 assert.ok(fs.existsSync(manifestFile),'PREREQUISITE: approved normal347 capture must exist locally; no cloud fallback');const bytes=fs.readFileSync(manifestFile);
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),'9569510897877e74c33312123518af575c73c2a59566b2d8e6ed498f8989f9a5','CAPTURE_PIN');const captured=JSON.parse(bytes);assert.equal(Object.keys(captured.canonicalBuild.endpoints).length,347);assert.equal(captured.buildSha256,'e4c0f5e0ec14a4c7ef2fae0495ccc7e3ae4b3850545aec283255fc12e346e63b');
 const transport=[net.Socket.prototype.connect,http.request,http.get,https.request,https.get,global.fetch];const noNetwork=()=>{throw Error('NETWORK_FORBIDDEN');};net.Socket.prototype.connect=http.request=http.get=https.request=https.get=global.fetch=noNetwork;
 const privateConfig=fs.mkdtempSync(path.join(require("node:os").tmpdir(),"pay0-notes-cli-fake-")),savedXdg=process.env.XDG_CONFIG_HOME;process.env.XDG_CONFIG_HOME=privateConfig;
 let saved=[],logger,silent;
 try{
  const build=require(path.join(cli,'lib/deploy/functions/build.js')),backend=require(path.join(cli,'lib/deploy/functions/backend.js')),prepare=require(path.join(cli,'lib/deploy/functions/prepare.js')),planner=require(path.join(cli,'lib/deploy/functions/release/planner.js'));
  const v2=require(path.join(cli,'lib/gcp/cloudfunctionsv2.js')),v1=require(path.join(cli,'lib/gcp/cloudfunctions.js')),run=require(path.join(cli,'lib/gcp/run.js')),poller=require(path.join(cli,'lib/operation-poller.js')),Fabricator=require(path.join(cli,'lib/deploy/functions/release/fabricator.js')).Fabricator;
  logger=require(path.join(cli,'lib/logger.js')).logger;silent=logger.silent;logger.silent=true;
  const want=build.toBackend({...captured.canonicalBuild,endpoints:{[gate.NAME]:{...captured.canonicalBuild.endpoints[gate.NAME],project:'pay-0-system'}}},{});
  prepare.resolveCpuAndConcurrency(want);const ep=want.endpoints['us-central1'][gate.NAME];assert.ok(ep.callableTrigger);assert.equal(ep.httpsTrigger,undefined);assert.equal(ep.cpu,1);assert.equal(ep.concurrency,1);ep.codebase='default';ep.environmentVariables={PAY0_FIREBASE_WEB_API_KEY:key,FIREBASE_CONFIG:JSON.stringify({projectId:'pay-0-system'}),GCLOUD_PROJECT:'pay-0-system',EVENTARC_CLOUD_EVENT_SOURCE:'projects/pay-0-system/locations/us-central1/services/'+gate.NAME};
  const planned=planner.createDeploymentPlan({wantBackend:want,haveBackend:backend.empty(),codebase:'default',filters:[{codebase:'default',idChunks:[gate.NAME]}],deleteAll:false});
  gate.assertPlan(planned);for(const row of Object.values(planned))assert.deepEqual(Object.keys(row).sort(),['endpointsToCreate','endpointsToDelete','endpointsToSkip','endpointsToUpdate']);
  const storage={bucket:'synthetic-upload',object:'source.zip',generation:'123'};const body=v2.functionFromEndpoint({...ep,source:{storageSource:storage}});gate.assertApi(body);assert.equal(body.labels['deployment-callable'],'true');assert.equal(body.serviceConfig.availableCpu,'1');assert.equal(body.serviceConfig.maxInstanceCount,null);
  for(const owner of [v1,v2,run,poller,Fabricator.prototype])saved.push([owner,Object.getOwnPropertyDescriptors(owner)]);
  let creates=0,invokers=0;const events=[];
  v2.createFunction=async input=>{creates++;gate.assertApi(input);return{name:'synthetic-operation'};};
  poller.pollOperation=async()=>({url:'https://synthetic.invalid',serviceConfig:{service:'projects/pay-0-system/locations/us-central1/services/listclientdispersionnotes'}});
  run.setInvokerCreate=async(project,service,invoker)=>{invokers++;assert.equal(project,'pay-0-system');assert.equal(service,'projects/pay-0-system/locations/us-central1/services/listclientdispersionnotes');assert.deepEqual(invoker,['public']);};
  gate.installGuard({Fabricator,v1,v2,run,expectedKeySha:keySha,emit:state=>events.push({state})});
  const executor={run:fn=>fn()};const fab=new Fabricator({executor,functionExecutor:executor,sources:{default:{storage}},projectNumber:'751158244178'});const result=await fab.applyPlan(planned);
  assert.equal(result.results.length,1);assert.ok(!result.results[0].error,'CLI_FAKE_CREATE_FAILED');assert.equal(creates,1);assert.equal(invokers,1);gate.validateReceipt(events);
 }finally{for(const[owner,descriptors]of saved)Object.defineProperties(owner,descriptors);if(logger)logger.silent=silent;if(savedXdg===undefined)delete process.env.XDG_CONFIG_HOME;else process.env.XDG_CONFIG_HOME=savedXdg;fs.rmSync(privateConfig,{recursive:true,force:true});[net.Socket.prototype.connect,http.request,http.get,https.request,https.get,global.fetch]=transport;}
});
