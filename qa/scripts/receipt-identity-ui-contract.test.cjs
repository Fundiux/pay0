const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),Module=require('node:module');
const root=path.resolve(process.env.PAY0_RECEIPT_IDENTITY_UI_ROOT||'.');assert(root.startsWith(path.resolve('.')+path.sep)||root===path.resolve('.'));
const pageFile=path.join(root,'src/app/pagos/page.tsx'),page=fs.readFileSync(pageFile,'utf8'),ast=ts.createSourceFile(pageFile,page,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function declaration(name){let found;function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)found=n;ts.forEachChild(n,visit);}visit(ast);assert(found,name);return found.getText(ast);}
function emit(source){return ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React}}).outputText;}
const calls=[];let result={identification:{id:'server',status:'REQUIRES_REVIEW',reasons:[],createPayload:null}};
const serviceFile=path.join(root,'src/services/pagoReceipt.ts'),service=new Module(serviceFile,module);service.filename=serviceFile;service.paths=Module._nodeModulePaths(root);service.require=name=>{
  if(name==='firebase/functions')return{httpsCallable:(_f,name)=>async payload=>{calls.push({name,payload});return{data:result};}};
  if(name==='@/lib/firebaseClient')return{functions:{}};throw Error('UNEXPECTED_IMPORT '+name);
};service._compile(emit(fs.readFileSync(serviceFile,'utf8')),serviceFile);
test('Real parse/correct wrappers preserve both selected IDs without deriving a first candidate',async()=>{
  calls.length=0;const file=new File(['%PDF-synthetic'],'synthetic.pdf',{type:'application/pdf'});
  await service.exports.parsePagoReceiptPdfFile(file,{selectedClientId:'chosen-client',selectedCompanyId:'chosen-company',operationTypeKey:'op'});
  assert.equal(calls[0].payload.selectedClientId,'chosen-client');assert.equal(calls[0].payload.selectedCompanyId,'chosen-company');
  await service.exports.correctPagoReceiptSemanticField({analysisId:'a',field:'reference',correctedField:'folio',correctedValue:'X',expectedCorrectionVersion:2,selectedClientId:'chosen-client',selectedCompanyId:'chosen-company'});
  assert.equal(calls[1].payload.selectedClientId,'chosen-client');assert.equal(calls[1].payload.selectedCompanyId,'chosen-company');assert.equal(calls[1].payload.expectedCorrectionVersion,2);
  await service.exports.parsePagoReceiptPdfFile(file);assert.equal(calls[2].payload.selectedClientId,undefined);assert.equal(calls[2].payload.selectedCompanyId,undefined);
});
test('Actual revalidation handler preserves selection and cannot create when selection requests parse-only',async()=>{
  const item={key:'row',file:{},operationTypeKey:'op',selectedClientId:'client-b',selectedCompanyId:'company-b',parsed:{identification:{status:'READY',createPayload:{clienteId:'old'}}}};
  let rows=[item],registered=0,options;
  const fn=new Function('parsePagoReceiptPdfFile','automaticReceiptPayload','registerReceiptItem','setReceiptBatchBusy','setReceiptBatchItems','receiptBatchBusy','receiptBatchCreating',emit(declaration('revalidateReceiptItem'))+';return revalidateReceiptItem;')(
    async(_file,opts)=>{options=opts;return{identification:{status:'READY',createPayload:{clienteId:'client-b',companyId:'company-b'}}};},()=>({}),async()=>{registered++;},()=>{},update=>{rows=update(rows);},false,false);
  await fn(item,false);assert.equal(registered,0);assert.equal(options.selectedClientId,'client-b');assert.equal(options.selectedCompanyId,'company-b');assert.equal(rows[0].selectedClientId,'client-b');assert.equal(rows[0].selectedCompanyId,'company-b');assert.equal(rows[0].parsed.identification.createPayload.clienteId,'client-b');
});
test('Real selector callback invalidates old authorization and sends explicit IDs parse-only',()=>{
  let callback;function visit(n){if(ts.isJsxAttribute(n)&&n.name.getText(ast)==='onChange'&&n.initializer?.expression?.getText(ast).includes('[selectedKey]'))callback=n.initializer.expression;ts.forEachChild(n,visit);}visit(ast);assert(callback);
  const item={key:'r',selectedClientId:'old-client',selectedCompanyId:'kept-company',parsed:{identification:{status:'READY',createPayload:{clienteId:'old-client'}}}};let rows=[item],request;
  const source=emit('const callback='+callback.getText(ast)+';');
  const fn=new Function('item','selectedKey','setReceiptBatchItems','revalidateReceiptItem',source+';return callback;')(item,'selectedClientId',update=>{rows=update(rows);},(...args)=>{request=args;});
  fn({target:{value:'chosen-client'}});assert.equal(rows[0].parsed.identification,undefined);assert.equal(rows[0].status,'ANALYZING');assert.equal(rows[0].selectedCompanyId,'kept-company');assert.equal(request[0].selectedClientId,'chosen-client');assert.equal(request[1],false);
});
test('UI distinguishes manual authorized catalog selection and exposes all server options',()=>{
  assert(page.includes('USER_SELECTED_AUTHORIZED_CATALOG_ENTRY'));assert(page.includes('seleccionado; acceso validado'));assert(page.includes('candidates.length > 0 && <select'));
  assert(page.includes('Selecciona {label.toLowerCase()}'));assert(!page.includes('Identidad verificada por el servidor'));
  assert(!/candidates\s*\[\s*0\s*\]/.test(page));
});
test('Correction and duplicate recovery paths forward selection; creation keeps server payload authority',()=>{
  const correction=declaration(page.includes('async function correctReceiptField(')?'correctReceiptField':'reclassifyReceiptReference');
  for(const key of ['selectedClientId: item.selectedClientId','selectedCompanyId: item.selectedCompanyId']){assert(correction.includes(key));assert(declaration('registerReceiptItem').includes(key));}
  assert(declaration('registerReceiptItem').includes('automaticReceiptPayload'));assert(!/clienteId:\s*item\.selectedClientId/.test(declaration('registerReceiptItem')));
});
test('Actual selector JSX renders authorized options and honest manual provenance in Chromium',async()=>{
  const esbuild=require('esbuild'),{chromium,expect}=require('@playwright/test');
  let block;function visit(n){if(ts.isJsxElement(n)&&n.openingElement.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText(ast)==='className'&&p.initializer?.text==='md:col-span-3 grid grid-cols-1 gap-3 sm:grid-cols-2'))block=n;ts.forEachChild(n,visit);}visit(ast);assert(block);const jsx=block.getText(ast);
  const fixture=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';const initial={key:'r',status:'READY',parsed:{identification:{status:'REQUIRES_REVIEW',verifiedMatches:{client:{id:'a',name:'Alfa',evidence:['USER_SELECTED_AUTHORIZED_CATALOG_ENTRY']},company:null},candidates:{client:[{id:'a',name:'Alfa'}],company:[{id:'c',name:'Empresa Uno'},{id:'d',name:'Empresa Dos'}]}}}};function View(){const[rows,setReceiptBatchItems]=useState([initial]);const item=rows[0],parsed=item.parsed,verified=parsed.identification?.verifiedMatches,clientName=verified?.client?.name||'Sin cliente verificado',companyName=verified?.company?.name||'Sin empresa verificada',receiptBatchBusy=false,receiptBatchCreating=false;const revalidateReceiptItem=(next,create)=>{window.lastSelection={client:next.selectedClientId,company:next.selectedCompanyId,create};};return (${jsx});}createRoot(document.getElementById('root')).render(<View/>);`;
  const bundle=await esbuild.build({stdin:{contents:fixture,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfigRaw:{},define:{'process.env.NODE_ENV':'"test"'}});
  const browser=await chromium.launch({headless:true});try{const context=await browser.newContext({viewport:{width:390,height:844}});const tab=await context.newPage(),errors=[];tab.on('pageerror',e=>errors.push(e.message));await tab.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await tab.goto('http://localhost/receipt-selection');await tab.addScriptTag({content:bundle.outputFiles[0].text});
    await expect(tab.getByText('Cliente seleccionado; acceso validado',{exact:true})).toBeVisible();await expect(tab.getByLabel('Seleccionar cliente')).toBeVisible();await expect(tab.getByLabel('Seleccionar empresa')).toHaveValue('');
    await tab.getByLabel('Seleccionar empresa').selectOption('d');assert.deepEqual(await tab.evaluate(()=>window.lastSelection),{client:undefined,company:'d',create:false});assert.deepEqual(errors,[]);await context.close();
  }finally{await browser.close();}
});
