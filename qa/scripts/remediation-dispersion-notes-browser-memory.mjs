// Local isolated React/DOM memory gate; explicit execution only after CPU coordination.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
assert.deepEqual(process.argv.slice(2),['--run-synthetic'],'Run explicitly: node qa/scripts/remediation-dispersion-notes-browser-memory.mjs --run-synthetic');
const sha=text=>createHash('sha256').update(text).digest('hex');
const pageSource=fs.readFileSync(path.join(root,'src/app/wallet/dispersiones/page.tsx'),'utf8');
const ast=ts.createSourceFile('page.tsx',pageSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function extract(predicate){const matches=[];function visit(node){if(predicate(node))matches.push(node);ts.forEachChild(node,visit);}visit(ast);assert.equal(matches.length,1,'Exact application fragment must match once');return matches[0].getText(ast);}
const bubble=extract(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='NoteBubble');
const dateHelper=extract(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='noteDateTimeText');
const container=extract(node=>ts.isJsxElement(node)&&node.openingElement.tagName.getText(ast)==='div'&&node.openingElement.attributes.properties.some(attr=>ts.isJsxAttribute(attr)&&attr.name.getText(ast)==='className'&&attr.initializer&&ts.isStringLiteral(attr.initializer)&&attr.initializer.text.includes('max-h-80'))&&node.getText(ast).includes('notesState.headNotes.map'));
const cssRoot=path.join(root,'.next/static/css'),mediaRoot=path.join(root,'.next/static/media');
assert.ok(fs.existsSync(cssRoot),'Prerequisite: reviewed local Next build with compiled Tailwind/root CSS');
function files(directory){return fs.existsSync(directory)?fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(directory,entry.name)):[path.join(directory,entry.name)]):[];}
const css=files(cssRoot).filter(file=>file.endsWith('.css')).sort();assert.ok(css.length,'Compiled root/Tailwind CSS required');
const assets=new Map();for(const file of [...css,...files(mediaRoot)])assets.set('/_next/'+path.relative(path.join(root,'.next'),file).split(path.sep).join('/'),file);
const provider=`export async function listClientDispersionNotes(input){
 const c=window.__config, s=window.__transport;s.active++;s.calls++;s.maxActive=Math.max(s.maxActive,s.active);
 try{
  if(c.deny)throw{code:'functions/permission-denied'};
  if(input.cursor&&input.cursor.updateSeconds!==c.version)throw{code:'functions/failed-precondition'};
  const start=input.cursor?Number(input.cursor.id.slice(1))+1:0;
  const count=Math.min(input.limit||50,c.count-start,Math.floor((8388608-1024)/(c.textBytes+512)));
  const items=Array.from({length:count},(_,offset)=>{const n=start+offset;return{id:'n'+String(n).padStart(4,'0'),updateSeconds:c.version,updateNanoseconds:n,displayDate:{kind:'STRING',value:'2026-10-10T12:00:00'},text:(String(n)+':'+c.version+':').padEnd(c.textBytes,'x')};});
  const last=items.at(-1),nextCursor=start+count<c.count?{version:2,dispersionId:'synthetic',id:last.id,updateSeconds:c.version,updateNanoseconds:last.updateNanoseconds}:null;
  const wire=JSON.stringify({result:{items,nextCursor}}),bytes=new TextEncoder().encode(wire).length;
  if(bytes>8388608)throw Error('SYNTHETIC_BYTE_BUDGET');s.maxResponseBytes=Math.max(s.maxResponseBytes,bytes);
  const decoded=JSON.parse(wire).result;await window.__sampleMemory('delivery');return decoded;
 }finally{s.active--;}
}`;
const entry=`import React,{useLayoutEffect} from 'react';import{createRoot}from'react-dom/client';
import{useDispersionNotes,dispersionNoteDisplayDate}from'@/lib/useDispersionNotes';
import{noteAuthorLabel}from'@/lib/notePresentation';import{formatDateTime24}from'@/lib/dateTime';
${dateHelper}\n${bubble}
function App(){const notesState=useDispersionNotes('synthetic','synthetic','synthetic'),notes=notesState.notes;
 useLayoutEffect(()=>{window.__notes={...notesState};window.__sampleMemory('commit');},[notesState]);return(${container});}
const renderRoot=createRoot(document.getElementById('root'));renderRoot.render(<App/>);window.__unmount=()=>{renderRoot.unmount();window.__notes=null;};`;
const output=await build({stdin:{contents:entry,sourcefile:'notes-memory-fixture.tsx',loader:'tsx',resolveDir:root},bundle:true,write:false,format:'iife',platform:'browser',minify:true,define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'notes-local-only',setup(builder){
 builder.onResolve({filter:/^@\/services\/financing$/},()=>({path:'notes-synthetic-provider',namespace:'synthetic'}));
 builder.onLoad({filter:/.*/,namespace:'synthetic'},()=>({contents:provider,loader:'js'}));
 builder.onResolve({filter:/^@\//},args=>{const base=path.join(root,'src',args.path.slice(2));const resolved=[base,base+'.ts',base+'.tsx',path.join(base,'index.ts')].find(file=>fs.existsSync(file)&&fs.statSync(file).isFile());assert.ok(resolved,'Actual application import must resolve');return{path:resolved};});
}}]});
const bundle=output.outputFiles[0].contents;
// Block any accidental Firebase dependency rather than configuring dummy credentials.
assert.ok(!Buffer.from(bundle).includes(Buffer.from('securetoken.googleapis.com')),'Firebase runtime must not be bundled');
const provenance={pageSha256:sha(pageSource),bubbleSha256:sha(bubble),containerSha256:sha(container),hookSha256:sha(fs.readFileSync(path.join(root,'src/lib/useDispersionNotes.ts'))),helpers:['src/lib/paginatedNotesController.ts','src/lib/notePresentation.ts','src/lib/dateTime.ts'].map(file=>({file,sha256:sha(fs.readFileSync(path.join(root,file)))})),bundleSha256:sha(bundle),css:css.map(file=>({file:path.basename(file),sha256:sha(fs.readFileSync(file))}))};
let server,browser,browserServer,watchdog,serverClosed=false,browserClosed=false,blockedNetwork=0;
const reports=[];
try{
 server=http.createServer((req,res)=>{
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  if(req.url==='/'){res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><html class="dark"><head>'+css.map(file=>'<link rel="stylesheet" href="/_next/'+path.relative(path.join(root,'.next'),file).split(path.sep).join('/')+'">').join('')+'</head><body class="bg-slate-950 text-white"><div id="root"></div><script src="/fixture.js"></script></body></html>');return;}
  if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end(bundle);return;}
  const file=assets.get(req.url);if(!file){res.writeHead(404);res.end();return;}
  res.setHeader('content-type',file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'application/octet-stream');res.end(fs.readFileSync(file));
 });server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
 browserServer=await chromium.launchServer({host:'127.0.0.1',headless:true,args:['--js-flags=--max-old-space-size=768'],timeout:30000});browser=await chromium.connect(browserServer.wsEndpoint());
 watchdog=setTimeout(()=>{void browserServer?.kill();server?.closeAllConnections?.();server?.close();},240000);watchdog.unref();
 for(const scenario of [{name:'unchanged',count:150,textBytes:192*1024,change:false},{name:'changed',count:150,textBytes:192*1024,change:true},{name:'wide',count:150,textBytes:1048000,change:true}]){
  console.error('NOTES_BROWSER_STAGE '+scenario.name+' setup');
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1000,height:800}});let page;
  try{
   await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==origin||route.request().method()!=='GET'||u.search){blockedNetwork++;await route.abort();}else await route.continue();});
   page=await context.newPage();page.setDefaultTimeout(15000);const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
   let peakHeap=0,peakNodes=0,measurements=0,samplePromise=Promise.resolve(),sampleError=false;
   const phases=[];
   async function sample(){try{const [metrics,dom]=await Promise.all([cdp.send('Performance.getMetrics'),cdp.send('Memory.getDOMCounters')]);const values=Object.fromEntries(metrics.metrics.map(x=>[x.name,x.value]));peakHeap=Math.max(peakHeap,values.JSHeapUsedSize||0);peakNodes=Math.max(peakNodes,dom.nodes);measurements++;return{jsHeapUsed:values.JSHeapUsedSize,jsHeapTotal:values.JSHeapTotalSize,...dom};}catch{sampleError=true;throw Error('MEMORY_SAMPLE_FAILED');}}
   await page.exposeFunction('__sampleMemory',()=>{samplePromise=samplePromise.then(sample);return samplePromise;});
   await page.addInitScript(config=>{window.__config={...config,version:1,deny:false};window.__transport={calls:0,active:0,maxActive:0,maxResponseBytes:0};},scenario);
   await page.clock.install({time:new Date('2026-10-10T12:00:00Z')});
   phases.push({name:'blank',...await sample()});await page.goto(origin,{waitUntil:'load'});
   async function idle(){await page.waitForFunction(()=>window.__notes&&window.__transport.calls>0&&!window.__notes.loading&&window.__transport.active===0,{},{polling:'raf'});await samplePromise;assert.equal(sampleError,false);}
   async function phase(name){console.error('NOTES_BROWSER_STAGE '+scenario.name+' '+name);await samplePromise;phases.push({name,beforeGc:await sample()});await cdp.send('HeapProfiler.collectGarbage');phases.at(-1).afterGc=await sample();}
   await idle();
   for(let step=0;;step++){
    const state=await page.evaluate(()=>({count:window.__notes.notes.length,pending:window.__notes.refreshPending,older:window.__notes.canLoadOlder}));
    if(state.count===scenario.count&&!state.pending)break;assert.ok(step<200,'Initial browser window must converge');
    if(state.older)await page.evaluate(()=>window.__notes.loadOlder());else await page.clock.runFor(6000);await idle();
   }
   await phase('loaded');
   if(scenario.change)await page.evaluate(()=>{window.__config.version++;});
   let cycles=0;do{await page.clock.runFor(6000);await idle();assert.ok(++cycles<200,'Refresh must converge');}while(await page.evaluate(()=>window.__notes.refreshPending));
   await phase('refreshed');
   const integrity=await page.evaluate(()=>{const s=window.__notes;const bubbles=[...document.querySelectorAll('#root .whitespace-pre-wrap')];return{ids:s.notes.map(x=>x.id),versions:[...new Set(s.notes.map(x=>x.updateSeconds))],bubbles:bubbles.length,textLength:bubbles.reduce((sum,n)=>sum+(n.textContent||'').length,0),...window.__transport};});
   assert.deepEqual(integrity.ids,Array.from({length:scenario.count},(_,i)=>'n'+String(i).padStart(4,'0')));assert.deepEqual(integrity.versions,[scenario.change?2:1]);assert.equal(integrity.bubbles,scenario.count);assert.equal(integrity.textLength,scenario.count*scenario.textBytes);assert.equal(integrity.maxActive,1);assert.ok(integrity.maxResponseBytes<=8388608);
   // A second stable epoch exposes growth or retention rather than measuring only one swap.
   do{await page.clock.runFor(6000);await idle();assert.ok(++cycles<400);}while(await page.evaluate(()=>window.__notes.refreshPending));await phase('stableRepeat');
   await page.evaluate(()=>{window.__config.deny=true;window.__notes.refresh();});await idle();assert.equal(await page.locator('#root .whitespace-pre-wrap').count(),0);await phase('revoked');
   const calls=await page.evaluate(()=>window.__transport.calls);await page.evaluate(()=>window.__unmount());await page.clock.runFor(60000);assert.equal(await page.evaluate(()=>window.__transport.calls),calls);assert.equal(await page.locator('#root').textContent(),'');await phase('unmounted');
   reports.push({scenario:scenario.name,count:scenario.count,textBytes:scenario.textBytes,cycles,calls,measurements,peakHeap,peakNodes,phases,browserDomMeasured:true,wholeApplicationMeasured:false,browserProcessRssMeasured:false,cloudMeasured:false});
  }catch(error){
   const diagnostic=path.join(root,'.firebase/remediation-temp/notes-browser-memory');fs.mkdirSync(diagnostic,{recursive:true});
   if(page)await page.screenshot({path:path.join(diagnostic,scenario.name+'-failure.png'),timeout:5000}).catch(()=>{});
   console.error('NOTES_BROWSER_FAILED '+scenario.name);throw error;
  }finally{await context.close();}
 }
 assert.equal(blockedNetwork,0,'Unexpected outbound requests must fail the gate');
}finally{
 clearTimeout(watchdog);if(browser)await browser.close();if(browserServer){await browserServer.close();browserClosed=true;}if(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));serverClosed=true;}
}
assert.ok(browserClosed&&serverClosed);
console.log(JSON.stringify({kind:'NOTES_REACT_DOM_MEMORY',provenance,reports,blockedNetwork,browserClosed,serverClosed}));
