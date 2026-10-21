import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {tokenInMemory, getMetadata} from './capture-production-baseline.mjs';
import {TARGET, hash, assertDrainWitness, recoveryTrafficPatch} from './telegram-webhook-transition-policy.mjs';

const root=path.resolve(import.meta.dirname,'..'),privateRoot=path.join(root,'.firebase/modular-release');
const functionUrl='https://cloudfunctions.googleapis.com/v2/projects/pay-0-system/locations/us-central1/functions/telegramWebhook';
const operationUrl='https://cloudfunctions.googleapis.com/v2/projects/pay-0-system/locations/us-central1/operations?pageSize=100&filter=done%3Dfalse';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function privateFile(file){const p=path.resolve(file);assert(p.startsWith(privateRoot+path.sep),'PRIVATE_PATH_REQUIRED');for(let q=p;q!==privateRoot;q=path.dirname(q))if(fs.existsSync(q))assert(!fs.lstatSync(q).isSymbolicLink(),'PRIVATE_LINK_FORBIDDEN');return p}
async function state(token){const resource=await getMetadata(functionUrl,token);assert.equal(resource.serviceConfig.service,TARGET);const [service,iam]=await Promise.all([getMetadata('https://run.googleapis.com/v2/'+TARGET,token),getMetadata('https://run.googleapis.com/v2/'+TARGET+':getIamPolicy',token)]);return {resource,service,iam}}
async function jsonGet(url,token){const r=await fetch(url,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(30000)});assert.equal(r.status,200,'CONTROL_READ_FAILED');return r.json()}
async function noOperations(token){const ops=await getMetadata(operationUrl,token);assert.equal((ops.operations||[]).filter(o=>!o.done).length,0,'CONCURRENT_DEPLOYMENT')}

// This function is read-only. Unknown or missing telemetry never becomes zero.
export async function observeDrain(pauseFile,outputFile){
  const pause=JSON.parse(fs.readFileSync(privateFile(pauseFile))),token=tokenInMemory(),current=await state(token);
  assert.equal(hash(current),pause.pauseStateDigest,'DRAIN_CONCURRENT_CHANGE');await noOperations(token);
  const revision=await jsonGet('https://us-central1-run.googleapis.com/apis/serving.knative.dev/v1/namespaces/pay-0-system/revisions/'+pause.legacyRevision,token);
  const end=new Date(),start=new Date(end-20*60000),filter='metric.type="run.googleapis.com/container/instance_count" AND resource.type="cloud_run_revision" AND resource.labels.service_name="telegramwebhook" AND resource.labels.revision_name="'+pause.legacyRevision+'"';
  const metrics=await jsonGet('https://monitoring.googleapis.com/v3/projects/pay-0-system/timeSeries?'+new URLSearchParams({filter,'interval.startTime':start.toISOString(),'interval.endTime':end.toISOString(),view:'FULL'}),token);
  const counts={};
  for(const series of metrics.timeSeries||[]){const label=series.metric?.labels?.state;if(!['active','idle'].includes(label))continue;assert(!counts[label],'DUPLICATE_METRIC_SERIES');const point=series.points?.[0];if(point&&/^[0-9]+$/.test(point.value?.int64Value||''))counts[label]={value:Number(point.value.int64Value),time:point.interval.endTime}}
  const complete=Object.keys(counts).length===2,zero=complete&&counts.active.value===0&&counts.idle.value===0;
  const routed=current.service.trafficStatuses||[],noTags=!(current.service.traffic||[]).some(t=>t.tag),allPause=routed.length===1&&routed[0].revision===pause.pauseRevision&&routed[0].percent===100;
  const expected={pauseArchiveSha256:pause.archiveSha256,pauseRevision:pause.pauseRevision,pauseStateDigest:pause.pauseStateDigest,legacyRevision:pause.legacyRevision};
  const witness={status:'PASS',service:TARGET,...expected,noLegacyTrafficOrTags:noTags&&allPause,legacyInactive:revision.status?.conditions?.some(c=>c.type==='Active'&&c.status==='False')===true,telemetryComplete:complete,legacyActiveInstances:counts.active?.value,legacyIdleInstances:counts.idle?.value,legacyInFlightRequests:zero?0:null,activeOperations:0,sampledAt:complete?new Date(Math.min(Date.parse(counts.active.time),Date.parse(counts.idle.time))).toISOString():null,checkedAt:new Date().toISOString(),pauseTrafficConfirmedAt:pause.pauseTrafficConfirmedAt};
  let reason;try{assertDrainWitness(witness,expected)}catch(e){reason=e.message.split('\n')[0];witness.status='PENDING'}
  const file=privateFile(outputFile);fs.writeFileSync(file,JSON.stringify(witness,null,2),{mode:0o600});
  fs.writeFileSync(file+'.telemetry.json',JSON.stringify({revision,metrics,current}),{mode:0o600});
  console.log(JSON.stringify({status:witness.status,reason,legacyRevision:pause.legacyRevision,counts,legacyInactive:witness.legacyInactive,noLegacyTrafficOrTags:witness.noLegacyTrafficOrTags}));return witness;
}

