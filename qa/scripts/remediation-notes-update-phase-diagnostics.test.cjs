const test=require('node:test'),assert=require('node:assert/strict');
const {instrument,code}=require('../../scripts/lib/notes-update-phase-diagnostics.cjs');
test('async boundaries preserve receiver, argument and result identity',async()=>{
 const rows=[],input={},result={},owner={async run(value){assert.equal(this,owner);assert.equal(value,input);return result;}};
 instrument(owner,'run','PREPARE',row=>rows.push(row));assert.equal(await owner.run(input),result);
 assert.deepEqual(rows,[{stage:'PREPARE',state:'ENTER'},{stage:'PREPARE',state:'RETURN'}]);
});
test('known assertion projection omits diff and rethrows original error',async()=>{
 const rows=[],error=Error('UPLOAD_EXTENSIONS\nprivate payload secret'),owner={async run(){throw error;}};
 instrument(owner,'run','DEPLOY',row=>rows.push(row));await assert.rejects(owner.run(),e=>e===error);
 assert.deepEqual(rows.at(-1),{stage:'DEPLOY',state:'FAILED',code:'UPLOAD_EXTENSIONS'});
 assert.doesNotMatch(JSON.stringify(rows),/secret|private/);
});
test('unknown exceptions and accessors never expose or read message',()=>{
 let calls=0;const error=Object.defineProperty({},'message',{get(){calls++;throw Error('secret');}});
 assert.equal(code(error),'UNCLASSIFIED');assert.equal(calls,0);
 for(const value of [null,'secret',Error('Bearer secret'),{message:'UPLOAD_EXTENSIONS secret'}])assert.equal(code(value),'UNCLASSIFIED');
});
test('synchronous stream identity and throw semantics remain synchronous',()=>{
 const rows=[],result={},owner={run(){return result;}};instrument(owner,'run','STREAM',r=>rows.push(r),{sync:true});assert.equal(owner.run(),result);
 const error=Error('ZIP_DRIFT'),bad={run(){throw error;}};instrument(bad,'run','STREAM',r=>rows.push(r),{sync:true});assert.throws(()=>bad.run(),e=>e===error);
 assert.deepEqual(rows.at(-1),{stage:'STREAM',state:'FAILED',code:'ZIP_DRIFT'});
});
test('unknown stages and missing functions fail before replacement',()=>{
 const fn=()=>{},owner={run:fn};assert.throws(()=>instrument(owner,'run','SECRET',()=>{}),/DIAGNOSTIC_STAGE/);assert.equal(owner.run,fn);
 assert.throws(()=>instrument({},'run','DEPLOY',()=>{}),/DIAGNOSTIC_CONTRACT/);
});
test('malformed proxy and unavailable diagnostic sink preserve operation outcome',async()=>{
 const proxy=new Proxy({},{getOwnPropertyDescriptor(){throw Error('private');}});
 assert.equal(code(proxy),'UNCLASSIFIED');
 const original=Error('original'),owner={async run(){throw original;}},result={};
 const success={async run(){return result;}};
 const old=process.stderr.write;const warnings=[];process.stderr.write=value=>{warnings.push(value);return true;};
 try {
  const sink=()=>{throw Error('private sink failure');};
  instrument(owner,'run','DEPLOY',sink);await assert.rejects(owner.run(),e=>e===original);
  instrument(success,'run','DEPLOY',sink);assert.equal(await success.run(),result);
  assert.equal(warnings.length,4);assert(warnings.every(x=>x==='NOTES_UPDATE_DIAGNOSTIC_UNAVAILABLE\n'));
 }finally{process.stderr.write=old;}
});

test('installed CLI index getters forward writable concrete owners without network calls',()=>{
 const path=require('node:path'),fs=require('node:fs');
 const cli=path.join(process.env.APPDATA,'npm/node_modules/firebase-tools');
 assert.equal(JSON.parse(fs.readFileSync(path.join(cli,'package.json'))).version,'15.3.1');
 const savedNetwork=[];
 for(const [owner,key]of [[require('node:net').Socket.prototype,'connect'],[require('node:http'),'request'],[require('node:https'),'request'],[globalThis,'fetch']]){
  savedNetwork.push([owner,key,owner[key]]);owner[key]=()=>{throw Error('NETWORK_FORBIDDEN');};
 }
 const restored=[];
 try{
  const index=require(path.join(cli,'lib/deploy/functions/index.js'));
  for(const [key,file,stage]of [['prepare','lib/deploy/functions/prepare.js','PREPARE'],['deploy','lib/deploy/functions/deploy.js','DEPLOY'],['release','lib/deploy/functions/release/index.js','RELEASE']]){
   const descriptor=Object.getOwnPropertyDescriptor(index,key);
   assert.equal(typeof descriptor.get,'function');assert.equal(descriptor.set,undefined);
   const owner=require(path.join(cli,file)),original=owner[key];restored.push([owner,key,original]);
   assert.equal(Object.getOwnPropertyDescriptor(owner,key).writable,true);
   const rows=[];instrument(owner,key,stage,row=>rows.push(row));
   assert.notEqual(owner[key],original);assert.equal(index[key],owner[key]);
   assert.deepEqual(Object.getOwnPropertyDescriptor(index,key),descriptor);
   assert.deepEqual(rows,[]); // No underlying CLI operation was invoked.
  }
 }finally{
  for(const [owner,key,original]of restored)owner[key]=original;
  for(const [owner,key,original]of savedNetwork)owner[key]=original;
 }
});
