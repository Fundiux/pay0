const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const {findSourceMap}=require('node:module');
assert(process.execArgv.includes('--enable-source-maps'),'SOURCE_MAP_FLAG_REQUIRED');
const artifact=path.resolve(process.argv[2]||'');assert(process.argv[2],'ARTIFACT_REQUIRED');
const filename=path.join(artifact,'lib/index.js');
const provenance=JSON.parse(fs.readFileSync(path.resolve(artifact,'../provenance.json'),'utf8'));
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'),provenance.outputs.find(x=>x.file==='lib/index.js').sha256);
process.env.GCLOUD_PROJECT='demo-pay0-bundle-map';
process.env.FIREBASE_CONFIG=JSON.stringify({projectId:'demo-pay0-bundle-map'});
global.fetch=async()=>{throw Error('NETWORK_FORBIDDEN');};
const api=require(filename);
(async()=>{
 assert(findSourceMap(filename),'NODE_SOURCE_MAP_NOT_REGISTERED');
 // This handler rejects missing auth synchronously before its first DB read.
 await assert.rejects(()=>api.listUsers.run({auth:null,data:{}}),error=>{
  assert.equal(error.code,'unauthenticated');
  assert.match(error.stack,/[\\/]\.debug[\\/]compiled[\\/]modules[\\/]users[\\/]list\.js:\d+/);
  return true;
 });
 console.log(JSON.stringify({sourceMapRegistered:true,mappedAuthorizationStack:true,remoteCalls:0}));
})().catch(error=>{console.error(JSON.stringify({result:'FAILED',code:error.code||'ASSERTION'}));process.exitCode=1;});
