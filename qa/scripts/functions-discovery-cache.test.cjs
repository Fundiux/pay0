'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('../../functions/node_modules/typescript');
const source=fs.readFileSync(path.resolve(__dirname,'../../functions/src/discoveryCompileCache.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017}}).outputText;
function run(env,status=1){
 const loads=[],calls=[];
 vm.runInNewContext(compiled,{exports:{},process:{env,versions:{node:'22.23.2'}},require:name=>{
  loads.push(name);
  if(name==='node:module')return {enableCompileCache:directory=>{calls.push(directory);return {status};}};
  if(name==='node:path')return path;
  if(name==='node:os')return {tmpdir:()=>path.resolve('synthetic-temp')};
  throw Error('UNEXPECTED_IMPORT');
 }});
 return {loads,calls};
}
test('runtime and explicit opt-out never initialize the discovery cache',()=>{
 for(const env of [{},{FUNCTIONS_CONTROL_API:'false'},{FUNCTIONS_CONTROL_API:'TRUE'},{FUNCTIONS_CONTROL_API:'true',NODE_DISABLE_COMPILE_CACHE:'1'}])assert.deepEqual(run(env),{loads:[],calls:[]});
});
test('discovery uses existing exact Node-version cache and tolerates optimization misses',()=>{
 for(const status of [0,1,2,3]){
  const actual=run({FUNCTIONS_CONTROL_API:'true'},status);
  assert.deepEqual(actual.loads,['node:module','node:path','node:os']);
  assert.deepEqual(actual.calls,[path.resolve('synthetic-temp/pay0-functions-discovery-node-22.23.2')]);
 }
});
test('CJS index enables discovery cache before importing business modules',()=>{
 const index=fs.readFileSync(path.resolve(__dirname,'../../functions/src/index.ts'),'utf8');
 const emitted=ts.transpileModule(index,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017}}).outputText;
 assert.equal(/require\("([^"]+)"\)/.exec(emitted)[1],'./discoveryCompileCache');
});
