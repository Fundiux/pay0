// Synthetic controller memory gate. No browser/DOM/cloud/production data.
// Explicit opt-in; each scenario runs in a fresh bounded Node process.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from 'typescript';
const here=fileURLToPath(import.meta.url),root=path.resolve(path.dirname(here),'../..');
const cases={unchanged:{count:150,textBytes:192*1024,change:false},changed:{count:150,textBytes:192*1024,change:true},wide:{count:50,textBytes:1048000,change:true}};
const args=process.argv.slice(2),child=args[0]==='--child';
if(!child){
 assert.deepEqual(args,['--run-synthetic'],'Explicit prerequisite: node qa/scripts/remediation-dispersion-notes-memory.mjs --run-synthetic');
 for(const name of Object.keys(cases)){
  const result=spawnSync(process.execPath,['--expose-gc','--max-old-space-size=512',here,'--child',name],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:128*1024,windowsHide:true});
  assert.equal(result.error,undefined,'Child failed or exceeded the local 120 s bound');
  assert.equal(result.status,0,'Synthetic child failed; inspect its local diagnostic');
  const summary=JSON.parse(result.stdout);assert.equal(summary.scenario,name);assert.equal(summary.kind,'NOTES_CONTROLLER_MEMORY');
  console.log(JSON.stringify(summary));
 }
}else{
 assert.equal(args.length,2);assert.ok(Object.hasOwn(cases,args[1]));assert.equal(typeof global.gc,'function');
 global.fetch=async()=>{throw Error('NETWORK_FORBIDDEN');};
 const source=fs.readFileSync(path.join(root,'src/lib/useDispersionNotes.ts'),'utf8'),api={};
 const shared={};
new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(root,'src/lib/paginatedNotesController.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(shared,()=>{throw new Error('Unexpected shared import');});
new Function('exports','require',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(api,name=>{if(name==='@/lib/paginatedNotesController')return shared;assert.ok(['react','@/services/financing'].includes(name));return{};});
 const scenario=cases[args[1]],budget=8*1024*1024;
 let state,now=0,version=1,calls=0,active=0,maxActive=0,sequence=0,maxResponseBytes=0,peakHeap=0,peakRss=0;
 const timers=new Map(),phases=[];
 const measure=()=>{const m=process.memoryUsage();peakHeap=Math.max(peakHeap,m.heapUsed);peakRss=Math.max(peakRss,m.rss);return{heapUsed:m.heapUsed,rss:m.rss};};
 async function phase(name){await new Promise(setImmediate);global.gc();phases.push({name,...measure()});}
 const baseline=measure();
 const flush=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
 let controller=api.createDispersionNotesController({now:()=>now,visible:()=>true,emit:value=>{state=value;measure();},setTimer:(fn,delay)=>{const id=++sequence;timers.set(id,{fn,at:now+delay});return id;},clearTimer:id=>timers.delete(id),fetch:async(cursor,limit=50)=>{
  calls++;active++;maxActive=Math.max(maxActive,active);measure();
  try{
   if(cursor&&cursor.updateSeconds!==version)throw{code:'failed-precondition'};
   const start=cursor?Number(cursor.id.slice(1))+1:0;
   // Conservative synthetic response prefix; count its complete actual envelope below.
   const count=Math.min(limit,scenario.count-start,Math.floor((budget-1024)/(scenario.textBytes+512)));
   const items=Array.from({length:count},(_,offset)=>{const n=start+offset;return{id:'n'+String(n).padStart(4,'0'),updateSeconds:version,updateNanoseconds:n,displayDate:{kind:'STRING',value:'2026-10-10'},text:(String(n)+':'+version+':').padEnd(scenario.textBytes,'x')};});
   const last=items.at(-1),nextCursor=start+count<scenario.count?{version:2,dispersionId:'synthetic',id:last.id,updateSeconds:version,updateNanoseconds:last.updateNanoseconds}:null;
   const wire=JSON.stringify({result:{items,nextCursor}});maxResponseBytes=Math.max(maxResponseBytes,Buffer.byteLength(wire));assert.ok(Buffer.byteLength(wire)<=budget);
   // Force new flat decoded strings per RPC, rather than reusing fake server objects.
   const decoded=JSON.parse(wire).result;measure();return decoded;
  }finally{active--;}
 }});
 async function tick(){assert.ok(timers.size);now=Math.max(...[...timers.values()].map(x=>x.at));for(const[id,t]of [...timers])if(t.at<=now){timers.delete(id);t.fn();}await flush();}
 controller.refresh();await flush();
 for(let step=0;state.notes.length<scenario.count||state.refreshPending;step++){
  assert.ok(step<200,'bounded initial load failed to converge');
  if(state.canLoadOlder){controller.loadOlder();await flush();}else await tick();
 }
 assert.equal(state.notes.length,scenario.count);assert.equal(state.hasMore,false);await phase('loaded');
 const previous=new Map(state.notes.map(row=>[row.id,new WeakRef(row)]));
 if(scenario.change)version++;
 let cycles=0;do{await tick();cycles++;assert.ok(cycles<200,'bounded sweep failed to converge');}while(state.refreshPending);
 assert.equal(state.notes.length,scenario.count);assert.equal(new Set(state.notes.map(x=>x.id)).size,scenario.count);
 let reused=0,replaced=0;for(const row of state.notes){const prior=previous.get(row.id).deref();if(row===prior)reused++;else replaced++;assert.equal(row.updateSeconds,version);}
 assert.equal(scenario.change?replaced:reused,scenario.count,'all unchanged DTO references reused; changed versions replaced');
 await phase('afterRefresh');
 // WeakRef collection is observed only: GC timing is not a correctness assertion.
 let oldStillReachable=0;for(const ref of previous.values())if(ref.deref())oldStillReachable++;
 controller.stop();controller=null;state=null;previous.clear();await phase('stopped');assert.equal(timers.size,0);assert.equal(maxActive,1);
 console.log(JSON.stringify({kind:'NOTES_CONTROLLER_MEMORY',scenario:args[1],platform:process.platform,node:process.version,sourceSha256:createHash('sha256').update(source).digest('hex'),rows:scenario.count,textBytesPerRow:scenario.textBytes,logicalLoadedTextBytes:scenario.count*scenario.textBytes,calls,cycles,reused,replaced,oldStillReachable,maxActive,maxResponseBytes,baseline,peakHeap,peakRss,processMaxRssBytes:process.resourceUsage().maxRSS*1024,phases,browserDomMeasured:false,cloudMeasured:false,networkCalls:0}));
}
