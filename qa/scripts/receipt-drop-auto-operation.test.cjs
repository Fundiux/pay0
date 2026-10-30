const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),Module=require('node:module');
const root=path.resolve(process.env.PAY0_RECEIPT_IDENTITY_UI_ROOT||'.');assert(root.startsWith(path.resolve('.')));
function load(file){const absolute=path.join(root,file),m=new Module(absolute,module);m.filename=absolute;m.require=name=>{if(name==='firebase/functions')return{httpsCallable:()=>{throw Error('NO_NETWORK');}};if(name==='@/lib/firebaseClient')return{functions:{}};throw Error(name);};m._compile(ts.transpileModule(fs.readFileSync(absolute,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,absolute);return m.exports;}
const service=load('src/services/pagoReceipt.ts'),pref=load('src/lib/receiptOperationPreference.ts'),automatic=load('src/lib/receiptAutomaticRegistration.ts');
test('Server operation keys fill an empty selection even before catalog loads; explicit mismatch fails closed',()=>{
 const resolve=service.receiptResolvedOperationTypeKey,server={resolvedOperationTypeKey:'canonical',createPayload:{operationTypeKey:'canonical'}};
 assert.equal(resolve('',server,['canonical']),'canonical');assert.equal(resolve('',{...server,createPayload:null},['canonical']),'canonical');
 assert.equal(resolve('',{createPayload:{operationTypeKey:'canonical'}},['canonical']),'canonical');assert.equal(resolve('',server,[]),'canonical');
 assert.equal(resolve('chosen',server,['canonical','chosen']),'');assert.equal(resolve('',{...server,createPayload:{operationTypeKey:'other'}},['canonical','other']),'');
 assert.equal(resolve('',null,['canonical']),'');
});
test('Browser default is an explicit scoped catalog key, never a first candidate or financial authority',()=>{
 const rows=[{key:'own',name:'Own',rootId:'root',active:true,category:'OPERACION'},{key:'legacy',name:'Legacy'},{key:'foreign',rootId:'other'},{key:'inactive',active:false},{key:'wrong',category:'OTRO'},{key:'duplicate'},{key:'duplicate'}];
 const choices=pref.receiptOperationChoices(rows,'root');assert.deepEqual(choices.map(x=>x.key),['own','legacy']);
 assert.equal(pref.validReceiptOperationPreference(null,choices),'');assert.equal(pref.validReceiptOperationPreference('foreign',choices),'');assert.equal(pref.validReceiptOperationPreference('own',choices),'own');
 assert.equal(pref.validReceiptOperationPreference('own',pref.receiptOperationChoices(rows,'other')),'');
 assert.equal(pref.validReceiptOperationPreference('own',[]),'');assert.notEqual(pref.receiptOperationPreferenceKey('root','u'),pref.receiptOperationPreferenceKey('other','u'));assert.notEqual(pref.receiptOperationPreferenceKey('root','u'),pref.receiptOperationPreferenceKey('root','v'));assert.equal(pref.receiptOperationPreferenceKey('','u'),'');
 assert.equal(automatic.automaticReceiptPayload({status:'REQUIRES_REVIEW',reasons:[],createPayload:null},'own'),null);
});
test('Actual preference reload preserves stored choice while catalog is pending and clears only loaded invalid keys',()=>{
 const file=path.join(root,'src/app/pagos/page.tsx'),source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let effect;
 function walk(n){if(ts.isCallExpression(n)&&n.expression.getText(ast)==='useEffect'&&n.arguments[0]?.getText(ast).includes('localStorage.getItem(receiptPreferenceScope)'))effect=n.arguments[0].getText(ast);ts.forEachChild(n,walk);}walk(ast);assert(effect);
 const scope=pref.receiptOperationPreferenceKey('root','u'),stored=new Map([[scope,'saved']]);let state;
 const run=(loaded,rows,currentScope=scope)=>new Function('receiptPreferenceScope','operationTypesLoaded','operationTypes','rootId','setReceiptDefault','localStorage','validReceiptOperationPreference','receiptOperationChoices','return ('+effect+')();')(currentScope,loaded,rows,'root',value=>{state=value;},{getItem:key=>stored.get(key)||null,removeItem:key=>stored.delete(key)},pref.validReceiptOperationPreference,pref.receiptOperationChoices);
 run(false,[]);assert.equal(stored.get(scope),'saved');assert.equal(state.key,'');
 run(true,[{key:'saved',active:true}]);assert.equal(state.key,'saved');assert.equal(stored.get(scope),'saved');
 run(true,[{key:'saved',active:false}]);assert.equal(state.key,'');assert(!stored.has(scope));
 stored.set(scope,'saved');run(true,[{key:'saved'}],pref.receiptOperationPreferenceKey('root','other'));assert.equal(state.key,'');assert.equal(stored.get(scope),'saved');
});
test('Actual worker adopts server operation and auto-registers once, while a changed explicit operation never creates',async()=>{
 const file=path.join(root,'src/app/pagos/page.tsx'),source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let worker;
 function walk(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='worker')worker=n.getText(ast);ts.forEachChild(n,walk);}walk(ast);assert(worker);
 const emitted='const receiptItemIsCurrent=()=>true;const assertReceiptItemCurrent=()=>{};'+ts.transpileModule(worker,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const id='b'.repeat(64),identification={id,status:'READY',reasons:[],resolvedOperationTypeKey:'server-op',createPayload:{operationTypeKey:'server-op',receiptIdentificationId:id,clienteId:'client',companyId:'company'}};
 for(const requested of ['', 'different']){let created=0,adopted;
 const fn=new Function('item','receiptResolvedOperationTypeKey','receiptTypeChoices','parsePagoReceiptPdfFile','receiptCanResumeRegisteredUpload','automaticReceiptPayload','registerReceiptItem','setReceiptBatchItems','findUniqueReceiptCatalogMatch','clientes','companies','let cursor=0;const queue=[item];'+emitted+';return worker();');
 await fn({key:'r',file:{},operationTypeKey:requested},service.receiptResolvedOperationTypeKey,[],async()=>({identification}),service.receiptCanResumeRegisteredUpload,automatic.automaticReceiptPayload,async row=>{created++;adopted=row.operationTypeKey;},()=>{},()=>null,[],[]);
 assert.equal(created,requested?0:1);if(!requested)assert.equal(adopted,'server-op');}
});
