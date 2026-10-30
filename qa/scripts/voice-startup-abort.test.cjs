const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const out={};new Function('exports',ts.transpileModule(fs.readFileSync('src/lib/hugoVoiceStartup.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(out);
const {withVoiceStartupAbort}=out;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const flush=()=>new Promise(setImmediate);
test('real helper returns successful startup value and does not release the active stream',async()=>{
 const controller=new AbortController(),value={synthetic:true};let released=0;
 assert.equal(await withVoiceStartupAbort(async()=>value,controller.signal,()=>{released++;}),value);controller.abort();await flush();assert.equal(released,0);
});
test('cancelled startup never dispatches its pending operation or a subsequent gateway action',async()=>{
 const controller=new AbortController();controller.abort();let operations=0,gateways=0;
 await assert.rejects((async()=>{await withVoiceStartupAbort(async()=>{operations++;return{};},controller.signal);gateways++;})(),e=>e.name==='AbortError');assert.equal(operations,0);assert.equal(gateways,0);
});
test('cancelling pending microphone acquisition releases every late track exactly once and never opens a gateway',async()=>{
 const controller=new AbortController(),media=deferred();let operations=0,gateways=0;const stopped=[0,0];
 const result=(async()=>{await withVoiceStartupAbort(()=>{operations++;return media.promise;},controller.signal,stream=>stream.getTracks().forEach(track=>track.stop()));gateways++;})();
 await flush();const denied=assert.rejects(result,e=>e.name==='AbortError');controller.abort();await denied;
 media.resolve({getTracks:()=>stopped.map((_n,i)=>({stop:()=>{stopped[i]++;}}))});await flush();assert.equal(operations,1);assert.deepEqual(stopped,[1,1]);assert.equal(gateways,0);
});
test('startup timeout rejects with the timeout reason while the browser operation remains pending',async()=>{
 const controller=new AbortController(),pending=deferred(),reason=new Error('VOICE_STARTUP_TIMEOUT');let gateways=0;
 const result=(async()=>{await withVoiceStartupAbort(()=>pending.promise,controller.signal);gateways++;})();
 const denied=assert.rejects(result,e=>e===reason),timer=setTimeout(()=>controller.abort(reason),10);
 try{await denied;}finally{clearTimeout(timer);}pending.reject(new Error('LATE_BROWSER_REJECTION'));await flush();assert.equal(gateways,0);
});
test('cancellation before the dispatch microtask suppresses the operation',async()=>{
 const controller=new AbortController();let operations=0;
 const result=withVoiceStartupAbort(async()=>{operations++;return{};},controller.signal);const denied=assert.rejects(result);controller.abort();await denied;await flush();assert.equal(operations,0);
});
test('native startup errors stay observable and do not open a gateway',async()=>{
 const controller=new AbortController(),reason=new Error('SYNTHETIC_PERMISSION_DENIED');let gateways=0;
 await assert.rejects((async()=>{await withVoiceStartupAbort(async()=>{throw reason;},controller.signal);gateways++;})(),e=>e===reason);assert.equal(gateways,0);
});