export async function prepareRecovery(expectedFile,pauseFile,outputFile){
  const expectedBytes=fs.readFileSync(privateFile(expectedFile)),expected=JSON.parse(expectedBytes),pauseBytes=fs.readFileSync(privateFile(pauseFile)),pause=JSON.parse(pauseBytes),token=tokenInMemory();
  const current=await state(token);pause.observedRevision=await getMetadata('https://run.googleapis.com/v2/'+TARGET+'/revisions/'+pause.revision,token);
  const body=recoveryTrafficPatch(expected,current,pause);await noOperations(token);
  // validateOnly checks IAM and request shape without changing traffic.
  const response=await fetch('https://run.googleapis.com/v2/'+TARGET+'?updateMask=traffic&validateOnly=true',{method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});
  assert(response.ok,'RECOVERY_VALIDATION_HTTP_'+response.status);await response.json();assert.equal(hash(await state(token)),hash(current),'VALIDATION_CHANGED_STATE');
  const plan={status:'READY',expectedFile:privateFile(expectedFile),expectedSha256:sha(expectedBytes),pauseFile:privateFile(pauseFile),pauseSha256:sha(pauseBytes),validatedBody:body,service:TARGET,method:'PATCH',updateMask:'traffic',redeployments:0,validatedAt:new Date().toISOString()};
  fs.writeFileSync(privateFile(outputFile),JSON.stringify(plan,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify({status:'RECOVERY_VALIDATED_NO_TRAFFIC_CHANGE',pauseRevision:pause.revision,redeployments:0}));return plan;
}

export async function executeRecovery(planFile,planSha256){
  const bytes=fs.readFileSync(privateFile(planFile));assert.equal(sha(bytes),planSha256,'RECOVERY_PLAN_CHANGED');const plan=JSON.parse(bytes);
  assert.equal(plan.status,'READY');assert.equal(plan.service,TARGET);assert.equal(plan.updateMask,'traffic');assert.equal(plan.method,'PATCH');
  const expectedBytes=fs.readFileSync(privateFile(plan.expectedFile)),pauseBytes=fs.readFileSync(privateFile(plan.pauseFile));assert.equal(sha(expectedBytes),plan.expectedSha256);assert.equal(sha(pauseBytes),plan.pauseSha256);
  const expected=JSON.parse(expectedBytes),pause=JSON.parse(pauseBytes),token=tokenInMemory(),current=await state(token);pause.observedRevision=await getMetadata('https://run.googleapis.com/v2/'+TARGET+'/revisions/'+pause.revision,token);const body=recoveryTrafficPatch(expected,current,pause);assert.deepEqual(body,plan.validatedBody);await noOperations(token);
  const journal=privateFile(planFile+'.execution.jsonl'),fd=fs.openSync(journal,'wx',0o600),emit=row=>fs.writeSync(fd,JSON.stringify({time:new Date().toISOString(),...row})+'\n');
  try{
    emit({state:'DISPATCHING',planSha256});
    const response=await fetch('https://run.googleapis.com/v2/'+TARGET+'?updateMask=traffic',{method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});assert(response.ok,'RECOVERY_HTTP_'+response.status);const operation=await response.json();assert.match(operation.name,/^projects\/(pay-0-system|751158244178)\/locations\/us-central1\/operations\/[^/]+$/);emit({state:'ACCEPTED',operation:operation.name});
    let done=false;for(let i=0;i<120;i++){const status=await getMetadata('https://run.googleapis.com/v2/'+operation.name,token);if(status.done){assert(!status.error,'RECOVERY_OPERATION_FAILED');done=true;break}await new Promise(r=>setTimeout(r,10000))}assert(done,'RECOVERY_OPERATION_PENDING');
    const after=await state(token);assert.equal(hash(after.resource),hash(expected.resource),'RECOVERY_FUNCTION_CHANGED');assert.equal(hash(after.iam),hash(expected.iam),'RECOVERY_IAM_CHANGED');
    const normalize=value=>{const v=structuredClone(value);for(const k of ['traffic','trafficStatuses','generation','observedGeneration','updateTime','etag'])delete v[k];if(v.terminalCondition)delete v.terminalCondition.lastTransitionTime;for(const c of v.conditions||[])delete c.lastTransitionTime;return v};assert.equal(hash(normalize(after.service)),hash(normalize(expected.service)),'RECOVERY_RUNTIME_CHANGED');
    assert.equal(after.service.trafficStatuses?.length,1);assert.equal(after.service.trafficStatuses[0].revision,pause.revision);assert.equal(after.service.trafficStatuses[0].percent,100);emit({state:'VERIFIED',revision:pause.revision,redeployments:0});fs.writeFileSync(privateFile(planFile+'.after.json'),JSON.stringify(after),{flag:'wx',mode:0o600});console.log(JSON.stringify({status:'RECOVERY_VERIFIED',revision:pause.revision,redeployments:0}));
  }finally{fs.closeSync(fd)}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{const [mode,...args]=process.argv.slice(2);if(mode==='--observe-drain')await observeDrain(...args);else if(mode==='--prepare-recovery')await prepareRecovery(...args);else if(mode==='--execute-recovery')await executeRecovery(...args);else throw Error('MODE_REQUIRED')}catch(e){console.error('TELEGRAM_TRANSITION_CONTROL_FAILED '+(/^[A-Z_0-9]+$/.test(e.message)?e.message:'detailsRedacted=true'));process.exitCode=1}}
