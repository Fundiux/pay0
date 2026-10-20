import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
function load(file, deps={}) { const out={}; new Function('exports','require',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(out,n=>{assert.ok(Object.hasOwn(deps,n),n);return deps[n];});return out; }
const shared=load('src/lib/paginatedNotesController.ts');
const api=load('src/lib/usePagoNotes.ts',{'react':{},'@/services/pagos':{},'@/lib/paginatedNotesController':shared});
const flush=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
const row=(id='one')=>({id,updateSeconds:1,updateNanoseconds:2,displayDate:{kind:'NONE'},text:'fixture'});
const rootless={code:'functions/failed-precondition',details:{reason:'ROOT_SCOPE_UNVERIFIED'},message:'private arbitrary detail'};
function setup(){let state,calls=0,error=null,hold=null;const timers=new Map();let seq=0;const requests=[];const controller=api.createPagoNotesController({fetch:async(cursor,limit)=>{calls++;requests.push({cursor,limit});if(hold)await new Promise(resolve=>hold=resolve);if(error)throw error;return{items:Array.from({length:50},(_,i)=>row(String(i))),nextCursor:{version:2,pagoId:'s',id:'one',updateSeconds:1,updateNanoseconds:2}};},emit:s=>state=s,visible:()=>true,setTimer:fn=>{timers.set(++seq,fn);return seq;},clearTimer:id=>timers.delete(id)});return{controller,timers,requests,get state(){return state;},get calls(){return calls;},reject:e=>error=e,allow:()=>error=null,hold:()=>hold=true,release:()=>{const fn=hold;hold=null;fn();}};}
test('rootless clears both sections, cursor, queued work and automatic focus retry',async()=>{const s=setup();s.controller.refresh();await flush();assert.ok(s.state.notes.length);s.hold();s.controller.refresh();s.controller.loadOlder();s.reject(rootless);s.release();await flush();assert.deepEqual(s.state.notes,[]);assert.deepEqual(s.state.headNotes,[]);assert.deepEqual(s.state.retainedNotes,[]);assert.equal(s.state.hasMore,false);assert.equal(s.state.canLoadOlder,false);assert.equal(s.state.refreshPending,false);assert.equal(s.timers.size,0);assert.doesNotMatch(s.state.error,/private|ROOT_SCOPE|one/);const count=s.calls;s.controller.visibilityChanged();s.controller.loadOlder();await flush();assert.equal(s.calls,count);s.allow();s.controller.refresh();await flush();assert.ok(s.calls>count);s.controller.stop();});
test('unrecognized failed-precondition remains retryable, no rootless inference from message',async()=>{const s=setup();s.reject({code:'failed-precondition',message:'ROOT_SCOPE_UNVERIFIED',details:{reason:'OTHER'}});s.controller.refresh();await flush();assert.equal(s.timers.size,1);assert.match(s.state.error,/actualizar/);s.controller.stop();});
for(const code of ['permission-denied','unauthenticated','not-found'])test(`authority loss clears loaded notes: ${code}`,async()=>{const s=setup();s.controller.refresh();await flush();s.reject({code});s.controller.refresh();await flush();assert.equal(s.state.notes.length,0);assert.equal(s.timers.size,0);s.controller.stop();});
test('stop suppresses late scope response',async()=>{const s=setup();s.hold();s.controller.refresh();s.controller.stop();s.release();await flush();assert.equal(s.state.notes.length,0);assert.equal(s.timers.size,0);});
test('default shared controller does not opt into pago terminal error',async()=>{let state;const timers=[];const c=shared.createPaginatedNotesController({fetch:async()=>{throw rootless;},emit:s=>state=s,visible:()=>true,setTimer:fn=>timers.push(fn),clearTimer:()=>{}});c.refresh();await flush();assert.match(state.error,/actualizar/);assert.equal(timers.length,1);c.stop();});
test('normalized display dates never fabricate current time',()=>{assert.equal(api.pagoNoteDisplayDate({kind:'NONE'}),null);assert.equal(api.pagoNoteDisplayDate({kind:'STRING',value:'invalid'}),null);assert.equal(api.pagoNoteDisplayDate({kind:'TIMESTAMP',seconds:0,nanoseconds:1000000}).getTime(),1);});
test('real hook isolates uid/root/parent/view and callable request carries only native contract',async()=>{
 const states=[],refs=[],effects=[];let offset=0,pending=[];const requests=[];let late;
 const react={useState:init=>{const i=offset++;if(!(i in states))states[i]=init;return[states[i],v=>states[i]=v];},useRef:init=>{const i=offset++;return refs[i]??=( {current:init} );},useEffect:(fn,deps)=>{const i=offset++;if(!effects[i]||deps.some((v,j)=>v!==effects[i].deps[j]))pending.push(()=>{effects[i]?.cleanup?.();effects[i]={deps,cleanup:fn()};});}};
 const listeners=new Map();globalThis.window={setTimeout:()=>1,clearTimeout:()=>{},addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};globalThis.document={visibilityState:'visible',addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
 const hook=load('src/lib/usePagoNotes.ts',{'react':react,'@/services/pagos':{listPagoNotes:input=>{requests.push(input);return new Promise(resolve=>late=resolve);}},'@/lib/paginatedNotesController':shared});
 const render=(...args)=>{offset=0;return hook.usePagoNotes(...args);};const commit=()=>{const work=pending;pending=[];work.forEach(fn=>fn());};
 try{let view=render('u','r','s',true);commit();assert.deepEqual(requests,[{pagoId:'s',limit:50}]);late({items:[row()],nextCursor:null});await flush();view=render('u','r','s',true);assert.equal(view.notes.length,1);const oldRefresh=view.refresh;
 view=render('u','r','s',false);assert.equal(view.notes.length,0);commit();oldRefresh();assert.equal(requests.length,1);
 view=render('u2','r2','s2',true);assert.equal(view.notes.length,0);commit();const finishOld=late;view=render('u3','r3','s3',true);assert.equal(view.notes.length,0);commit();finishOld({items:[row('old')],nextCursor:null});await flush();view=render('u3','r3','s3',true);assert.equal(view.notes.length,0);assert.deepEqual(Object.keys(requests.at(-1)).sort(),['limit','pagoId']);
 view=render('','','',false);commit();assert.equal(view.notes.length,0);assert.equal(listeners.size,0);
 }finally{for(const effect of effects)effect?.cleanup?.();delete globalThis.window;delete globalThis.document;}
});

test('Pago page uses callable-only notes, tagged dates, separate unread and refresh after send',()=>{
 const page=fs.readFileSync('src/app/pagos/page.tsx','utf8');
 assert.doesNotMatch(page,/pagos\/\$\{notesFor.id\}\/notas|setNotes\(/);
 assert.match(page,/usePagoNotes\(myUid \|\| "", rootId \|\| "", notesFor\?\.id, canViewPagos\)/);
 assert.match(page,/\[myUid, rootId, notesFor\?\.id\]/);
 assert.equal((page.match(/hasUnreadMsg: false/g)||[]).length,1);
 assert.match(page,/setNewNote\(""\);\s+notesState.refresh\(\)/);
 assert.match(page,/disabled=\{!notesState.canLoadOlder\}/);
 assert.match(page,/pagoNoteDisplayDate\(note\?\.displayDate\)/);
 assert.match(page,/Actualizaciones m\u00e1s recientes primero/);
 assert.match(page,/role="alert"/);
});

test('actual notes JSX distinguishes retained history, timestamps and empty/loading/denied states',()=>{
 const page=fs.readFileSync('src/app/pagos/page.tsx','utf8');
 const start=page.lastIndexOf('<div className="flex-1 space-y-3 overflow-y-auto p-4">',page.indexOf('Actualizaciones'));
 const end=page.indexOf('<div className="border-t border-white/10 p-4">',start);
 const jsx=page.slice(start,end).trim();
 const output=ts.transpileModule('exports.render=(notesState)=>('+jsx+');',{fileName:'notes.tsx',compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
 const api={};const React={createElement:(type,props,...children)=>({type,props:props||{},children})};
 const bubble=()=>{};new Function('exports','React','NoteBubble','myUid','tsToDateTimeText',output)(api,React,bubble,'u',v=>'observed:'+v.seconds);
 const flatten=node=>node===null||node===undefined||typeof node==='boolean'?[]:Array.isArray(node)?node.flatMap(flatten):typeof node==='object'?[node,...node.children.flatMap(flatten)]:[String(node)];
 const render=patch=>flatten(api.render({...shared.emptyNotesState(),refresh(){},reloadFromStart(){},loadOlder(){},...patch}));
 const text=nodes=>nodes.filter(x=>typeof x==='string').join(' ');
 const state={notes:[row('head'),row('old')],headNotes:[row('head')],retainedNotes:[row('old')],refreshPending:true,headObservedAt:2000,windowObservedAt:1000};
 const nodes=render(state),labels=text(nodes);assert.match(labels,/Notas anteriores conservadas/);assert.match(labels,/Actualizando historial/);assert.match(labels,/observed:2/);assert.match(labels,/observed:1/);
 assert.deepEqual(nodes.filter(x=>x.type===bubble).map(x=>x.props.note.id),['head','old']);
 assert.ok(nodes.findIndex(x=>typeof x==='string'&&x.includes('Notas anteriores'))>nodes.findIndex(x=>x.type===bubble&&x.props.note.id==='head'));
 assert.ok(nodes.findIndex(x=>typeof x==='string'&&x.includes('Notas anteriores'))<nodes.findIndex(x=>x.type===bubble&&x.props.note.id==='old'));
 assert.match(text(render({...state,refreshPending:false})),/Historial actualizado/);
 for(const patch of [{loading:true},{error:'denied'}])assert.doesNotMatch(text(render(patch)),/Sin mensajes/);
 assert.match(text(render({})),/Sin mensajes/);assert.match(text(render({})),/Pendiente/);
 let reset=0;const button=render({reloadFromStart:()=>reset++}).find(x=>x.type==='button'&&x.children.includes('Reiniciar lectura'));button.props.onClick();assert.equal(reset,1);
});
