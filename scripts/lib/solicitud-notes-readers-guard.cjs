'use strict';
// Own-process lifecycle adapter. Imported inertly; installation is explicit.
const assert=require('node:assert/strict');
const {CREATE,UPDATE,PARENT}=require('./solicitud-notes-release-contract.cjs');
function install({endpointId,Fabricator,v1,v2,run,poller,Client,storage,makeContract,beforeMutation,uploadReceipt,emit}){
 assert([CREATE,UPDATE].includes(endpointId),'ENDPOINT_SCOPE');for(const fn of [makeContract,beforeMutation,uploadReceipt,emit])assert.equal(typeof fn,'function','REQUIRED_PORT');
 const originals={apply:Fabricator.prototype.applyPlan,convert:v2.functionFromEndpoint,create:v2.createFunction,update:v2.updateFunction,poll:poller.pollOperation,invoke:run.setInvokerCreate,post:Client.prototype.post,patch:Client.prototype.patch,delete:Client.prototype.delete,request:Client.prototype.request,upload:storage.upload};
 for(const fn of Object.values(originals))assert.equal(typeof fn,'function','CLI_CONTRACT');
 const resource=`${PARENT}/functions/${endpointId}`,service=`${PARENT}/services/${endpointId.toLowerCase()}`;
 let planned=false,converted=false,reserved=false,sent=false,operation=null,completed=null,iamSent=false,contract=null;
 const fail=()=>{throw Error('READERS_MUTATION_SCOPE_BLOCKED');};
 let permit=null,uploadPermit=null,pollReserved=false;
 const client=(value,origin,version,auth=true)=>{assert.equal(value.opts?.urlPrefix,origin,'CLIENT_ORIGIN');assert.equal(value.opts?.apiVersion,version,'CLIENT_VERSION');assert.equal(value.opts?.auth,auth,'CLIENT_AUTH');};
 const dispatch=(self,method,target,body,options)=>{
  assert(!permit,'TRANSPORT_REENTRY');
  const expected={...(options||{}),method,path:target,body};
  assert(!('redirect' in expected)&&!('retries' in expected),'TRANSPORT_OPTIONS');
  const ticket={self,expected,used:false};permit=ticket;
  try{const result=originals[method==='POST'?'post':'patch'].call(self,target,body,options);assert(ticket.used,'TRANSPORT_NOT_CONSUMED');return result;}finally{permit=null;}
 };
 Client.prototype.request=function(options){
  if(options?.method==='GET')return originals.request.call(this,options);
  if(permit){const ticket=permit;permit=null;assert.equal(this,ticket.self,'TRANSPORT_CLIENT');assert.deepEqual(options,ticket.expected,'TRANSPORT_REQUEST');ticket.used=true;}
  else if(uploadPermit){const ticket=uploadPermit;uploadPermit=null;client(this,'https://storage.googleapis.com',undefined,false);assert.deepEqual({...options,body:undefined,queryParams:undefined},ticket.expected,'UPLOAD_REQUEST');assert.equal(options.body,ticket.stream,'UPLOAD_BODY');assert(options.queryParams instanceof URLSearchParams,'UPLOAD_QUERY_TYPE');assert.equal(options.queryParams.toString(),ticket.query,'UPLOAD_QUERY');ticket.used=true;}
  else return fail();
  return originals.request.call(this,{...options,redirect:'manual',retries:0});
 };
 // Install this inner transport wrapper before the verified-upload wrapper.
 // It cannot authorize another request while the original upload is awaiting I/O.
 storage.upload=function(source,url,headers,ignoreQuota){
  assert(!uploadPermit,'UPLOAD_REENTRY');const u=new URL(url);assert.equal(u.origin,'https://storage.googleapis.com','UPLOAD_ORIGIN');assert(!u.username&&!u.password&&!u.hash,'UPLOAD_URL');assert.equal(headers,undefined,'UPLOAD_HEADERS');assert.equal(ignoreQuota,true,'UPLOAD_QUOTA');
  const ticket={stream:source.stream,query:u.searchParams.toString(),used:false,expected:{method:'PUT',path:u.pathname,queryParams:undefined,responseType:'xml',headers:{'content-type':'application/zip'},body:undefined,skipLog:{resBody:true},ignoreQuotaProject:true}};uploadPermit=ticket;
  try{const result=originals.upload.call(this,source,url,headers,ignoreQuota);assert(ticket.used,'UPLOAD_NOT_CONSUMED');return result;}finally{uploadPermit=null;}
 };
 for(const owner of [v1,v2])for(const name of ['deleteFunction'])owner[name]=fail;
 v1.createFunction=v1.updateFunction=fail;
 for(const name of ['updateService','replaceService','setInvokerUpdate'])run[name]=fail;
 Fabricator.prototype.applyPlan=async function(plan){assert(!planned,'PLAN_REPLAY');contract=makeContract(uploadReceipt());contract.assertPlan(plan);planned=true;emit('PLAN_'+(endpointId===CREATE?'CREATE':'UPDATE')+'_ONLY');return originals.apply.call(this,plan);};
 v2.functionFromEndpoint=function(endpoint){assert(planned&&!converted,'CONVERSION_ORDER');converted=true;const preserved=contract.prepareEndpoint(endpoint);return originals.convert.call(this,preserved);};
 for(const [name,method] of [['createFunction','POST'],['updateFunction','PATCH']])v2[name]=async function(body){assert((endpointId===CREATE)===(method==='POST'),'ACTION_SCOPE');assert(planned&&converted&&!reserved,'MUTATION_REPLAY');reserved=true;const fresh=await beforeMutation();contract.assertFreshBaseline(fresh.baseline);if(endpointId===CREATE)contract.assertFreshAbsence(fresh.absence);assert.deepEqual(body.buildConfig?.source?.storageSource,uploadReceipt().storageSource,'UPLOAD_SOURCE_CHANGED');emit('FRESH_VERIFIED');emit('FUNCTION_DISPATCHED');const result=await originals[method==='POST'?'create':'update'].call(this,body);assert.match(result?.name||'',/^projects\/(pay-0-system|751158244178)\/locations\/us-central1\/operations\/[^/]+$/,'OPERATION_SCOPE');operation=result.name;emit('FUNCTION_ACCEPTED',{operation});return result;};
 Client.prototype.post=async function(target,body,options){
  if(target===`${PARENT}/functions:generateUploadUrl`){client(this,'https://cloudfunctions.googleapis.com','v2');assert.equal(body,undefined,'UPLOAD_BODY');assert.equal(options,undefined,'UPLOAD_OPTIONS');assert(!planned&&!reserved,'UPLOAD_PHASE');return dispatch(this,'POST',target,body,options);}
  if(target===`${PARENT}/functions`){client(this,'https://cloudfunctions.googleapis.com','v2');assert(endpointId===CREATE&&reserved&&!sent,'CREATE_TRANSPORT_ORDER');sent=true;contract.assertRequest('POST',target,body,options);return dispatch(this,'POST',target,body,options);}
  if(target===service+':setIamPolicy'){client(this,'https://run.googleapis.com','v1');assert(endpointId===CREATE&&completed&&!iamSent,'IAM_ORDER');assert.deepEqual(Object.keys(body).sort(),['policy','updateMask'],'IAM_BODY');contract.assertIamWrite(service,body.policy);assert.equal(body.updateMask,'bindings,etag,version','IAM_MASK');assert(options===undefined,'IAM_OPTIONS');iamSent=true;const result=await dispatch(this,'POST',target,body,options);emit('IAM_CREATED');return result;}
  // The only additional POST is a read-only permission probe on this project.
  if(target==='/projects/pay-0-system:testIamPermissions'){client(this,'https://cloudresourcemanager.googleapis.com','v1');assert.deepEqual(options,{headers:{'x-goog-quota-user':'projects/pay-0-system'}},'IAM_PROBE_OPTIONS');assert(body&&Array.isArray(body.permissions)&&Object.keys(body).length===1&&body.permissions.length<=100,'IAM_PROBE');return dispatch(this,'POST',target,body,options);}
  return fail();
 };
 Client.prototype.patch=async function(target,body,options){client(this,'https://cloudfunctions.googleapis.com','v2');assert(endpointId===UPDATE&&target===resource&&reserved&&!sent,'UPDATE_TRANSPORT_ORDER');sent=true;contract.assertRequest('PATCH',target,body,options);return dispatch(this,'PATCH',target,body,options);};
 Client.prototype.delete=Client.prototype.put=fail;
 run.setIamPolicy=fail; // setInvokerCreate's private lexical setter is guarded at POST.
 run.setInvokerCreate=async function(project,target,invokers,...extra){assert(endpointId===CREATE&&completed&&!iamSent&&project==='pay-0-system'&&target===service,'IAM_CALL_SCOPE');assert.deepEqual(invokers,['public'],'IAM_PUBLIC_ONLY');assert.equal(extra.length,0,'IAM_CLIENT_OVERRIDE');return originals.invoke.call(this,project,target,invokers);};
 poller.pollOperation=async function(options){assert(operation&&options.operationResourceName===operation&&!completed&&!pollReserved,'POLL_OPERATION_SCOPE');assert.equal(options.apiOrigin,'https://cloudfunctions.googleapis.com','POLL_ORIGIN');assert.equal(options.apiVersion,'v2','POLL_VERSION');assert.equal(options.masterTimeout,25*60*1000,'POLL_TIMEOUT');assert.equal(options.maxBackoff,10000,'POLL_BACKOFF');assert.equal(options.pollerName,`${endpointId===CREATE?'create':'update'}-default-us-central1-${endpointId}`,'POLL_NAME');pollReserved=true;const result=await originals.poll.call(this,options);assert(result?.name===resource&&result.state==='ACTIVE'&&result.serviceConfig?.service===service,'COMPLETED_SCOPE');assert.match(result.serviceConfig.revision||'',new RegExp('^'+endpointId.toLowerCase()+'-[a-z0-9-]+$'),'COMPLETED_REVISION');const source=result.buildConfig?.source?.storageSource;assert(source?.bucket==='gcf-v2-sources-751158244178-us-central1'&&source.object===endpointId+'/function-source.zip','COMPLETED_SOURCE_SCOPE');assert.match(source.generation||'',/^[1-9][0-9]*$/,'COMPLETED_GENERATION');completed={operation,revision:result.serviceConfig.revision,source:structuredClone(source)};emit('FUNCTION_COMPLETED',completed);return result;};
 emit('GUARD_ACTIVE');return Object.freeze({status:()=>({planned,converted,reserved,sent,operation,completed:structuredClone(completed),iamSent})});
}
module.exports={install};
