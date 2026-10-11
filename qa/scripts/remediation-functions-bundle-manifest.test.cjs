const assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const {discoverOwned,validateCliBuild}=require('./verify-functions-cli-discovery.cjs');
const root=path.resolve(__dirname,'../..');
const cli=path.join(process.env.APPDATA,'npm/node_modules/firebase-tools/lib');
delete process.env.DEBUG;delete process.env.FUNCTIONS_DISCOVERY_TIMEOUT;
process.env.FIREBASE_FUNCTIONS_DISCOVERY_OUTPUT_PATH='true';
const {Delegate}=require(path.join(cli,'deploy/functions/runtimes/node/index.js'));
const sort=x=>Array.isArray(x)?x.map(sort):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;
(async()=>{
 const start=performance.now();
 const build=await discoverOwned(Delegate,['demo-pay0-discovery',root,path.join(root,'functions'),'nodejs22'],{},{GCLOUD_PROJECT:'demo-pay0-discovery',FIREBASE_CONFIG:JSON.stringify({projectId:'demo-pay0-discovery',storageBucket:'demo-pay0-discovery.appspot.com'})});
 const elapsedMs=Math.round(performance.now()-start),endpoints=validateCliBuild(build,elapsedMs);
 const hash=crypto.createHash('sha256').update(JSON.stringify(sort(build))).digest('hex');
 // Full converted CLI build baseline for the unchanged c92f0b7 domain source,
 // including every endpoint option. No manifest/parser replacement is used.
 assert.equal(hash,'9d9bf27f15d47a695fee37d14959d89f0b57af6692ea49534d838dc426967cdb');
 console.log(JSON.stringify({result:'PASS',endpoints,elapsedMs,fullBuildSha256:hash,remoteCalls:0}));
})().catch(()=>{console.error(JSON.stringify({result:'BUNDLE_MANIFEST_FAILED',detailsRedacted:true}));process.exitCode=1;});
