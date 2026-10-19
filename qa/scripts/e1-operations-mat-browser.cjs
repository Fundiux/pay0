// UI evidence with original components and synthetic read adapters; never financial E2E.
const fs = require('node:fs'), path = require('node:path');
const esbuild = require('../../functions/node_modules/esbuild');
const { chromium, expect } = require('@playwright/test');
const root = path.resolve(__dirname, '../..'), output = path.join(root, 'tmp', 'e1-mat-browser');
fs.mkdirSync(output, { recursive: true });
const readOnlyFixture = `const fixture=(...args)=>{ const cb=args.find(x=>typeof x==='function'); if(cb){cb([]);return()=>{};} return Promise.resolve({ok:true,rows:[],items:[],clients:[],companies:[],recommendations:[],balance:0,availableBalance:0}); };`;
const mocks = {
  '@/lib/auth': `export const useAuth=()=>({user:window.__fixtureUid?{uid:window.__fixtureUid}:null,loading:false});`,
  '@/lib/useUserProfile': `const profile={role:'superadmin',rootId:'fixture-root',active:true};export const useUserProfile=()=>({profile,loading:false});`,
  '@/lib/useModuleAccess': `export const useModuleAccess=()=>({canAccess:true});`,
  '@/components/GlobalLoading': `export const useGlobalLoading=()=>({run:async(_,fn)=>fn(),show:()=>{},hide:()=>{}});`,
  '@/lib/firebaseClient': `export const db={},functions={},auth={},storage={};`,
  '@/lib/firebase': `export const db={},functions={},auth={},storage={};`,
  '@/components/mat/useMatHome': `export const useMatUserHome=()=>({home:{linked:true,pay0UserId:'fixture-user',role:'superadmin',rootId:'fixture-root',balance:{availableBalance:0,netBalance:0,pendingAdvance:0},metrics:[],solicitudes:[],dispersiones:[],clients:[],movements:[]},loading:false,error:''});`,
  'next/link': `import React from 'react';export default function Link(props){return React.createElement('a',props);}`,
  'next/navigation': `export const usePathname=()=>'/mat/usuarios';export const useRouter=()=>({push:()=>{},replace:()=>{}});export const useSearchParams=()=>new URLSearchParams();`,
  'next/dynamic': `import React from 'react';export default function dynamic(loader){const Component=React.lazy(loader);return props=>React.createElement(React.Suspense,{fallback:'Cargando formulario existente…'},React.createElement(Component,props));}`,
  'firebase/firestore': `export const collection=(...args)=>({path:args.slice(1).join('/')});export const doc=collection;export const query=(ref)=>ref;export const where=()=>({});export const orderBy=()=>({});export const limit=()=>({});export const onSnapshot=(_,cb)=>{cb({docs:[],empty:true,exists:()=>false,data:()=>({})});return()=>{};};export const getDocs=async()=>({docs:[],empty:true});export const getDoc=async()=>({exists:()=>false,data:()=>({})});export const Timestamp={now:()=>new Date(),fromDate:x=>x};export const serverTimestamp=()=>null;`,
  'firebase/functions': `export const httpsCallable=()=>async()=>({data:{ok:true,rows:[]}});export const getFunctions=()=>({});`,
  'firebase/storage': `export const ref=()=>({});export const uploadBytesResumable=()=>{throw Error('UPLOAD_DISABLED_IN_FIXTURE')};export const getDownloadURL=async()=>'';export const getStorage=()=>({});`,
  'exceljs': `export default {};`,
  'uuid': `export const v4=()=>crypto.randomUUID();`,
  'jspdf': `export class jsPDF { constructor(){throw Error('PDF_GENERATION_DISABLED_IN_UI_FIXTURE');} }`,
};
function resolveFile(value) {
  for(const candidate of [value,...['.tsx','.ts','.js','.mjs','.cjs','.json'].map(ext=>value+ext),path.join(value,'index.js'),path.join(value,'index.ts')]) if(fs.existsSync(candidate)&&fs.statSync(candidate).isFile())return candidate;
}
async function run() {
  await esbuild.build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Page from '@/app/mat/usuarios/page';const root=createRoot(document.getElementById('root'));window.renderFixture=uid=>{window.__fixtureUid=uid;root.render(React.createElement(Page));};`, resolveDir: root, loader: 'tsx' }, bundle:true, platform:'browser', format:'iife', outfile:path.join(output,'fixture.js'), jsx:'automatic', define:{'process.env.NODE_ENV':'"development"'}, plugins:[{name:'synthetic-read-adapters',setup(build){
    build.onResolve({filter:/.*/},args=>{
      if(mocks[args.path])return {path:args.path,namespace:'fixture'};
      if(args.path.startsWith('@/services/'))return {path:args.path,namespace:'service-fixture'};
      if(args.path.startsWith('@/'))return {path:path.join(root,'src',args.path.slice(2))+(fs.existsSync(path.join(root,'src',args.path.slice(2)+'.tsx'))?'.tsx':'.ts')};
      if(args.path.startsWith('.')) {const file=resolveFile(path.resolve(args.resolveDir,args.path));if(file)return {path:file};}
      try{return {path:require.resolve(args.path,{paths:[args.resolveDir||root,root]})};}catch{}
    });
    build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'tsx',resolveDir:root}));
    build.onLoad({filter:/.*/,namespace:'service-fixture'},args=>{
      const file=path.join(root,'src',args.path.slice(2)+'.ts');
      const source=fs.readFileSync(file,'utf8');
      const names=[...source.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map(match=>match[1]);
      return {contents:readOnlyFixture+names.map(name=>`export const ${name}=${/^(create|upload|finalize|generate|request|resolve|save|delete|update|add)/i.test(name)?`()=>{throw Error('FINANCIAL_MUTATION_DISABLED_IN_UI_FIXTURE');}`:'fixture'};`).join('\n'),loader:'js'};
    });
  }}] });
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});
    await page.route('http://localhost/e1-mat',route=>route.fulfill({contentType:'text/html',body:'<html><body style="background:#020617;color:#e2e8f0"><div id="root"></div></body></html>'}));
    await page.goto('http://localhost/e1-mat');
    await page.addScriptTag({path:path.join(output,'fixture.js')});
    const cssRoot=path.join(root,'.next/static/css');
    if(fs.existsSync(cssRoot))for(const name of fs.readdirSync(cssRoot).filter(x=>x.endsWith('.css')))await page.addStyleTag({path:path.join(cssRoot,name)});
    await page.evaluate(()=>window.renderFixture('fixture-user'));
    await expect(page.getByText('Usuarios',{exact:true}).first()).toBeVisible();
    await page.locator('button[title="Nueva solicitud"]').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.screenshot({path:path.join(output,'mat-original-solicitud.png'),fullPage:true});
    await page.getByRole('button',{name:'Cerrar',exact:true}).click();
    await page.locator('button[title="Solicitar retorno"]').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('button',{name:'+ Dispersion',exact:true})).toBeVisible();
    await page.screenshot({path:path.join(output,'mat-original-retorno.png'),fullPage:true});
    await page.evaluate(()=>window.renderFixture('another-user'));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.screenshot({path:path.join(output,'mat-session-gate.png'),fullPage:true});
    fs.writeFileSync(path.join(output,'ui-errors.json'),JSON.stringify(errors,null,2));
    await page.screenshot({path:path.join(output,'mat-users.png'),fullPage:true});
    if(errors.length)throw Error(errors.join('\n'));
    console.log(JSON.stringify({result:'PASS',evidence:'ORIGINAL_COMPONENTS_WITH_SYNTHETIC_READS_NO_MUTATIONS',errors,output}));
  } finally { await browser.close(); }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
