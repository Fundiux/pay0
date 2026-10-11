'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {spawnSync}=require('node:child_process');
const {discoverOwned,validateCliBuild,diagnosticCode}=require('./verify-functions-cli-discovery.cjs');
const root=path.resolve(__dirname,'../..');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const hash=x=>crypto.createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(canonical(x))).digest('hex');
function validateNormalEntry({provenanceExists,code}){
 assert.equal(provenanceExists,false,'NORMAL_PROVENANCE_REQUIRED_ABSENT');
 assert.ok(!/\b__commonJS\b/.test(code),'NORMAL_ENTRY_MUST_NOT_BE_BUNDLE');
 assert.match(code,/require\(["']\.\.?\//,'NORMAL_ENTRY_INTERNAL_REQUIRE_REQUIRED');
 return hash(code);
}
function baselineRelative(value){assert.match(value||'',/^\.firebase\/internal-bundle-manifests\/[a-zA-Z0-9._-]+\.json$/,'BASELINE_PRIVATE_SCOPE');return value;}
function makeBaseline({build,elapsedMs,sourceInputs,cliVersion,entrySha256,sourceCommit,sourceTree}){
 const endpointCount=validateCliBuild(build,elapsedMs);
 for(const value of [sourceCommit,sourceTree])assert.match(value,/^[a-f0-9]{40}$/,'SOURCE_GIT_ID');
 assert.match(entrySha256,/^[a-f0-9]{64}$/);assert.match(cliVersion,/^\d+\.\d+\.\d+(?:[-+].+)?$/);
 assert.ok(Array.isArray(sourceInputs)&&sourceInputs.length);
 return{schema:'PAY0-NORMAL-BUNDLE-MANIFEST@1',endpointCount,elapsedMs,normal:{entrySha256,sourceCommit,sourceTree,cliVersion},sourceInputs,canonicalBuild:canonical(build),buildSha256:hash(build)};
}
function compareBaseline(baseline,{build,elapsedMs,sourceInputs,cliVersion}){
 assert.equal(baseline.schema,'PAY0-NORMAL-BUNDLE-MANIFEST@1');
 assert.equal(baseline.buildSha256,hash(baseline.canonicalBuild),'BASELINE_HASH_DRIFT');
 assert.equal(validateCliBuild(build,elapsedMs),baseline.endpointCount);
 assert.equal(cliVersion,baseline.normal.cliVersion,'CLI_VERSION_DRIFT');
 assert.deepEqual(sourceInputs,baseline.sourceInputs,'SOURCE_INPUT_DRIFT');
 assert.deepEqual(canonical(build),baseline.canonicalBuild,'COMPLETE_MANIFEST_MISMATCH');
 return hash(build);
}
function readPinnedBaseline(file,expectedSha256){assert.match(expectedSha256||'',/^[a-f0-9]{64}$/,'BASELINE_PIN_REQUIRED');const bytes=fs.readFileSync(file);assert.equal(hash(bytes),expectedSha256,'BASELINE_PIN_MISMATCH');return JSON.parse(bytes.toString('utf8'));}
function writeBaseline(file,value){fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
function gitValue(args){const result=spawnSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,'GIT_METADATA');return result.stdout.trim();}
const diagnosticState={stage:'ARGUMENTS',discoveryStartedAt:null,elapsedMs:null};
const diagnosticStages=['ARGUMENTS','PRIVATE_PATH','SOURCE_SNAPSHOT','NORMAL_PROVENANCE','INSTALLED_PROVENANCE','CLI_RESOLUTION','DISCOVERY','MANIFEST_VALIDATION','SOURCE_RECHECK','BASELINE_CAPTURE','BASELINE_COMPARE'];
const knownFailures=['BASELINE_PRIVATE_SCOPE','BASELINE_PIN_REQUIRED','BASELINE_PIN_MISMATCH','BASELINE_ALREADY_EXISTS','BASELINE_MUST_BE_IGNORED','EXPLICIT_MANIFEST_MODE_REQUIRED','NORMAL_PROVENANCE_REQUIRED_ABSENT','NORMAL_ENTRY_MUST_NOT_BE_BUNDLE','NORMAL_ENTRY_INTERNAL_REQUIRE_REQUIRED','PATH_SCOPE','PATH_LINK','PATH_TYPE','SOURCE_DRIFT','SOURCE_INPUT_DRIFT','ENTRY_CHANGED_DURING_DISCOVERY','BASELINE_HASH_DRIFT','BASELINE_CHANGED_DURING_DISCOVERY','COMPLETE_MANIFEST_MISMATCH','CLI_VERSION_DRIFT','SOURCE_GIT_ID','GIT_METADATA'];
function failureReport(error,state,now=performance.now()){
 const firstLine=error instanceof Error?error.message.split(/\r?\n/,1)[0]:'';
 const known=knownFailures.includes(firstLine)?firstLine:null;
 const fileCode=['ENOENT','EACCES','EPERM','EEXIST'].includes(error?.code)?'LOCAL_'+error.code:null;
 const elapsed=state.elapsedMs??(Number.isFinite(state.discoveryStartedAt)?Math.round(now-state.discoveryStartedAt):null);
 return{result:'BUNDLE_MANIFEST_FAILED',stage:diagnosticStages.includes(state.stage)?state.stage:'UNKNOWN',code:known||fileCode||diagnosticCode(error),elapsedMs:Number.isFinite(elapsed)&&elapsed>=0?elapsed:null,limitMs:7000,cliTimeoutMs:10000,detailsRedacted:true};
}
async function main(){
 const[mode,relative,expectedBaselineSha256,...extra]=process.argv.slice(2);assert.equal(extra.length,0);if(mode==='--capture-normal')assert.equal(expectedBaselineSha256,undefined);else assert.match(expectedBaselineSha256||'',/^[a-f0-9]{64}$/,'BASELINE_PIN_REQUIRED');assert.ok(['--capture-normal','--compare-installed'].includes(mode),'EXPLICIT_MANIFEST_MODE_REQUIRED');baselineRelative(relative);
 diagnosticState.stage='PRIVATE_PATH';
 const integrity=await import(pathToFileURL(path.join(root,'scripts/lib/functions-bundle-integrity.mjs')).href);
 const installer=await import(pathToFileURL(path.join(root,'scripts/install-functions-internal-bundle.mjs')).href);
 const file=integrity.checkedPath(root,relative),entry=path.join(root,'functions/lib/index.js');
 assert.equal(spawnSync('git',['-C',root,'check-ignore','--quiet','--',relative],{windowsHide:true}).status,0,'BASELINE_MUST_BE_IGNORED');
 diagnosticState.stage='SOURCE_SNAPSHOT';
 const sourceInputs=integrity.sourceSnapshot(root),entryBytes=fs.readFileSync(entry);let baseline;
 if(mode==='--capture-normal'){
  diagnosticState.stage='NORMAL_PROVENANCE';
  assert.ok(!fs.existsSync(file),'BASELINE_ALREADY_EXISTS');
  validateNormalEntry({provenanceExists:fs.existsSync(path.join(root,installer.PROVENANCE)),code:entryBytes.toString('utf8')});
 }else{diagnosticState.stage='INSTALLED_PROVENANCE';installer.verifyInstalled(root);baseline=readPinnedBaseline(file,expectedBaselineSha256);}
 diagnosticState.stage='CLI_RESOLUTION';
 const candidates=[process.env.APPDATA&&path.join(process.env.APPDATA,'npm/node_modules/firebase-tools/lib'),process.env.npm_config_prefix&&path.join(process.env.npm_config_prefix,'node_modules/firebase-tools/lib')].filter(Boolean);
 const cli=candidates.find(base=>fs.existsSync(path.join(base,'deploy/functions/runtimes/node/index.js')));assert.ok(cli,'CLI_UNAVAILABLE');
 const cliVersion=JSON.parse(fs.readFileSync(path.join(cli,'../package.json'),'utf8')).version;
 delete process.env.DEBUG;delete process.env.FUNCTIONS_DISCOVERY_TIMEOUT;process.env.FIREBASE_FUNCTIONS_DISCOVERY_OUTPUT_PATH='true';
 assert.ok(!fs.existsSync(path.join(root,'functions/functions.yaml')),'STATIC_MANIFEST_FORBIDDEN');
 const{Delegate}=require(path.join(cli,'deploy/functions/runtimes/node/index.js'));
 diagnosticState.stage='DISCOVERY';
 const start=performance.now();diagnosticState.discoveryStartedAt=start;
 const build=await discoverOwned(Delegate,['demo-pay0-discovery',root,path.join(root,'functions'),'nodejs22'],{},{GCLOUD_PROJECT:'demo-pay0-discovery',FIREBASE_CONFIG:JSON.stringify({projectId:'demo-pay0-discovery',storageBucket:'demo-pay0-discovery.appspot.com'})});
 const elapsedMs=Math.round(performance.now()-start);diagnosticState.elapsedMs=elapsedMs;diagnosticState.stage='MANIFEST_VALIDATION';
 const endpoints=validateCliBuild(build,elapsedMs);
 diagnosticState.stage='SOURCE_RECHECK';
 integrity.assertSnapshot(root,sourceInputs);assert.equal(hash(fs.readFileSync(entry)),hash(entryBytes),'ENTRY_CHANGED_DURING_DISCOVERY');
 let fullBuildSha256;
 if(mode==='--capture-normal'){
  validateNormalEntry({provenanceExists:fs.existsSync(path.join(root,installer.PROVENANCE)),code:fs.readFileSync(entry,'utf8')});
  diagnosticState.stage='BASELINE_CAPTURE';
  baseline=makeBaseline({build,elapsedMs,sourceInputs,cliVersion,entrySha256:hash(entryBytes),sourceCommit:gitValue(['rev-parse','HEAD']),sourceTree:gitValue(['rev-parse','HEAD^{tree}'])});
  fs.mkdirSync(path.dirname(file),{recursive:true});integrity.checkedPath(root,relative);writeBaseline(file,baseline);fullBuildSha256=baseline.buildSha256;
 }else{diagnosticState.stage='BASELINE_COMPARE';installer.verifyInstalled(root);assert.deepEqual(readPinnedBaseline(file,expectedBaselineSha256),baseline,'BASELINE_CHANGED_DURING_DISCOVERY');fullBuildSha256=compareBaseline(baseline,{build,elapsedMs,sourceInputs,cliVersion});}
 console.log(JSON.stringify({result:'PASS',mode,endpoints,elapsedMs,fullBuildSha256,baselineFileSha256:hash(fs.readFileSync(file)),cliVersion,normalSourceCommit:baseline.normal.sourceCommit,normalSourceTree:baseline.normal.sourceTree,remoteCalls:0}));
}
module.exports={canonical,validateNormalEntry,baselineRelative,makeBaseline,compareBaseline,writeBaseline,readPinnedBaseline,failureReport};
if(require.main===module)main().catch(error=>{console.error(JSON.stringify(failureReport(error,diagnosticState)));process.exitCode=1;});
