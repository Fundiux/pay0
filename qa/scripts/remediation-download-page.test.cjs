const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { test } = require('node:test');
const jsx = (type, props) => ({ type, props });
function load(file, deps, globals = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  new Function('exports','require',...Object.keys(globals),source)(exports, name => {if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};assert(Object.hasOwn(deps,name),name);return deps[name];},...Object.values(globals));
  return exports;
}
const bearer='a'.repeat(43);
function harness(fragment='#token='+bearer, failure=false, initialPath='/descarga/documento', fetchPlan) {
  let cursor=0;const slots=[];const effects=[];const order=[];const calls=[];const anchors=[];const revoked=[];const listeners=new Set();const cleanups=[];const effectCallbacks=[];
  const react={
    useRef(value){const i=cursor++;return slots[i]||(slots[i]={current:value});},
    useState(value){const i=cursor++;if(!(i in slots))slots[i]=value;return [slots[i],next=>{slots[i]=next;}];},
    useEffect(effect){const i=cursor++;if(!slots[i]){slots[i]=true;effects.push(effect);effectCallbacks.push(effect);}},
  };
  const win={addEventListener:(_name,fn)=>listeners.add(fn),removeEventListener:(_name,fn)=>listeners.delete(fn),location:{hash:fragment,pathname:initialPath,search:''},history:{replaceState(_state,_title,path){order.push('erase');win.location.hash='';assert.equal(path,'/descarga/documento');}}};
  Object.defineProperty(win.location,'href',{get:()=> 'https://pay-0-system.web.app'+win.location.pathname+win.location.hash});
  const response=()=>({ok:true,blob:async()=>({}),headers:{get:()=>"attachment; filename*=UTF-8''comprobante.pdf"}});
  const doc={body:{appendChild:a=>anchors.push(a)},createElement:()=>({click(){order.push('download');},remove(){}})};
  const Page=load('src/app/descarga/documento/page.tsx',{'react':react},{window:win,document:doc,AbortController,URL:{createObjectURL:()=> 'blob:local-document',revokeObjectURL:u=>revoked.push(u)},setTimeout:fn=>{fn();},fetch:async(url,options)=>{order.push('fetch');calls.push({url,options});if(fetchPlan)return fetchPlan(calls.length,options,response);if(failure)throw Error('PRIVATE '+bearer);return {ok:true,blob:async()=>({}),headers:{get:()=>"attachment; filename*=UTF-8''comprobante.pdf"}};}}).default;
  return {win,order,calls,anchors,revoked,response,
    changeHash(hash){win.location.hash=hash;for(const listener of [...listeners])listener({newURL:win.location.href});},
    strictEffects(){while(cleanups.length)cleanups.pop()();for(const effect of effectCallbacks){const cleanup=effect();if(cleanup)cleanups.push(cleanup);}},
    unmount(){while(cleanups.length)cleanups.pop()();},
    remount(){this.unmount();slots.length=0;effects.length=0;effectCallbacks.length=0;},
    render(){cursor=0;const tree=Page();while(effects.length){const cleanup=effects.shift()();if(cleanup)cleanups.push(cleanup);}return tree;}};
}
function find(node,type){if(!node||typeof node!=='object')return null;if(node.type===type)return node;for(const child of [node.props?.children].flat()){const found=find(child,type);if(found)return found;}return null;}

test('fragment erased at module initialization before render; fetch uses body and blob only',async()=>{
 const h=harness();assert.equal(h.win.location.hash,'');assert.deepEqual(h.order,['erase']);
 h.render();const tree=h.render();assert.ok(!JSON.stringify(tree).includes(bearer));
 await find(tree,'button').props.onClick();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.calls.length,1);const {url,options}=h.calls[0];assert.ok(!url.includes(bearer));assert.ok(!url.includes('?'));
 assert.equal(options.method,'POST');assert.equal(JSON.parse(options.body).token,bearer);assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');
 assert.equal(h.anchors[0].href,'blob:local-document');assert.equal(h.anchors[0].download,'comprobante.pdf');assert.equal(h.revoked.length,1);
 assert.ok(JSON.stringify(h.render()).includes('La descarga se ha enviado'));
});

test('bad fragment and provider failure render generic Spanish text without bearer or exception',async()=>{
 const bad=harness('#token=bad');bad.render();assert.equal(find(bad.render(),'button'),null);assert.equal(bad.calls.length,0);
 const h=harness(undefined,true);h.render();await find(h.render(),'button').props.onClick();await new Promise(resolve=>setImmediate(resolve));
 const output=JSON.stringify(h.render());assert.ok(output.includes('Solicita un enlace nuevo'));assert.ok(!output.includes(bearer));assert.ok(!output.includes('PRIVATE'));
});

