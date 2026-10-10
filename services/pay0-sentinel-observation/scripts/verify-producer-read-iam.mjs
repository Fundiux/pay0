// Candidate: import/default has no I/O. Execute requires central review; no role provisioning here.
import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {pathToFileURL} from 'node:url';
import {createProbeClient,runReadProbe,fixtureName,DATABASE} from './producer-read-sdk.mjs';
export const ACCOUNT='pay0-observation-canary@pay-0-system.iam.gserviceaccount.com';
export const ACCESS_ROLE='projects/pay-0-system/roles/canaryAccessVerifier';
export const READ_ROLE='projects/pay0-sentinel-observe/roles/sentinelSyntheticReader';
const SA='https://iam.googleapis.com/v1/projects/-/serviceAccounts/'+ACCOUNT;
const PROJECT='https://cloudresourcemanager.googleapis.com/v1/projects/pay0-sentinel-observe';
const RUN='https://run.googleapis.com/v2/projects/pay-0-system/locations/us-central1/services/pay0-security-canary';
const API='https://firestore.googleapis.com/v1/';
const USERINFO='https://www.googleapis.com/oauth2/v2/userinfo?fields=email,verified_email';
const fail=()=>{throw Error('IAM_GATE_REFUSED');};
const equal=(a,b)=>a?.title===b.title&&a?.description===b.description&&a?.expression===b.expression;
export function bindingPolicy(policy,target,condition,remove){
 if(!policy?.etag||!Array.isArray(policy.bindings))fail();const next=structuredClone(policy);next.version=3;
 const collisions=next.bindings.filter(b=>b.role===target.role&&b.condition?.title===condition.title&&!equal(b.condition,condition));if(collisions.length)fail();
 next.bindings=next.bindings.flatMap(b=>{if(b.role!==target.role||!equal(b.condition,condition))return[b];const members=b.members.filter(m=>m!==target.member);return members.length?[{...b,members}]:[];});
 if(!remove){const b=next.bindings.find(b=>b.role===target.role&&equal(b.condition,condition));if(b)b.members.push(target.member);else next.bindings.push({role:target.role,members:[target.member],condition});}
 return next;
}
export function plan(run,startMs,operatorEmail,revision){
 if(!/^[a-f0-9]{32}$/.test(run)||!Number.isSafeInteger(startMs)||!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$/.test(operatorEmail)||operatorEmail.endsWith('.gserviceaccount.com')||revision!=='pay0-security-canary-00006-6wv')fail();
 const expiry=new Date(startMs+20*60000).toISOString();const condition=(suffix,resource)=>({title:`producer-iam-${run}-${suffix}`,description:'Temporary synthetic read IAM gate',expression:(resource?`resource.name == '${resource}' && `:'')+`request.time < timestamp('${expiry}')`});
 return{schema:1,run,startMs,expiry,operatorEmail:operatorEmail.toLowerCase(),revision,
  access:{base:SA,role:ACCESS_ROLE,member:'user:'+operatorEmail.toLowerCase()},reader:{base:PROJECT,role:READ_ROLE,member:'serviceAccount:'+ACCOUNT},
  accessCondition:condition('access'),positive:condition('positive',DATABASE),negative:condition('negative','projects/pay0-sentinel-observe/databases/(default)')};
}
function present(policy,target,c){return policy.bindings.some(b=>b.role===target.role&&b.members.includes(target.member)&&equal(b.condition,c));}
function ownTitle(policy,target,c){return policy.bindings.some(b=>b.role===target.role&&b.members.includes(target.member)&&b.condition?.title===c.title);}
export function createHttp({operatorToken,fetchImpl=fetch,now=Date.now}){
 let calls=0,cleanup=false;const start=now(),deadline=start+10*60000;
 const charge=()=>{if(++calls>(cleanup?120:80)||now()>=(cleanup?deadline:start+8*60000))fail();};
 return{charge,beginCleanup(){cleanup=true;},get calls(){return calls;},async request(method,url,body=null,{token=operatorToken,read=true}={}){
  charge();if(url!==USERINFO&&!/^https:\/\/(iam|iamcredentials|cloudresourcemanager|firestore|run)\.googleapis\.com\//.test(url))fail();
  let response;try{response=await fetchImpl(url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(Math.min(20000,(cleanup?deadline:start+8*60000)-now()))});}catch{return{status:0,data:null};}
  const status=response.status;if(!read||!response.ok){await response.body?.cancel();return{status,data:null};}
  const reader=response.body.getReader();let bytes=0;const chunks=[];try{for(;;){const r=await reader.read();if(r.done)break;bytes+=r.value.length;if(bytes>262144){await reader.cancel();fail();}chunks.push(Buffer.from(r.value));}return{status,data:JSON.parse(Buffer.concat(chunks).toString('utf8'))};}finally{reader.releaseLock();}
 }};
}
async function getPolicy(http,t){const r=await http.request('POST',t.base+':getIamPolicy',{options:{requestedPolicyVersion:3}});if(r.status!==200||!r.data?.etag||!Array.isArray(r.data.bindings))fail();return r.data;}
export async function setBinding(http,target,condition,remove){
 for(let i=0;i<3;i++){const current=await getPolicy(http,target),next=bindingPolicy(current,target,condition,remove);const r=await http.request('POST',target.base+':setIamPolicy',{policy:next});if([409,412].includes(r.status))continue;if(r.status!==200)fail();const actual=await getPolicy(http,target);if(remove?!ownTitle(actual,target,condition):present(actual,target,condition))return;fail();}fail();
}
export async function assertDisabled(http,p){
 const r=await http.request('GET',RUN);const full=RUN.replace('https://run.googleapis.com/v2/','')+'/revisions/'+p.revision;const s=r.data;
 if(r.status!==200||s?.name!==RUN.replace('https://run.googleapis.com/v2/','')||s?.reconciling===true||s?.invokerIamDisabled===true||s?.latestReadyRevision!==full||s?.latestCreatedRevision!==full||s?.trafficStatuses?.length!==1||s.trafficStatuses[0].revision!==p.revision||s.trafficStatuses[0].percent!==100||s.trafficStatuses[0].tag)fail();
 const rev=await http.request('GET','https://run.googleapis.com/v2/'+full);const c=rev.data?.containers;
 if(rev.status!==200||rev.data?.name!==full||rev.data?.serviceAccount!==ACCOUNT||c?.length!==1)fail();const modes=c[0].env?.filter(e=>e.name==='OBSERVATION_PUBLISHER_MODE');if(modes?.length!==1||modes[0].value!=='DISABLED')fail();
}
async function assertRoles(http){for(const[role,permissions]of [[ACCESS_ROLE,['iam.serviceAccounts.getAccessToken']],[READ_ROLE,['datastore.entities.get','datastore.entities.list']]]){const r=await http.request('GET','https://iam.googleapis.com/v1/'+role);if(r.status!==200||r.data?.deleted===true||r.data?.stage!=='GA'||JSON.stringify([...(r.data?.includedPermissions||[])].sort())!==JSON.stringify([...permissions].sort()))fail();}}
function fixtureFields(run){return{schema:{integerValue:'1'},synthetic:{booleanValue:true},probeTag:{stringValue:run}};}
function isFixture(doc,name,run){return doc?.name===name&&doc.fields?.schema?.integerValue==='1'&&doc.fields?.synthetic?.booleanValue===true&&doc.fields?.probeTag?.stringValue===run&&Object.keys(doc.fields||{}).length===3&&typeof doc.updateTime==='string';}
async function cleanupFixture(http,name,run,expectedUpdateTime){const r=await http.request('GET',API+name);if(r.status===404)return;if(r.status!==200||!isFixture(r.data,name,run)||!expectedUpdateTime||r.data.updateTime!==expectedUpdateTime)fail();const deleted=await http.request('DELETE',API+name+'?currentDocument.updateTime='+encodeURIComponent(r.data.updateTime),null,{read:false});if(deleted.status!==200)fail();const verify=await http.request('GET',API+name,null,{read:false});if(verify.status!==404)fail();}
export async function verify(p,{http,now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms)),sdk=createProbeClient,probe=runReadProbe,journal=()=>{}}){
 const fresh=plan(p.run,p.startMs,p.operatorEmail,p.revision);if(JSON.stringify(fresh)!==JSON.stringify(p))fail();
 const state={fixtureVersions:{},attempted:[],accountUniqueId:null,seedAttempted:false};const record=patch=>{Object.assign(state,patch);journal(structuredClone(state));};
 const statuses=[];const emit=(stage,status)=>{if(!/^[A-Z0-9_]+$/.test(stage)||!/^[A-Z0-9_]+$/.test(status))fail();statuses.push({stage,status});};
 let passed=false,clean=true,handle,accessToken;const attempted=[];const names=[fixtureName(p.run),fixtureName(p.run)+'-write'];let seeded=false;
 const alive=()=>{if(now()>=p.startMs+8*60000||now()<p.startMs)fail();};
 const sdkProbe=kind=>{alive();http.charge();return probe(handle,p.run,kind,Math.min(20000,p.startMs+8*60000-now()));};
 try{
  alive();const operator=await http.request('GET',USERINFO);if(operator.status!==200||operator.data?.verified_email!==true||operator.data?.email?.toLowerCase()!==p.operatorEmail)fail();await assertDisabled(http,p);await assertRoles(http);
  const identity=await http.request('GET',SA);if(identity.status!==200||identity.data?.email!==ACCOUNT||identity.data?.disabled===true||!/^\d{10,30}$/.test(identity.data?.uniqueId))fail();record({phase:'IDENTITY_PINNED',accountUniqueId:identity.data.uniqueId});
  for(const[base,permissions]of [[SA,['iam.serviceAccounts.getIamPolicy','iam.serviceAccounts.setIamPolicy']],[PROJECT,['resourcemanager.projects.getIamPolicy','resourcemanager.projects.setIamPolicy','datastore.entities.get','datastore.entities.create','datastore.entities.update','datastore.entities.delete']]]){const granted=await http.request('POST',base+':testIamPermissions',{permissions});if(granted.status!==200||permissions.some(v=>!granted.data?.permissions?.includes(v)))fail();}const database=await http.request('GET',API+DATABASE);if(database.status!==200||database.data?.name!==DATABASE)fail();
  for(const [target,c]of [[p.access,p.accessCondition],[p.reader,p.positive],[p.reader,p.negative]])if(ownTitle(await getPolicy(http,target),target,c))fail();
  for(const name of names){const absent=await http.request('GET',API+name,null,{read:false});if(absent.status!==404)fail();}
  record({phase:'SEED_ATTEMPTED',seedAttempted:true});seeded=true;const seed=await http.request('POST',API+DATABASE+'/documents:commit',{writes:[{update:{name:names[0],fields:fixtureFields(p.run)},currentDocument:{exists:false}}]});if(seed.status!==200||typeof seed.data?.writeResults?.[0]?.updateTime!=='string')fail();state.fixtureVersions[names[0]]=seed.data.writeResults[0].updateTime;record({phase:'SEED_CONFIRMED'});
  for(const[target,c]of [[p.access,p.accessCondition]]){alive();attempted.push([target,c]);state.attempted.push(c.title);record({phase:'BINDING_ATTEMPTED',binding:c.title});await setBinding(http,target,c,false);}
  for(let i=0;i<7;i++){alive();const r=await http.request('POST','https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/'+ACCOUNT+':generateAccessToken',{scope:['https://www.googleapis.com/auth/cloud-platform'],lifetime:'600s'});if(r.status===200){const expiry=Date.parse(r.data?.expireTime);accessToken=r.data?.accessToken;if(typeof accessToken!=='string'||!/^[A-Za-z0-9._~+/-]{20,8192}={0,2}$/.test(accessToken)||!Number.isFinite(expiry)||expiry<=now()+30000||expiry>now()+630000)fail();break;}if(i===6||![0,403,429,500,503].includes(r.status))fail();await wait(20000);}
  handle=sdk(accessToken);await assertDisabled(http,p);
  for(const kind of ['get','query']){const outcome=await sdkProbe(kind);emit(kind==='get'?'BASELINE_GET':'BASELINE_QUERY',outcome);if(outcome!=='DENIED')fail();}
  attempted.push([p.reader,p.positive]);state.attempted.push(p.positive.title);record({phase:'POSITIVE_BINDING_ATTEMPTED'});await setBinding(http,p.reader,p.positive,false);
  for(const kind of ['get','query']){let outcome;for(let i=0;i<7;i++){alive();outcome=await sdkProbe(kind);if(outcome==='ALLOWED_EXACT_FIXTURE')break;if(outcome!=='DENIED'||i===6)fail();await wait(20000);}emit(kind==='get'?'NAMED_GET':'NAMED_QUERY',outcome);}
  // Fixed synthetic fixture only. These probes never target operational documents.
  for(const kind of ['CREATE','UPDATE','DELETE']){alive();const write=kind==='DELETE'?{delete:names[0],currentDocument:{updateTime:state.fixtureVersions[names[0]]}}:{update:{name:kind==='CREATE'?names[1]:names[0],fields:fixtureFields(p.run)},currentDocument:kind==='CREATE'?{exists:false}:{updateTime:state.fixtureVersions[names[0]]}};
   const r=await http.request('POST',API+DATABASE+'/documents:commit',{writes:[write]},{token:accessToken,read:true});if(r.status===200){if(kind==='DELETE')delete state.fixtureVersions[names[0]];else if(typeof r.data?.writeResults?.[0]?.updateTime==='string')state.fixtureVersions[kind==='CREATE'?names[1]:names[0]]=r.data.writeResults[0].updateTime;record({phase:'UNEXPECTED_WRITE_ACCEPTED'});}emit('WRITE_'+kind,r.status===403?'DENIED':'NOT_VERIFIED');if(r.status!==403)fail();}
  const financial=await http.request('GET',API+'projects/pay-0-system/databases/(default)/documents/sentinelIamReadProbes/'+p.run,null,{token:accessToken,read:false});emit('FINANCIAL_GET',financial.status===403?'DENIED':'NOT_VERIFIED');if(financial.status!==403)fail();
  alive();await setBinding(http,p.reader,p.positive,true);attempted.push([p.reader,p.negative]);state.attempted.push(p.negative.title);record({phase:'NEGATIVE_BINDING_ATTEMPTED'});await setBinding(http,p.reader,p.negative,false);
  for(const kind of ['get','query']){let denied=false;for(let i=0;i<7;i++){alive();const outcome=await sdkProbe(kind);if(outcome==='DENIED'){denied=true;break;}if(outcome!=='ALLOWED_EXACT_FIXTURE'||i===6)fail();await wait(20000);}if(!denied)fail();emit(kind==='get'?'MISMATCH_GET':'MISMATCH_QUERY','DENIED');}
  await assertDisabled(http,p);const finalIdentity=await http.request('GET',SA);if(finalIdentity.status!==200||finalIdentity.data?.uniqueId!==state.accountUniqueId)fail();passed=true;
 }catch{emit('GATE','NOT_VERIFIED');}
 finally{
  http.beginCleanup();
  if(handle)try{await handle.close();}catch{clean=false;}accessToken=null;
  // Reader positive/negative both belong to this run. Never restore an entire policy snapshot.
  for(const[target,c]of [...attempted].reverse()){try{await setBinding(http,target,c,true);emit('BINDING_CLEANUP','REMOVED_VERIFIED');}catch{clean=false;emit('BINDING_CLEANUP','UNVERIFIED');}}
  if(seeded)for(const name of names){try{await cleanupFixture(http,name,p.run,state.fixtureVersions[name]);emit('FIXTURE_CLEANUP','REMOVED_VERIFIED');}catch{clean=false;emit('FIXTURE_CLEANUP','UNVERIFIED');}}
  record({phase:clean?'CLEANUP_VERIFIED':'CLEANUP_UNVERIFIED',passed:passed&&clean});
 }
 return{passed:passed&&clean,cleanupVerified:clean,statuses,productionActivation:false};
}
export async function recover(saved,{http,journal=()=>{}}){
 const p=saved?.plan;if(!p||JSON.stringify(plan(p.run,p.startMs,p.operatorEmail,p.revision))!==JSON.stringify(p)||!Array.isArray(saved.attempted)||saved.attempted.length>3||typeof saved.seedAttempted!=='boolean'||!saved.fixtureVersions||Array.isArray(saved.fixtureVersions)||typeof saved.fixtureVersions!=='object')fail();
 const tuples=[[p.access,p.accessCondition],[p.reader,p.positive],[p.reader,p.negative]],names=[fixtureName(p.run),fixtureName(p.run)+'-write'];
 if(new Set(saved.attempted).size!==saved.attempted.length||saved.attempted.some(t=>!tuples.some(([,c])=>c.title===t))||Object.entries(saved.fixtureVersions).some(([n,t])=>!names.includes(n)||typeof t!=='string'||!/^\d{4}-\d\d-\d\dT/.test(t)))fail();
 http.beginCleanup();let clean=true;const statuses=[];
 for(const title of [...saved.attempted].reverse()){const[t,c]=tuples.find(([,c])=>c.title===title);try{await setBinding(http,t,c,true);statuses.push({stage:'BINDING_CLEANUP',status:'REMOVED_VERIFIED'});}catch{clean=false;statuses.push({stage:'BINDING_CLEANUP',status:'UNVERIFIED'});}}
 if(saved.seedAttempted)for(const name of names){try{await cleanupFixture(http,name,p.run,saved.fixtureVersions[name]);statuses.push({stage:'FIXTURE_CLEANUP',status:'REMOVED_VERIFIED'});}catch{clean=false;statuses.push({stage:'FIXTURE_CLEANUP',status:'UNVERIFIED'});}}
 journal({...saved,phase:clean?'CLEANUP_VERIFIED':'CLEANUP_UNVERIFIED',passed:false});return{passed:false,cleanupVerified:clean,statuses,mode:'CLEANUP_ONLY',productionActivation:false};
}
export async function main(args){
 if(!args.length){console.log(JSON.stringify({mode:'DRY_RUN_NO_NETWORK',cloudActions:0}));return;}
 const opts={};let execute=false;for(let i=0;i<args.length;i++){if(args[i]==='--execute'&&!execute){execute=true;continue;}if(!['--operator-email','--expected-revision','--cleanup-journal'].includes(args[i])||opts[args[i]]||!args[i+1])fail();opts[args[i]]=args[++i];}if(!execute)fail();
 for(const key of ['FIRESTORE_EMULATOR_HOST','GOOGLE_APPLICATION_CREDENTIALS','GOOGLE_CLOUD_UNIVERSE_DOMAIN','CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT','CLOUDSDK_AUTH_ACCESS_TOKEN','GOOGLE_SDK_NODE_LOGGING','GRPC_TRACE','GRPC_VERBOSITY'])if(process.env[key])fail();
 // Operator credential supplied through stdin by reviewed caller, never argv/env/file/tokeninfo.
 let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>8192)fail();}let token=input.trim();input='';if(!/^[A-Za-z0-9._~+/-]{20,8192}={0,2}$/.test(token))fail();
 const base=path.resolve('.firebase/sentinel-producer-iam');fs.mkdirSync(base,{recursive:true});if(fs.realpathSync(base)!==base)fail();let saved=null;if(opts['--cleanup-journal']){const file=path.resolve(opts['--cleanup-journal']);if(path.dirname(file)!==base||!/^([a-f0-9]{32})\.json$/.test(path.basename(file))||fs.realpathSync(file)!==file||fs.statSync(file).size>262144)fail();saved=JSON.parse(fs.readFileSync(file,'utf8'));if(saved.plan?.run!==path.basename(file,'.json')||saved.plan?.operatorEmail!==opts['--operator-email']?.toLowerCase())fail();}
 const p=saved?.plan||plan(randomUUID().replaceAll('-',''),Date.now(),opts['--operator-email'],opts['--expected-revision']);const lock=path.join(base,'verification.lock'),fd=fs.openSync(lock,'wx',0o600);process.env.DEBUG='';const file=path.join(base,p.run+'.json');
 try{const prior=fs.readdirSync(base).filter(n=>n.endsWith('.json'));for(const name of prior){const row=JSON.parse(fs.readFileSync(path.join(base,name),'utf8'));if(row.phase!=='CLEANUP_VERIFIED'&&(!saved||name!==p.run+'.json'))fail();}
  const journal=state=>{const temporary=file+'.pending';const out=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(out,JSON.stringify({plan:p,...state}));fs.fsyncSync(out);}finally{fs.closeSync(out);}fs.renameSync(temporary,file);};if(!saved)journal({phase:'PREPARED',fixtureVersions:{},attempted:[],seedAttempted:false});
  const http=createHttp({operatorToken:token});const result=saved?await recover(saved,{http,journal}):await verify(p,{http,journal});console.log(JSON.stringify(result));if(saved?!result.cleanupVerified:!result.passed)process.exitCode=1;
 }finally{token=null;fs.closeSync(fd);fs.unlinkSync(lock);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(()=>{console.error(JSON.stringify({error:'IAM_GATE_REFUSED',detailsRedacted:true,productionActivation:false}));process.exitCode=1;});
