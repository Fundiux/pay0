import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// Inert until a reviewed launcher supplies pinned CLI modules and exact inputs.
export function installVerifiedUpload({ packer, deploy, storage, v2, sourceRoot, privateTemp, project, region, endpoint, approvedEndpointIds, expectedEndpointCount = 347, approvedUploadHost, ignore, verifyBytes, emit = () => {} }) {
  const root=fs.realpathSync(sourceRoot), temp=fs.realpathSync(privateTemp);
  assert.ok(temp.startsWith(path.dirname(root)+path.sep),'TEMP_PROJECT_SCOPE');
  for(const fn of [packer.prepareFunctionsUpload,deploy.createReadStream,storage.upload,v2.generateUploadUrl,verifyBytes])assert.equal(typeof fn,'function','UPLOAD_CONTRACT');
  assert.ok(Number.isSafeInteger(expectedEndpointCount)&&expectedEndpointCount>0,'MANIFEST_ENDPOINT_COUNT');
  const validId=value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_-]*$/.test(value);
  assert.ok(validId(endpoint),'MANIFEST_SELECTED_ENDPOINT');
  assert.ok(Array.isArray(approvedEndpointIds)&&Object.getPrototypeOf(approvedEndpointIds)===Array.prototype&&
    approvedEndpointIds.length===expectedEndpointCount&&Reflect.ownKeys(approvedEndpointIds).length===expectedEndpointCount+1,'MANIFEST_ENDPOINTS_PIN');
  const pinnedIds=[];
  for(let i=0;i<expectedEndpointCount;i++){
    const descriptor=Object.getOwnPropertyDescriptor(approvedEndpointIds,String(i));
    assert.ok(descriptor&&Object.hasOwn(descriptor,'value')&&validId(descriptor.value),'MANIFEST_ENDPOINTS_PIN');
    pinnedIds.push(descriptor.value);
  }
  assert.ok(new Set(pinnedIds).size===expectedEndpointCount&&pinnedIds.includes(endpoint),'MANIFEST_ENDPOINTS_PIN');
  Object.freeze(pinnedIds);
  assert.ok(typeof approvedUploadHost==='string'&&approvedUploadHost.endsWith('.googleapis.com'),'UPLOAD_HOST_PIN');
  const pack=packer.prepareFunctionsUpload, upload=storage.upload, generate=v2.generateUploadUrl;
  let packing=false, packed=null, buffer=null, stream=null, streamed=false, generated=false, dispatched=false, completed=false, destination=null, uploadedGeneration=null;
  const deny=()=>{throw Error('UPLOAD_SCOPE_BLOCKED');};
  packer.prepareFunctionsUpload=async function(projectDir,sourceDir,config,schemas,runtimeConfig){
    assert.ok(!packing,'PACK_REPLAY'); packing=true;
    assert.equal(fs.realpathSync(sourceDir),root,'SOURCE_SCOPE');
    assert.equal(fs.realpathSync(projectDir),path.dirname(root),'PROJECT_SCOPE');
    assert.deepEqual(config.ignore,ignore,'IGNORE_DRIFT');
    assert.deepEqual(schemas,[],'SCHEMA_SCOPE'); assert.equal(runtimeConfig,undefined,'RUNTIME_CONFIG_SCOPE');
    const result=await pack.call(this,projectDir,sourceDir,config,schemas,runtimeConfig);
    const file=fs.realpathSync(result.pathToSource);
    assert.ok(file.startsWith(temp+path.sep),'ZIP_PRIVATE_SCOPE');
    assert.ok(fs.statSync(file).size<=100*1024*1024,'ZIP_SIZE');
    buffer=fs.readFileSync(file); assert.ok(buffer.length<=100*1024*1024,'ZIP_SIZE');
    const proof=await verifyBytes(buffer);
    assert.equal(proof.exactFileSet,true,'ZIP_NOT_EXACT');assert.equal(proof.archiveSha256,hash(buffer),'ZIP_PROOF');
    packed={file,archiveSha256:proof.archiveSha256,archiveFiles:proof.archiveFiles};
    emit('ZIP_VERIFIED',{archiveSha256:packed.archiveSha256,archiveFiles:packed.archiveFiles});
    return result;
  };
  deploy.createReadStream=function(file){
    assert.ok(packed&&!streamed,'STREAM_ORDER_OR_REPLAY');streamed=true;
    assert.equal(fs.realpathSync(file),packed.file,'ZIP_PATH');
    assert.equal(hash(fs.readFileSync(file)),packed.archiveSha256,'ZIP_DRIFT');
    stream=Readable.from(buffer);return stream;
  };
  v2.generateUploadUrl=async function(p,r){
    assert.ok(streamed&&!generated,'UPLOAD_URL_ORDER_OR_REPLAY');generated=true;
    assert.equal(p,project,'UPLOAD_PROJECT');assert.equal(r,region,'UPLOAD_REGION');
    const result=await generate.call(this,p,r);
    const s=result.storageSource;
    assert.ok(s&&typeof s.bucket==='string'&&s.bucket.length&&typeof s.object==='string'&&s.object.length,'UPLOAD_SOURCE');
    if(s.generation!==undefined){assert.ok(typeof s.generation==='string'||Number.isSafeInteger(s.generation),'UPLOAD_GENERATION');assert.match(String(s.generation),/^(?:0|[1-9][0-9]*)$/,'UPLOAD_GENERATION');}
    assert.equal(typeof result.uploadUrl,'string','UPLOAD_URL');
    const url=new URL(result.uploadUrl);
    assert.equal(url.protocol,'https:','UPLOAD_URL_PROTOCOL');assert.equal(url.hostname,approvedUploadHost,'UPLOAD_URL_HOST');
    assert.ok(!url.username&&!url.password&&!url.hash&&!url.port,'UPLOAD_URL_COMPONENTS');
    for(const key of ['GoogleAccessId','Expires','Signature'])assert.ok(url.searchParams.get(key),'UPLOAD_URL_SIGNATURE');
    destination={url:result.uploadUrl,storageSource:s};return result;
  };
  storage.upload=async function(source,url,headers,ignoreQuota){
    assert.ok(destination&&!dispatched,'UPLOAD_ORDER_OR_REPLAY');dispatched=true;
    assert.equal(source.file,packed.file,'UPLOAD_PATH');assert.equal(source.stream,stream,'UPLOAD_STREAM');
    assert.equal(url,destination.url,'UPLOAD_DESTINATION');assert.equal(headers,undefined,'UPLOAD_HEADERS');assert.equal(ignoreQuota,true,'UPLOAD_QUOTA');
    // The already verified buffer is the body. Disk changes cannot replace it.
    const result=await upload.call(this,source,url,headers,ignoreQuota);
    assert.match(String(result?.generation||''),/^[1-9][0-9]*$/,'UPLOADED_GENERATION');
    uploadedGeneration=String(result.generation);
    if(destination.storageSource.generation!==undefined&&String(destination.storageSource.generation)!=='0')assert.equal(String(destination.storageSource.generation),uploadedGeneration,'GENERATION_MISMATCH');
    destination.storageSource.generation=uploadedGeneration;
    completed=true;emit('ZIP_UPLOADED',{archiveSha256:packed.archiveSha256,archiveFiles:packed.archiveFiles,storageSource:destination.storageSource,uploadedGeneration});
    buffer=null;return result;
  };
  // v1/object transports are outside this single v2 source-upload contract.
  for(const key of ['uploadObject','upsertBucket'])if(typeof storage[key]==='function')storage[key]=deny;
  function assertBackend(backend){
    const rows=Object.values(backend.endpoints||{}).flatMap(x=>Object.values(x));
    assert.deepEqual(rows.map(row=>row.id).sort(),[...pinnedIds].sort(),'UPLOAD_MANIFEST_IDS');
    for(const row of rows){assert.equal(row.project,project,'UPLOAD_PROJECT');assert.equal(row.region,region,'UPLOAD_REGION');assert.equal(row.platform,'gcfv2','UPLOAD_PLATFORM');assert.equal(row.targetedByOnly,row.id===endpoint,'UPLOAD_TARGETING');}
  }
  const direct=deploy.uploadSourceV2, dispatch=deploy.deploy;
  assert.equal(typeof direct,'function','UPLOAD_CONTRACT');assert.equal(typeof dispatch,'function','UPLOAD_CONTRACT');
  deploy.uploadSourceV2=async function(p,n,source,backend){assertBackend(backend);return direct.call(this,p,n,source,backend);};
  function assertEmptyExtensions(owner){
    if (!('extensions' in owner)) return;
    const descriptor=Object.getOwnPropertyDescriptor(owner,'extensions');
    assert.ok(descriptor&&Object.hasOwn(descriptor,'value'),'UPLOAD_EXTENSIONS');
    const value=descriptor.value;
    assert.ok(value!==null&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).length===0,'UPLOAD_EXTENSIONS');
  }
  deploy.deploy=async function(context,options,payload){
    assertEmptyExtensions(payload);assertEmptyExtensions(context);
    assert.equal(options.nonInteractive,true,'UPLOAD_NONINTERACTIVE');
    assert.equal(context.projectId,project,'UPLOAD_PROJECT');
    assert.deepEqual(context.filters,[{codebase:'default',idChunks:[endpoint]}],'UPLOAD_FILTERS');
    const entries=Object.entries(payload.functions||{});assert.equal(entries.length,1,'UPLOAD_CODEBASE_COUNT');
    assert.equal(entries[0][0],'default','UPLOAD_CODEBASE');assertBackend(entries[0][1].wantBackend);
    return dispatch.call(this,context,options,payload);
  };
  return { receipt(){assert.ok(completed,'UPLOAD_INCOMPLETE');return structuredClone({archiveSha256:packed.archiveSha256,archiveFiles:packed.archiveFiles,storageSource:destination.storageSource,uploadedGeneration});} };
}
