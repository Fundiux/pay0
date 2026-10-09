// Actual page/modal components and global CSS, with in-memory read-only API/Auth
// boundaries. No synthetic table markup, server, emulator, live data or writes.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ts = require('typescript'), esbuild = require('esbuild');
const { chromium, expect } = require('@playwright/test');
const workspace = path.resolve(__dirname, '../..');
const entries = {
  solicitudes: 'src/app/solicitudes/page.tsx', pagos: 'src/app/pagos/page.tsx',
  clientes: 'src/app/clientes/page.tsx', usuarios: 'src/app/usuarios/page.tsx',
  documentos: 'src/components/DocsModal.tsx', wallet: 'src/app/wallet/clientes/page.tsx',
  reportes: 'src/app/reportes/page.tsx', documentosPago: 'src/components/PagoDocsModal.tsx',
  beneficiarios: 'src/app/wallet/beneficiarios/page.tsx',
};
function exportedValues(file) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const names = [];
  for (const node of source.statements) {
    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      if (!node.isTypeOnly) names.push(...node.exportClause.elements.filter(item => !item.isTypeOnly).map(item => item.name.text));
    } else if (node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword)) {
      if (ts.isFunctionDeclaration(node) && node.name) names.push(node.name.text);
      if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
    }
  }
  return [...new Set(names)];
}
const mocks = {
  '@/lib/auth': 'export const useAuth=()=>({user:window.__p9.user,loading:false});',
  '@/lib/useUserProfile': 'export const useUserProfile=()=>({profile:window.__p9.profile,loading:false});',
  '@/lib/firebaseClient': 'export const db={},auth={currentUser:window.__p9.user},storage={},functions={};',
  '@/components/GlobalLoading': 'export const useGlobalLoading=()=>window.__p9.loading; export const GlobalLoadingProvider=({children})=>children;',
  'next/link': 'import React from "react"; export default function Link({href,children,...props}){return React.createElement("a",{...props,href:typeof href==="string"?href:href.pathname},children);}',
  'next/navigation': 'export const useSearchParams=()=>window.__p9.searchParams; export const usePathname=()=>"/wallet/beneficiarios"; export const useParams=()=>({id:"fixture-folder"}); export const useRouter=()=>({push:()=>{},replace:()=>{},refresh:()=>{}});',
  'firebase/auth': 'export const onAuthStateChanged=(auth,callback)=>{queueMicrotask(()=>callback(window.__p9.user));return()=>{}}; export const getIdToken=async()=>"local-fixture-only"; export const signOut=()=>{throw Error("WRITE_FORBIDDEN")};',
  'firebase/functions': 'export const httpsCallable=(functions,name)=>(data)=>window.__p9.api(name,[data]); export const getFunctions=()=>({}); export const connectFunctionsEmulator=()=>{};',
  'firebase/storage': 'export const ref=(...args)=>({args}); export const getDownloadURL=()=>{throw Error("DOWNLOAD_FORBIDDEN")}; export const uploadBytesResumable=()=>{throw Error("WRITE_FORBIDDEN")};',
  'firebase/firestore': `
    const make=(args,document=false)=>({path:args.filter(x=>typeof x==='string').join('/'),document});
    export const collection=(...args)=>make(args),doc=(...args)=>make(args,true);
    export const where=(...args)=>({where:args}),orderBy=(...args)=>({orderBy:args}),limit=(n)=>({limit:n}),startAfter=(...args)=>({startAfter:args});
    export const query=(source,...constraints)=>({...source,constraints});
    export const getDoc=async(source)=>window.__p9.snapshot(source),getDocs=getDoc;
    export const onSnapshot=(source,...args)=>{const cb=args.find(x=>typeof x==='function');queueMicrotask(()=>cb(window.__p9.snapshot(source)));return()=>{}};
    export const serverTimestamp=()=>{throw Error('WRITE_FORBIDDEN')},addDoc=serverTimestamp,setDoc=serverTimestamp,updateDoc=serverTimestamp,deleteDoc=serverTimestamp,writeBatch=serverTimestamp;
    export class Timestamp { constructor(seconds,nanoseconds=0){this.seconds=seconds;this.nanoseconds=nanoseconds} toDate(){return new Date(this.seconds*1000)} toMillis(){return this.seconds*1000} static now(){return new Timestamp(Date.now()/1000)} static fromDate(date){return new Timestamp(date.getTime()/1000)} static fromMillis(ms){return new Timestamp(ms/1000)} }
    export const documentId=()=>('__name__');`,
};
function installFixtures() {
  const stamp = { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 };
  const user = { uid: 'fixture-root', email: 'fixture@example.invalid', getIdToken: async () => 'local-fixture-only' };
  const profile = { ...user, rootId: user.uid, role: 'superadmin', isActive: true, username: 'QA', displayName: 'QA Persona' };
  const cliente = { id: 'fixture-client', name: 'Cliente local QA', nombre: 'Cliente local QA', clientNumber: 1, rfc: 'XAXX010101000', active: true, rootId: user.uid, createdByUsername: 'QA Persona' };
  const company = { id: 'fixture-company', nombre: 'Empresa local QA', razonSocial: 'Empresa local QA', rfc: 'XEXX010101000', active: true, rootId: user.uid };
  const solicitud = { id: 'fixture-solicitud', rootId: user.uid, folio: 'S1C1U1E1', clienteId: cliente.id, clienteNombre: cliente.name, companyId: company.id, empresaNombre: company.nombre, status: 'FACTURADA', monto: 1000, totalAbonado: 400, createdAt: stamp, updatedAt: stamp, createdBy: user.uid, createdByName: 'QA Persona', creatorDisplayName: 'QA Persona', descripcion: 'Servicio local QA', moneda: 'MXN', metodoPago: 'PPD' };
  const pago = { id: 'fixture-pago', rootId: user.uid, folio: 'P1C1U1', clienteId: cliente.id, clienteNombre: cliente.name, companyId: company.id, empresaNombre: company.nombre, status: 'CONCILIADO', montoTotal: 1000, totalAplicado: 400, montoAplicado: 400, saldoDisponible: 600, createdAt: stamp, updatedAt: stamp, fechaPago: stamp, reportDate: stamp, reportDateAt: stamp, createdBy: user.uid, creatorDisplayName: 'QA Persona', moneda: 'MXN' };
  const uploads = [0,1,2].map(i => ({ id: 'fixture-upload-'+i, rootId: user.uid, solicitudId: i===2?undefined:solicitud.id, pagoId: i===2?pago.id:undefined, entityId: i===2?pago.id:solicitud.id, entityType: i===2?'pagos':'solicitudes', documentType: i===0?'FACTURA_PDF':i===1?'ORDEN_COMPRA':'COMPROBANTE_PAGO', originalName: 'Documento local '+i+'.pdf', filename: 'Documento local '+i+'.pdf', status: 'READY', active: true, version: 1, createdAt: stamp, storagePath: 'fixture/'+i+'.pdf' }));
  const beneficiary = { id:'fixture-beneficiary',rootId:user.uid,clientId:cliente.id,nombre:'Beneficiario local QA',active:true };
  const readCalls=[], blocked=[];
  const api = (name,args) => {
    readCalls.push(name);
    if (/^(listScopedClients|listCompanies|watchClientBeneficiaries|watchClientBeneficiaryMethods)$/.test(name)) {
      const callback=args.find(value=>typeof value==='function');
      const rows=name==='listScopedClients'?[cliente]:name==='listCompanies'?[company]:name==='watchClientBeneficiaries'?[beneficiary]:[{id:'fixture-method',beneficiaryId:beneficiary.id,clientId:cliente.id,active:true,tipo:'DEBITO',destinationKind:'CLABE',masked:'****0001',bankName:'Banco local'}];
      queueMicrotask(()=>callback(rows)); return ()=>{};
    }
    const creators=[{uid:user.uid,displayName:'QA Persona',username:'QA'}];
    if (name==='listSolicitudes'||name==='listPagos') return Promise.resolve({items:name==='listSolicitudes'?Array.from({length:35},(_,i)=>({...solicitud,id:i?solicitud.id+'-'+i:solicitud.id,folio:`S${i+1}C1U1E1`} )):[pago],hasMore:false,nextCursor:null,creatorOptions:creators});
    if (name==='listUsers') return Promise.resolve({users:[{...profile,userNumber:1},{...profile,uid:'fixture-admin',role:'admin',displayName:'Admin local QA',username:'QA Admin',userNumber:2}],hasMore:false});
    if (name==='readClientWalletAccountsOverview') return Promise.resolve({accounts:[{id:'fixture-wallet',holderId:cliente.id,holderName:cliente.name,holderType:'CLIENT',availableBalance:1000,pendingAmount:250,totalGranted:250,netBalance:750,lastMovementAt:stamp}]});
    if (name==='getEarningsByClientReport') return Promise.resolve({rows:[{clienteId:cliente.id,clienteNombre:cliente.name,operationsCount:2,grossAmount:1000,totalEarningsAmount:50,superadminEarningsAmount:50,adminEarningsAmount:0,operadorEarningsAmount:0}],summary:{clientsCount:1,operationsCount:2,grossAmount:1000,totalEarningsAmount:50},scopeRole:'superadmin',docsScanned:2});
    if (name==='getControlCenterOverview') return Promise.resolve({snapshot:null});
    if (name==='getControlCenterAnalytics') return Promise.resolve({coverage:{complete:true},totals:{},previous:{},current:{},daily:[],clients:[],users:[]});
    if (name==='getControlCenterEvidence') return Promise.resolve({facets:[],incidents:[],rows:[],facetsTruncated:false,incidentsTruncated:false});
    if (name==='listPaymentComplementFollowup') return Promise.resolve({rows:[],truncated:false,automation:{iqEnabled:false,iqLookupEnabled:false,facturamaEnabled:false}});
    if (/^(get|read|list|watch)/.test(name)) return Promise.resolve({rows:[],items:[],summary:{},accounts:[]});
    blocked.push(name); throw Error('WRITE_FORBIDDEN:'+name);
  };
  const snapshot = source => {
    const collection=source.path.split('/')[0];
    const rows=collection==='uploads'?uploads:collection==='pagos'?[pago]:collection==='solicitudes'?[solicitud]:collection==='clients'?[cliente]:collection==='companies'?[company]:collection==='users'?[profile]:[];
    const doc=row=>({id:row.id||row.uid,exists:()=>true,data:()=>row,ref:{id:row.id||row.uid}});
    if(source.document) return rows.length?doc(rows[0]):{id:source.path.split('/').pop(),exists:()=>false,data:()=>null};
    return {docs:rows.map(doc),empty:rows.length===0,size:rows.length,forEach:callback=>rows.map(doc).forEach(callback)};
  };
  const loading={show:()=>{},hide:()=>{},run:async(fn)=>fn(),withLoading:async(fn)=>fn(),isLoading:false};
  window.__p9={user,profile,solicitud,pago,loading,api,snapshot,readCalls,blocked,searchParams:new URLSearchParams()};
  window.fetch=()=>{blocked.push('fetch');throw Error('NETWORK_FORBIDDEN')};
}
async function bundlePages() {
  const source = Object.entries(entries).map(([name,file])=>`import ${name} from ${JSON.stringify(path.resolve(workspace,file))};`).join('\n');
  return esbuild.build({ stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';${source}\nconst entries={${Object.keys(entries).join(',')}};let root;window.mountSurface=(name)=>{root?.unmount();root=createRoot(document.getElementById('root'));const props=name==='documentos'?{open:true,onClose:()=>{},solicitud:window.__p9.solicitud}:name==='documentosPago'?{open:true,onClose:()=>{},pago:window.__p9.pago}:{};root.render(React.createElement(entries[name],props));};`,resolveDir:workspace,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',target:'es2022',define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent',plugins:[{name:'read-only-boundaries',setup(build){
    build.onResolve({filter:/.*/},args=>{
      if(Object.hasOwn(mocks,args.path))return{path:args.path,namespace:'qa-mock'};
      if(args.path.startsWith('@/services/'))return{path:path.resolve(workspace,'src',args.path.slice(2)+'.ts'),namespace:'qa-service'};
      return undefined;
    });
    build.onLoad({filter:/.*/,namespace:'qa-mock'},args=>({contents:mocks[args.path],loader:'js',resolveDir:workspace}));
    build.onLoad({filter:/.*/,namespace:'qa-service'},args=>({contents:exportedValues(args.path).map(name=>`export const ${name}=(...args)=>window.__p9.api(${JSON.stringify(name)},args);`).join('\n'),loader:'js',resolveDir:workspace}));
  }}]});
}
async function mountFixture(page,name,built) {
  await page.setContent('<html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#0b1220;color:#e2e8f0"><div id="root"></div></body></html>');
  for(const file of fs.readdirSync('.next/static/css').filter(file=>file.endsWith('.css')))await page.addStyleTag({path:path.resolve('.next/static/css',file)});
  await page.addStyleTag({content:fs.readFileSync('src/styles/globals.css','utf8').replace('@import "tailwindcss";','')});
  await page.evaluate(installFixtures);
  await page.addScriptTag({content:built.outputFiles[0].text});
  await page.evaluate(name=>window.mountSurface(name),name);
  if(name==='reportes')await page.getByRole('button',{name:'Ganancias por cliente',exact:true}).click();
  if(name==='beneficiarios'){
    await page.getByRole('button',{name:'Selecciona cliente',exact:true}).click();
    await page.getByRole('option',{name:'Cliente local QA',exact:true}).click();
  }
  const grid=name==='beneficiarios'||name==='clientes';
  const allRows=page.locator(grid?'.pay0-table-card div.pay0-row-even':'table tbody tr');
  const row=(name==='documentos'||name==='documentosPago'?allRows:allRows.filter({hasText:name==='beneficiarios'?'Beneficiario local QA':name==='solicitudes'?'S1C1U1E1':name==='pagos'?'P1C1U1':'QA'})).first();
  return {row,cell:grid?row:row.locator('td').first()};
}
async function run() {
  process.chdir(workspace);
  const built=await bundlePages(), browser=await chromium.launch({headless:true});
  const results=[];let checks=0;
  try {
    for(const name of Object.keys(entries)) {
      const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],network=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*',route=>{network.push(route.request().url());return route.abort();});
      const {row,cell}=await mountFixture(page,name,built);
      try {await expect(row).toBeVisible({timeout:15000});}catch(error){throw Error(`${name}: ${error.message}; errors=${JSON.stringify(errors)}; body=${(await page.locator('body').innerText()).slice(0,1600)}`);}checks++;
      await page.mouse.move(0,0);
      const before=await cell.evaluate(el=>({background:getComputedStyle(el).backgroundImage,color:getComputedStyle(el).color,text:el.textContent}));
      await row.hover();
      const during=await cell.evaluate(el=>({background:getComputedStyle(el).backgroundImage,color:getComputedStyle(el).color,text:el.textContent}));
      assert.match(during.background,/linear-gradient/,`${name}: shared pastel hover`);checks++;
      assert.equal(during.color,before.color,`${name}: text color preserved`);assert.equal(during.text,before.text);checks++;
      await page.mouse.move(0,0);assert.equal(await cell.evaluate(el=>getComputedStyle(el).backgroundImage),before.background,`${name}: exit restores style`);checks++;
      // Exercise the shared selection contract on a real row without changing
      // React state or invoking a financial command.
      const selectionTarget=row;
      await selectionTarget.evaluate(el=>el.setAttribute('aria-selected','true'));await row.hover();
      assert.equal(await cell.evaluate(el=>getComputedStyle(el).backgroundImage),before.background,`${name}: selected row preserved`);checks++;
      await selectionTarget.evaluate(el=>el.removeAttribute('aria-selected'));
      await selectionTarget.evaluate(el=>el.setAttribute('data-state','selected'));
      assert.equal(await cell.evaluate(el=>getComputedStyle(el).backgroundImage),before.background,`${name}: data-state selection preserved`);checks++;
      await selectionTarget.evaluate(el=>el.removeAttribute('data-state'));
      const control=row.locator('button,a').first();
      if(await control.count()){await control.focus();assert(await control.evaluate(el=>document.activeElement===el),`${name}: keyboard focus`);checks++;}
      fs.mkdirSync('tmp/p9-real-surfaces',{recursive:true});
      await page.screenshot({path:`tmp/p9-real-surfaces/${name}.png`,fullPage:true});
      await page.setViewportSize({width:390,height:844});await expect(row).toBeVisible();checks++;
      // Width/scroll are reported rather than redefining pre-existing layouts.
      const layout=await page.evaluate(()=>({viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,horizontalScrollers:[...document.querySelectorAll('*')].filter(el=>el.scrollWidth>el.clientWidth&&['auto','scroll'].includes(getComputedStyle(el).overflowX)).length}));
      const scroll=await page.evaluate(()=>[...document.querySelectorAll('*')].filter(el=>el.scrollWidth>el.clientWidth&&['auto','scroll'].includes(getComputedStyle(el).overflowX)).map(el=>{const previous=el.scrollLeft;el.scrollLeft=el.scrollWidth;const moved=el.scrollLeft>0;el.scrollLeft=previous;return moved;}));
      assert(scroll.every(Boolean),`${name}: horizontal scrolling remains operable`);checks++;
      if(name==='solicitudes'){
        const last=page.locator('table tbody tr').filter({hasText:'S35C1U1E1'}).first();
        await expect(last).toBeVisible();await last.scrollIntoViewIfNeeded();await expect(last).toBeInViewport();checks++;
      }
      const safety=await page.evaluate(()=>({blocked:window.__p9.blocked,readCalls:window.__p9.readCalls}));
      assert.deepEqual(errors,[],`${name}: browser errors`);assert.deepEqual(network,[],`${name}: external resources`);assert.deepEqual(safety.blocked,[],`${name}: no writes/network`);checks++;
      // A fresh genuine touch context ensures the new feedback never sticks on
      // a device without hover. Tap the non-interactive padding of the real row.
      const touchContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
      const touchPage=await touchContext.newPage(),touchErrors=[],touchNetwork=[];
      touchPage.on('pageerror',error=>touchErrors.push(error.message));
      await touchPage.route('**/*',route=>{touchNetwork.push(route.request().url());return route.abort();});
      const touch=await mountFixture(touchPage,name,built);await expect(touch.row).toBeVisible();
      assert.equal(await touchPage.evaluate(()=>matchMedia('(hover: hover)').matches),false,`${name}: genuine touch media`);checks++;
      await touch.row.scrollIntoViewIfNeeded();
      const bounds=await touch.row.boundingBox();assert(bounds);
      await touchPage.touchscreen.tap(Math.max(1,bounds.x+2),Math.max(1,bounds.y+Math.min(bounds.height/2,18)));
      assert.doesNotMatch(await touch.cell.evaluate(el=>getComputedStyle(el).backgroundImage),/linear-gradient/,`${name}: no sticky pastel touch hover`);checks++;
      const touchSafety=await touchPage.evaluate(()=>window.__p9.blocked);
      assert.deepEqual(touchErrors,[]);assert.deepEqual(touchNetwork,[]);assert.deepEqual(touchSafety,[]);checks++;
      await touchPage.screenshot({path:`tmp/p9-real-surfaces/${name}-touch.png`,fullPage:true});
      await touchContext.close();
      results.push({surface:name,source:entries[name],hover:'PASS',selection:'PASS',touch:'PASS',layout,readCalls:[...new Set(safety.readCalls)]});
      console.log(JSON.stringify({surface:name,result:'PASS'}));
      await context.close();
    }
    fs.writeFileSync('tmp/p9-real-surfaces/results.json',JSON.stringify({ok:true,checks,surfaces:results,productionCalls:0,financialActions:0},null,2));
    console.log(JSON.stringify({ok:true,checks,surfaces:results.length,productionCalls:0,financialActions:0,browser:'closed in finally'}));
  } finally {await browser.close();}
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
