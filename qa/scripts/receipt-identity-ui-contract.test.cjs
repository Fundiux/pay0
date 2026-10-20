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
const automaticFile=path.join(root,'src/lib/receiptAutomaticRegistration.ts'),automaticModule=new Module(automaticFile,module);automaticModule._compile(emit(fs.readFileSync(automaticFile,'utf8')),automaticFile);
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
  const fn=new Function('parsePagoReceiptPdfFile','receiptIdentitySelections','receiptCanResumeRegisteredUpload','automaticReceiptPayload','registerReceiptItem','setReceiptBatchBusy','setReceiptBatchItems','receiptBatchBusy','receiptBatchCreating',emit(declaration('revalidateReceiptItem'))+';return revalidateReceiptItem;')(
    async(_file,opts)=>{options=opts;return{identification:{id:'a'.repeat(64),status:'READY',reasons:[],createPayload:{receiptIdentificationId:'a'.repeat(64),operationTypeKey:'op',clienteId:'client-b',companyId:'company-b'}}};},service.exports.receiptIdentitySelections,service.exports.receiptCanResumeRegisteredUpload,automaticModule.exports.automaticReceiptPayload,async()=>{registered++;},()=>{},update=>{rows=update(rows);},false,false);
  await fn(item,false);assert.equal(registered,0);assert.equal(options.selectedClientId,'client-b');assert.equal(options.selectedCompanyId,'company-b');assert.equal(rows[0].selectedClientId,'client-b');assert.equal(rows[0].selectedCompanyId,'company-b');assert.equal(rows[0].parsed.identification.createPayload.clienteId,'client-b');
  if(page.includes('async function confirmReceiptItem(')) {
    const explicit=new Function('receiptBatchBusy','receiptBatchCreating','canCreatePagos','setReceiptBatchCreating','registerReceiptItem',emit(declaration('confirmReceiptItem'))+';return confirmReceiptItem;')(false,false,true,()=>{},async()=>{registered++;});
    await explicit(rows[0]);
  } else {
    assert(page.includes('revalidateReceiptItem(item, true)'));await fn(item,true);
  }
  assert.equal(registered,1,'Explicit existing action must register a server READY result even without strong automatic evidence');
});
test('Only the explicit action accepts visible server suggestions and registers after a fresh READY response',async()=>{
  const selection=service.exports.receiptIdentitySelections,source={verifiedMatches:{client:{id:'visible-client',name:'Visible Client',evidence:['NORMALIZED_NAME_EXACT']},company:{id:'visible-company',name:'Visible Company',evidence:['NORMALIZED_NAME_EXACT']}}};
  assert.deepEqual(selection({},source,false),{selectedClientId:undefined,selectedCompanyId:undefined});
  assert.deepEqual(selection({},source,true),{selectedClientId:'visible-client',selectedCompanyId:'visible-company'});
  assert.equal(selection({selectedClientId:'user-choice'},source,true).selectedClientId,'user-choice');
  assert.equal(selection({},{candidates:{client:[{id:'never-first'}]}},true).selectedClientId,undefined);
  assert.equal(selection({},{verifiedMatches:{client:{id:'invisible',name:''}}},true).selectedClientId,undefined);
  for(const ready of [true,false]) {
    let rows=[{key:'r',file:{},operationTypeKey:'op',parsed:{identification:{status:'REQUIRES_REVIEW',...source}}}],request;
    const creates=[];
    const register=new Function('uploadPagoDoc','automaticReceiptPayload','receiptCanResumeRegisteredUpload','createPagoWithReceipt','parsePagoReceiptPdfFile','setReceiptBatchItems',emit(declaration('registerReceiptItem'))+';return registerReceiptItem;')(
      ()=>{throw Error('UNEXPECTED_EXISTING_UPLOAD');},automaticModule.exports.automaticReceiptPayload,service.exports.receiptCanResumeRegisteredUpload,async input=>{creates.push(input);return 'synthetic-created';},()=>{throw Error('UNEXPECTED_RETRY');},update=>{rows=update(rows);});
    const revalidate=new Function('parsePagoReceiptPdfFile','receiptIdentitySelections','receiptCanResumeRegisteredUpload','automaticReceiptPayload','registerReceiptItem','setReceiptBatchBusy','setReceiptBatchItems','receiptBatchBusy','receiptBatchCreating',emit(declaration('revalidateReceiptItem'))+';return revalidateReceiptItem;')(
      async(_file,options)=>{request=options;return{identification:{id:'a'.repeat(64),status:ready?'READY':'REQUIRES_REVIEW',reasons:ready?[]:['CLIENT_SELECTION_REQUIRED'],...source,createPayload:ready?{receiptIdentificationId:'a'.repeat(64),operationTypeKey:'op',clienteId:'visible-client',companyId:'visible-company'}:null}};},selection,service.exports.receiptCanResumeRegisteredUpload,automaticModule.exports.automaticReceiptPayload,register,()=>{},update=>{rows=update(rows);},false,false);
    await revalidate(rows[0],true);
    if(page.includes('async function confirmReceiptItem(')) {
      const confirm=new Function('receiptBatchBusy','receiptBatchCreating','canCreatePagos','setReceiptBatchCreating','registerReceiptItem',emit(declaration('confirmReceiptItem'))+';return confirmReceiptItem;')(false,false,true,()=>{},register);await confirm(rows[0]);
    }
    assert.equal(request.selectedClientId,'visible-client');assert.equal(request.selectedCompanyId,'visible-company');assert.equal(creates.length,ready?1:0);
    if(ready){assert.equal(creates[0].clienteId,'visible-client');assert.equal(rows[0].selectedClientId,'visible-client');assert.equal(rows[0].selectedCompanyId,'visible-company');}
  }
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
test('Both legacy strong identities retain auto while name/manual identities require explicit registration',async()=>{
  const policy=service.exports.receiptHasStrongAutomaticIdentity;assert.equal(typeof policy,'function');
  const identity=(a,b)=>({status:'READY',verifiedMatches:{client:{id:'client',name:'Client',evidence:a},company:{id:'company',name:'Company',evidence:b}},createPayload:{clienteId:'client',companyId:'company'}});
  const strong=identity(['RFC_EXACT'],['FULL_ACCOUNT_EXACT']),name=identity(['NORMALIZED_NAME_EXACT'],['NORMALIZED_NAME_EXACT']),manual=identity(['RFC_EXACT','USER_SELECTED_AUTHORIZED_CATALOG_ENTRY'],['FULL_ACCOUNT_EXACT']);
  assert.equal(policy(strong),true);assert.equal(policy(identity(['FULL_ACCOUNT_EXACT'],['RFC_EXACT'])),true);assert.equal(policy(name),false);assert.equal(policy(manual),false);assert.equal(policy(identity(['RFC_EXACT'],['NORMALIZED_NAME_EXACT'])),false);assert.equal(policy(undefined),false);
  const legacy={status:'READY',evidence:{client:['RFC_EXACT'],company:['FULL_ACCOUNT_EXACT']},createPayload:{clienteId:'client',companyId:'company'}};
  assert.equal(policy(legacy),true,'LIVE6e0 legacy evidence must retain strong auto');
  assert.equal(policy({...legacy,evidence:{client:['NORMALIZED_NAME_EXACT'],company:['NORMALIZED_NAME_EXACT']}}),false);
  assert.equal(policy({...legacy,evidence:{client:['RFC_EXACT','USER_SELECTED_AUTHORIZED_CATALOG_ENTRY'],company:['FULL_ACCOUNT_EXACT']}}),false);
  assert.equal(policy({...legacy,evidence:{client:['RFC_EXACT','USER_SELECTED_VERIFIED_CANDIDATE'],company:['FULL_ACCOUNT_EXACT']}}),false);
  assert.equal(policy({...legacy,createPayload:{clienteId:'client'}}),false);
  for(const verifiedMatches of [undefined,null,{}, {client:{id:'client',evidence:['RFC_EXACT']},company:null}])assert.equal(policy({...legacy,verifiedMatches}),false,'Present but incomplete matches must not fall back to legacy evidence');
  const worker=declaration('worker');const hasBaselineAuto=worker.includes('registerReceiptItem(analyzed)');
  for(const [identification,expected] of [[strong,hasBaselineAuto?1:0],[name,0],[manual,0]]) {
    let registered=0,rows=[];
    const fn=new Function('item','parsePagoReceiptPdfFile','receiptHasStrongAutomaticIdentity','receiptCanResumeRegisteredUpload','automaticReceiptPayload','registerReceiptItem','setReceiptBatchItems','findUniqueReceiptCatalogMatch','clientes','companies','let cursor=0;const queue=[item];'+emit(worker)+';return worker();');
    await fn({key:'r',file:{},operationTypeKey:'op'},async()=>({identification}),policy,service.exports.receiptCanResumeRegisteredUpload,()=>({}),async()=>{registered++;},update=>{rows=update(rows);},()=>null,[],[]);
    assert.equal(registered,expected);
  }
});
test('Actual registered receipt recovery only uploads to the server payment and never creates a payment',async()=>{
  for(const identification of [
    {status:'REGISTERED',receiptPending:true,pagoId:'server-existing-payment',createPayload:null},
    {status:'REGISTERED',receiptPending:false,pagoId:'server-existing-payment',createPayload:null},
    {status:'REGISTERED',receiptPending:true,pagoId:null,createPayload:null},
    {status:'REGISTERED',receiptPending:true,pagoId:' ',createPayload:null},
    {status:'REGISTERED',receiptPending:'true',pagoId:'server-existing-payment',createPayload:null},
    {status:'READY',receiptPending:true,pagoId:'server-existing-payment',createPayload:null}
  ]) {
    let creates=0;const uploads=[],rows=[{key:'r',file:{},parsed:{identification}}];
    const fn=new Function('uploadPagoDoc','automaticReceiptPayload','receiptCanResumeRegisteredUpload','createPagoWithReceipt','parsePagoReceiptPdfFile','setReceiptBatchItems',emit(declaration('registerReceiptItem'))+';return registerReceiptItem;')(
      async input=>{uploads.push(input.pagoId);},automaticModule.exports.automaticReceiptPayload,service.exports.receiptCanResumeRegisteredUpload,async()=>{creates++;return 'unexpected-new-payment';},()=>{throw Error('UNEXPECTED_PARSE');},update=>{update(rows);});
    const ok=await fn(rows[0]);assert.equal(creates,0);const valid=identification.status==='REGISTERED'&&identification.receiptPending===true&&identification.pagoId==='server-existing-payment';assert.deepEqual(uploads,valid?['server-existing-payment']:[]);assert.equal(ok,valid);
  }
});
test('Registered partial receipts can explicitly revalidate visible IDs; only fresh pending authorizes upload',async()=>{
  const visible={verifiedMatches:{client:{id:'client',name:'Visible Client',evidence:['NORMALIZED_NAME_EXACT']},company:{id:'company',name:'Visible Company',evidence:['NORMALIZED_NAME_EXACT']}}};
  const first={status:'REGISTERED',receiptPending:false,pagoId:'server-existing',reasons:['DUPLICATE'],createPayload:null,...visible};
  assert.equal(service.exports.receiptCanReviewRegisteredIdentity(first),true);
  assert.equal(service.exports.receiptCanReviewRegisteredIdentity({status:'REGISTERED',candidates:{client:[{id:'choice',name:'Visible Choice'}]}}),true);
  assert.equal(service.exports.receiptCanReviewRegisteredIdentity({status:'REGISTERED',reasons:['DUPLICATE']}),false);
  assert(page.includes('item.status === "DUPLICATE" && receiptCanReviewRegisteredIdentity(parsed.identification)'));
  for(const pending of [true,false]){
    let rows=[{key:'r',file:{},operationTypeKey:'op',parsed:{identification:first}}],creates=0,request;const uploads=[];
    const register=new Function('uploadPagoDoc','automaticReceiptPayload','receiptCanResumeRegisteredUpload','createPagoWithReceipt','parsePagoReceiptPdfFile','setReceiptBatchItems',emit(declaration('registerReceiptItem'))+';return registerReceiptItem;')(
      async input=>{uploads.push(input.pagoId);},automaticModule.exports.automaticReceiptPayload,service.exports.receiptCanResumeRegisteredUpload,async()=>{creates++;return 'unexpected-new';},()=>{throw Error('UNEXPECTED_PARSE');},update=>{rows=update(rows);});
    const revalidate=new Function('parsePagoReceiptPdfFile','receiptIdentitySelections','receiptCanResumeRegisteredUpload','automaticReceiptPayload','registerReceiptItem','setReceiptBatchBusy','setReceiptBatchItems','receiptBatchBusy','receiptBatchCreating',emit(declaration('revalidateReceiptItem'))+';return revalidateReceiptItem;')(
      async(_file,options)=>{request=options;return{identification:{...first,receiptPending:pending}};},service.exports.receiptIdentitySelections,service.exports.receiptCanResumeRegisteredUpload,automaticModule.exports.automaticReceiptPayload,register,()=>{},update=>{rows=update(rows);},false,false);
    await revalidate(rows[0],true);
    if(page.includes('async function confirmReceiptItem(')){const confirm=new Function('receiptBatchBusy','receiptBatchCreating','canCreatePagos','setReceiptBatchCreating','registerReceiptItem',emit(declaration('confirmReceiptItem'))+';return confirmReceiptItem;')(false,false,true,()=>{},register);await confirm(rows[0]);}
    assert.equal(request.selectedClientId,'client');assert.equal(request.selectedCompanyId,'company');assert.equal(creates,0);assert.deepEqual(uploads,pending?['server-existing']:[]);
  }
});
test('Correction and duplicate recovery paths forward selection; creation keeps server payload authority',()=>{
  const correction=declaration(page.includes('async function correctReceiptField(')?'correctReceiptField':'reclassifyReceiptReference');
  for(const key of ['selectedClientId: item.selectedClientId','selectedCompanyId: item.selectedCompanyId']){assert(correction.includes(key));assert(declaration('registerReceiptItem').includes(key));}
  assert(declaration('registerReceiptItem').includes('automaticReceiptPayload'));assert(!/clienteId:\s*item\.selectedClientId/.test(declaration('registerReceiptItem')));
});
test('Actual selector JSX renders authorized options and honest manual provenance in Chromium',async()=>{
  const esbuild=require('esbuild'),{chromium,expect}=require('@playwright/test');
  let block;function visit(n){if(ts.isJsxElement(n)&&n.openingElement.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText(ast)==='className'&&p.initializer?.text==='md:col-span-3 grid grid-cols-1 gap-3 sm:grid-cols-2'))block=n;ts.forEachChild(n,visit);}visit(ast);assert(block);const jsx=block.getText(ast);
  const serviceAst=ts.createSourceFile(serviceFile,fs.readFileSync(serviceFile,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);const review=serviceAst.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='receiptCanReviewRegisteredIdentity');assert(review);
  const fixture=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';${review.getText(serviceAst)};const initial={key:'r',status:'READY',parsed:{identification:{status:'REQUIRES_REVIEW',verifiedMatches:{client:{id:'a',name:'Alfa',evidence:['USER_SELECTED_AUTHORIZED_CATALOG_ENTRY']},company:null},candidates:{client:[{id:'a',name:'Alfa'}],company:[{id:'c',name:'Empresa Uno'},{id:'d',name:'Empresa Dos'}]}}}};function View(){const[rows,setReceiptBatchItems]=useState([initial]);window.showRegistered=()=>setReceiptBatchItems([{...initial,status:'DUPLICATE',parsed:{identification:{...initial.parsed.identification,status:'REGISTERED',receiptPending:false,reasons:['DUPLICATE']}}}]);const item=rows[0],parsed=item.parsed,verified=parsed.identification?.verifiedMatches,clientName=verified?.client?.name||'Sin cliente verificado',companyName=verified?.company?.name||'Sin empresa verificada',receiptBatchBusy=false,receiptBatchCreating=false;const revalidateReceiptItem=(next,create)=>{window.lastSelection={client:next.selectedClientId,company:next.selectedCompanyId,create};};return (item.status==='READY'||(item.status==='DUPLICATE'&&receiptCanReviewRegisteredIdentity(parsed.identification)))?(${jsx}):null;}createRoot(document.getElementById('root')).render(<View/>);`;
  const bundle=await esbuild.build({stdin:{contents:fixture,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfigRaw:{},define:{'process.env.NODE_ENV':'"test"'}});
  const browser=await chromium.launch({headless:true});try{const context=await browser.newContext({viewport:{width:390,height:844}});const tab=await context.newPage(),errors=[];tab.on('pageerror',e=>errors.push(e.message));await tab.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await tab.goto('http://localhost/receipt-selection');await tab.addScriptTag({content:bundle.outputFiles[0].text});
    await expect(tab.getByText('Cliente seleccionado; acceso validado',{exact:true})).toBeVisible();await expect(tab.getByLabel('Seleccionar cliente')).toBeVisible();await expect(tab.getByLabel('Seleccionar empresa')).toHaveValue('');
    await tab.getByLabel('Seleccionar empresa').selectOption('d');assert.deepEqual(await tab.evaluate(()=>window.lastSelection),{client:undefined,company:'d',create:false});await tab.evaluate(()=>window.showRegistered());await expect(tab.getByLabel('Seleccionar cliente')).toBeVisible();await expect(tab.getByLabel('Seleccionar empresa')).toBeVisible();assert.deepEqual(errors,[]);await context.close();
  }finally{await browser.close();}
});
