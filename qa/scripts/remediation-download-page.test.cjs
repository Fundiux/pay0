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
function harness(fragment='#token='+bearer, failure=false, initialPath='/descarga/documento') {
  let cursor=0;const slots=[];const effects=[];const order=[];const calls=[];const anchors=[];const revoked=[];
  const react={
    useRef(value){const i=cursor++;return slots[i]||(slots[i]={current:value});},
    useState(value){const i=cursor++;if(!(i in slots))slots[i]=value;return [slots[i],next=>{slots[i]=next;}];},
    useEffect(effect){const i=cursor++;if(!slots[i]){slots[i]=true;effects.push(effect);}},
  };
  const win={location:{hash:fragment,pathname:initialPath,search:''},history:{replaceState(_state,_title,path){order.push('erase');win.location.hash='';assert.equal(path,'/descarga/documento');}}};
  const doc={body:{appendChild:a=>anchors.push(a)},createElement:()=>({click(){order.push('download');},remove(){}})};
  const Page=load('src/app/descarga/documento/page.tsx',{'react':react},{window:win,document:doc,URL:{createObjectURL:()=> 'blob:local-document',revokeObjectURL:u=>revoked.push(u)},setTimeout:fn=>{fn();},fetch:async(url,options)=>{order.push('fetch');calls.push({url,options});if(failure)throw Error('PRIVATE '+bearer);return {ok:true,blob:async()=>({}),headers:{get:()=>"attachment; filename*=UTF-8''comprobante.pdf"}};}}).default;
  return {win,order,calls,anchors,revoked,remount(){slots.length=0;effects.length=0;},render(){cursor=0;const tree=Page();while(effects.length)effects.shift()();return tree;}};
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
