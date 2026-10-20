// Local isolated synthetic React/DOM functional gate; explicit execution only after CPU coordination.
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
assert.deepEqual(process.argv.slice(2),['--run-synthetic'],'Run explicitly: node qa/scripts/remediation-solicitud-notes-browser.mjs --run-synthetic');
const sha=text=>createHash('sha256').update(text).digest('hex');
const pageSource=fs.readFileSync(path.join(root,'src/app/solicitudes/page.tsx'),'utf8');
const ast=ts.createSourceFile('page.tsx',pageSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function extract(predicate){const matches=[];function visit(node){if(predicate(node))matches.push(node);ts.forEachChild(node,visit);}visit(ast);assert.equal(matches.length,1,'Exact application fragment must match once');return matches[0].getText(ast);}
const bubble=extract(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='NoteBubble');
const dateHelper=extract(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='noteDateTimeText');
const container=extract(node=>ts.isJsxElement(node)&&node.openingElement.tagName.getText(ast)==='div'&&node.openingElement.attributes.properties.some(attr=>ts.isJsxAttribute(attr)&&attr.name.getText(ast)==='className'&&attr.initializer&&ts.isStringLiteral(attr.initializer)&&attr.initializer.text === 'flex-1 space-y-3 overflow-y-auto p-4')&&node.getText(ast).includes('notesState.headNotes.map'));
const cssRoot=path.join(root,'.next/static/css'),mediaRoot=path.join(root,'.next/static/media');
assert.ok(fs.existsSync(cssRoot),'Prerequisite: reviewed local Next build with compiled Tailwind/root CSS');
function files(directory){return fs.existsSync(directory)?fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(directory,entry.name)):[path.join(directory,entry.name)]):[];}
const css=files(cssRoot).filter(file=>file.endsWith('.css')).sort();assert.ok(css.length,'Compiled root/Tailwind CSS required');
const assets=new Map();for(const file of [...css,...files(mediaRoot)])assets.set('/_next/'+path.relative(path.join(root,'.next'),file).split(path.sep).join('/'),file);
const provider=`export async function listSolicitudNotes(input){
 const c=window.__config,s=window.__transport;s.calls++;s.active++;s.maxActive=Math.max(s.maxActive,s.active);s.requests.push(Object.keys(input).sort());
 const scope=c.scope,version=c.version;
 try{
  if(c.hold)await new Promise(resolve=>window.__release=resolve);
  if(c.error)throw c.error;
  if(input.solicitudId!==scope||input.cursor&&(input.cursor.solicitudId!==scope||input.cursor.updateSeconds!==version))throw{code:'functions/failed-precondition'};
  const start=input.cursor?Number(input.cursor.id.slice(1))+1:0,count=Math.min(input.limit||50,68-start);
  const items=Array.from({length:count},(_,i)=>{const n=start+i;return{id:'n'+String(n).padStart(4,'0'),updateSeconds:version,updateNanoseconds:n,displayDate:n===0?{kind:'NONE'}:{kind:'TIMESTAMP',seconds:1700000000,nanoseconds:500000000},createdBy:n%2?'other':'user',text:'fixture-'+scope+'-'+n};});
  const last=items.at(-1),nextCursor=start+count<68?{version:2,solicitudId:scope,id:last.id,updateSeconds:version,updateNanoseconds:last.updateNanoseconds}:null;
  const wire=JSON.stringify({items,nextCursor});s.maxResponseBytes=Math.max(s.maxResponseBytes,new TextEncoder().encode(wire).length);return JSON.parse(wire);
 }finally{s.active--;}
}`;
const entry=`import React,{useLayoutEffect,useState}from'react';import{createRoot}from'react-dom/client';
import{useSolicitudNotes,solicitudNoteDisplayDate}from'@/lib/useSolicitudNotes';
import{isSystemNote,noteAuthorLabel}from'@/lib/notePresentation';import{formatDateTime24}from'@/lib/dateTime';
${dateHelper}\n${bubble}
function App(){const[scope,setScope]=useState({uid:'user',root:'root',parent:'a',enabled:true});window.__setScope=setScope;
 const uid=scope.uid,notesState=useSolicitudNotes(scope.uid,scope.root,scope.parent,scope.enabled);
 useLayoutEffect(()=>{window.__notes={...notesState};},[notesState]);return(${container});}
const renderRoot=createRoot(document.getElementById('root'));renderRoot.render(<App/>);window.__unmount=()=>{renderRoot.unmount();window.__notes=null;};`;
const output=await build({stdin:{contents:entry,sourcefile:'notes-memory-fixture.tsx',loader:'tsx',resolveDir:root},bundle:true,write:false,format:'iife',platform:'browser',minify:true,define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'notes-local-only',setup(builder){
 builder.onResolve({filter:/^@\/services\/solicitudes$/},()=>({path:'notes-synthetic-provider',namespace:'synthetic'}));
 builder.onLoad({filter:/.*/,namespace:'synthetic'},()=>({contents:provider,loader:'js'}));
 builder.onResolve({filter:/^@\//},args=>{const base=path.join(root,'src',args.path.slice(2));const resolved=[base,base+'.ts',base+'.tsx',path.join(base,'index.ts')].find(file=>fs.existsSync(file)&&fs.statSync(file).isFile());assert.ok(resolved,'Actual application import must resolve');return{path:resolved};});
}}]});
const bundle=output.outputFiles[0].contents;
// Block any accidental Firebase dependency rather than configuring dummy credentials.
assert.ok(!Buffer.from(bundle).includes(Buffer.from('securetoken.googleapis.com')),'Firebase runtime must not be bundled');
const provenance={pageSha256:sha(pageSource),bubbleSha256:sha(bubble),containerSha256:sha(container),hookSha256:sha(fs.readFileSync(path.join(root,'src/lib/useSolicitudNotes.ts'))),helpers:['src/lib/paginatedNotesController.ts','src/lib/notePresentation.ts','src/lib/dateTime.ts'].map(file=>({file,sha256:sha(fs.readFileSync(path.join(root,file)))})),bundleSha256:sha(bundle),css:css.map(file=>({file:path.basename(file),sha256:sha(fs.readFileSync(file))}))};
assert.ok(!Buffer.from(bundle).includes(Buffer.from('addSolicitudNota')));
let server,browser,browserServer,watchdog,serverClosed=false,browserClosed=false,blockedNetwork=0;
const checks=[];
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
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1000,height:800}});
 try{
  await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==origin||route.request().method()!=='GET'||u.search){blockedNetwork++;await route.abort();}else await route.continue();});
  const page=await context.newPage();page.setDefaultTimeout(15000);
  await page.addInitScript(()=>{window.__config={scope:'a',version:1,error:null,hold:false};window.__transport={calls:0,active:0,maxActive:0,maxResponseBytes:0,requests:[]};});
  await page.clock.install({time:new Date('2026-10-10T12:00:00Z')});await page.goto(origin,{waitUntil:'load'});
  const idle=()=>page.waitForFunction(()=>window.__notes&&!window.__notes.loading&&window.__transport.active===0,{},{polling:'raf'});
  await idle();assert.equal(await page.locator('.whitespace-pre-wrap').count(),50);assert.equal(await page.getByText('Fecha no disponible',{exact:true}).count(),1);assert.equal(await page.getByText('Actualizaciones m\u00e1s recientes primero',{exact:true}).count(),1);checks.push('INITIAL_NORMALIZED_DATE_DESC');
  await page.getByRole('button',{name:'Cargar anteriores',exact:true}).click();await idle();assert.equal(await page.locator('.whitespace-pre-wrap').count(),68);assert.deepEqual(await page.evaluate(()=>window.__notes.notes.map(n=>n.id)),Array.from({length:68},(_,i)=>'n'+String(i).padStart(4,'0')));checks.push('NATIVE_CURSOR_COMPLETE_HISTORY');
  await page.evaluate(()=>{window.__config.error={code:'functions/failed-precondition',details:{reason:'ROOT_SCOPE_UNVERIFIED'},message:'private-parent-id'};window.__notes.refresh();});await idle();assert.equal(await page.locator('.whitespace-pre-wrap').count(),0);assert.doesNotMatch(await page.getByRole('alert').innerText(),/private-parent-id|ROOT_SCOPE/);const deniedCalls=await page.evaluate(()=>window.__transport.calls);await page.clock.runFor(120000);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));assert.equal(await page.evaluate(()=>window.__transport.calls),deniedCalls);checks.push('ROOTLESS_TERMINAL_CLEAR_NO_AUTOMATIC_RETRY');
  await page.evaluate(()=>{window.__config.error=null;});await page.getByRole('button',{name:'Actualizar',exact:true}).click();await idle();assert.equal(await page.locator('.whitespace-pre-wrap').count(),50);checks.push('EXPLICIT_RECOVERY');
  await page.evaluate(()=>{window.__setScope({uid:'user',root:'root',parent:'a',enabled:false});});await page.waitForFunction(()=>window.__notes.notes.length===0);const disabledCalls=await page.evaluate(()=>window.__transport.calls);await page.clock.runFor(60000);assert.equal(await page.evaluate(()=>window.__transport.calls),disabledCalls);checks.push('VIEW_PERMISSION_LOSS_CLEAR');
  await page.evaluate(()=>{window.__config.scope='b';window.__config.hold=true;window.__setScope({uid:'second',root:'root2',parent:'b',enabled:true});});await page.waitForFunction(()=>window.__transport.active===1);await page.evaluate(()=>{window.__setScope({uid:'third',root:'root3',parent:'c',enabled:false});});await page.waitForFunction(()=>window.__notes.notes.length===0);await page.evaluate(()=>{window.__config.hold=false;window.__release();});await idle();assert.equal(await page.locator('.whitespace-pre-wrap').count(),0);checks.push('LATE_SCOPE_RESPONSE_DISCARDED');
  await page.evaluate(()=>{window.__config.scope='c';window.__setScope({uid:'third',root:'root3',parent:'c',enabled:true});});await idle();assert.match(await page.locator('.whitespace-pre-wrap').first().innerText(),/fixture-c-/);
  for(const code of ['permission-denied','unauthenticated','not-found']){
   await page.evaluate(code=>{window.__config.error={code:'functions/'+code};window.__notes.refresh();},code);await idle();assert.equal(await page.locator('.whitespace-pre-wrap').count(),0);await page.evaluate(()=>{window.__config.error=null;window.__notes.reloadFromStart();});await idle();
  }checks.push('AUTHORITY_ERRORS_CLEAR');
  const transport=await page.evaluate(()=>window.__transport);assert.equal(transport.maxActive,1);assert.ok(transport.maxResponseBytes<=8388608);for(const keys of transport.requests)assert.deepEqual(keys,keys.includes('cursor')?['cursor','limit','solicitudId']:['limit','solicitudId']);
  const calls=transport.calls;await page.evaluate(()=>window.__unmount());await page.clock.runFor(120000);assert.equal(await page.evaluate(()=>window.__transport.calls),calls);assert.equal(await page.locator('#root').textContent(),'');checks.push('UNMOUNT_STOPS_IO');
 }finally{await context.close();}
 assert.equal(blockedNetwork,0);
}finally{
 clearTimeout(watchdog);if(browser)await browser.close();if(browserServer){await browserServer.close();browserClosed=true;}if(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));serverClosed=true;}
}
assert.ok(browserClosed&&serverClosed);
console.log(JSON.stringify({kind:'SOLICITUD_NOTES_REACT_DOM',provenance,checks,blockedNetwork,browserClosed,serverClosed,realWriters:0,cloudCalls:0,wholeApplicationMeasured:false}));