test('only exact document route is public; adjacent routes retain authentication',()=>{
 for(const pathname of ['/descarga/documento','/descarga/documento/otro','/descarga','/descarga/documento-falso']){
  const deps={'next/navigation':{usePathname:()=>pathname}};
  for(const name of ['AppShell','assets/AssetsShell','hugo/HugoShell','MaintenanceGate','RequireAuth','RouteAccessGuard'])deps['@/components/'+name]={default:name};
  deps['@/components/GlobalLoading']={GlobalLoadingProvider:'GlobalLoadingProvider'};
  const Shell=load('src/components/RootClientShell.tsx',deps).default;
  const output=JSON.stringify(Shell({children:'download-content'}));
  assert.equal(output.includes('RequireAuth'),pathname!=='/descarga/documento');
 }
});


test('prefetch on another route preserves hash; cached SPA visits capture fresh fragments',async()=>{
 const h=harness('#section',false,'/pagos');assert.equal(h.win.location.hash,'#section');assert.deepEqual(h.order,[]);
 h.win.location.pathname='/descarga/documento';h.win.location.hash='#token='+bearer;h.render();
 assert.equal(h.win.location.hash,'');await find(h.render(),'button').props.onClick();await new Promise(resolve=>setImmediate(resolve));
 const next='b'.repeat(43);h.remount();h.win.location.hash='#token='+next;h.render();
 assert.equal(h.win.location.hash,'');await find(h.render(),'button').props.onClick();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.calls.length,2);assert.equal(JSON.parse(h.calls[1].options.body).token,next);
});


test('same-document hash changes erase immediately and permit a second download without remount',async()=>{
 const h=harness();h.render();await find(h.render(),'button').props.onClick();await new Promise(resolve=>setImmediate(resolve));
 const next='b'.repeat(43);h.changeHash('#token='+next);assert.equal(h.win.location.hash,'');
 await find(h.render(),'button').props.onClick();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.calls.length,2);assert.equal(JSON.parse(h.calls[1].options.body).token,next);assert.equal(h.anchors.length,2);
 h.changeHash('#token=invalid');assert.equal(h.win.location.hash,'');assert.equal(find(h.render(),'button'),null);assert.equal(h.calls.length,2);
});

test('invalid fragment during pending fetch aborts and discards even an abort-ignoring response',async()=>{
 let resolve;const h=harness(undefined,false,undefined,()=>new Promise(done=>resolve=done));h.render();
 await find(h.render(),'button').props.onClick();h.changeHash('#token=invalid');
 assert.equal(h.calls[0].options.signal.aborted,true);assert.equal(h.win.location.hash,'');
 resolve(h.response());await new Promise(done=>setImmediate(done));
 assert.equal(h.anchors.length,0);assert.equal(find(h.render(),'button'),null);assert.ok(JSON.stringify(h.render()).includes('Solicita un enlace nuevo'));
});

test('new valid fragment during blob read prevents stale download and stale completion state',async()=>{
 let resolveBlob;const h=harness(undefined,false,undefined,(number,_options,response)=>number===1?{...response(),blob:()=>new Promise(done=>resolveBlob=done)}:response());
 h.render();await find(h.render(),'button').props.onClick();await new Promise(done=>setImmediate(done));
 h.changeHash('#token='+'b'.repeat(43));assert.equal(h.calls[0].options.signal.aborted,true);
 await find(h.render(),'button').props.onClick();await new Promise(done=>setImmediate(done));
 resolveBlob({});await new Promise(done=>setImmediate(done));assert.equal(h.anchors.length,1);assert.ok(JSON.stringify(h.render()).includes('La descarga se ha enviado'));
});

test('StrictMode listener reattaches and unmount aborts an active transfer',async()=>{
 let resolve;const h=harness(undefined,false,undefined,()=>new Promise(done=>resolve=done));h.render();h.strictEffects();
 h.changeHash('#token='+'b'.repeat(43));assert.equal(h.win.location.hash,'');await find(h.render(),'button').props.onClick();
 h.unmount();assert.equal(h.calls[0].options.signal.aborted,true);resolve(h.response());await new Promise(done=>setImmediate(done));assert.equal(h.anchors.length,0);
});
