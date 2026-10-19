const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('../../functions/node_modules/typescript');
const {chromium,expect}=require('@playwright/test');
const candidate=path.resolve(process.env.PAY0_MAT_UI_CANDIDATE||'output/mat-ui-candidate');
const compile=(file,omitProvider=false)=>{
 const original=fs.readFileSync(file,'utf8');
 const source=omitProvider?original.replace('<GlobalLoadingProvider><CanonicalDispersionPage /></GlobalLoadingProvider>','<CanonicalDispersionPage />'):original;
 if(omitProvider)assert.notEqual(source,original,'Missing-provider negative control must remove the wrapper');
 return ts.transpileModule('import * as React from "react";\n'+source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
};
(async()=>{
 const wallet=fs.readFileSync(path.join(candidate,'src/app/wallet/dispersiones/page.tsx'),'utf8');
 assert.match(wallet,/const globalLoading = useGlobalLoading\(\)/);
 const browser=await chromium.launch({headless:true});
 const results=[];
 try{
  for(const variant of ['root-negative','candidate-user','candidate-mismatch','candidate-no-auth','candidate-client']){
   const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<html><body><div id="root"></div></body></html>'}));
   await page.goto('http://localhost/mat-fixture');
   await page.addScriptTag({path:path.join(path.dirname(require.resolve('react')),'umd/react.development.js')});
   await page.addScriptTag({path:path.join(path.dirname(require.resolve('react-dom')),'umd/react-dom.development.js')});
   const scope=variant==='candidate-client'?'clientes':'usuarios';
   const sourceRoot=candidate;
   await page.evaluate(({code,provider,modal,matches,noAuth})=>{
    const load=(code,deps)=>{const exports={};new Function('require','exports',code)(name=>name==='react'?React:deps[name],exports);return exports;};
    const loading=load(provider,{}),modalExports=load(modal,{'lucide-react':{X:()=>null}});
    const DynamicWallet=()=>{loading.useGlobalLoading();return React.createElement('p',{'data-testid':'real-provider-ready'},'Contexto de carga disponible');};
    const home={linked:true,pay0UserId:'canonical-user',role:'operador',displayName:'Sintético',balance:{availableBalance:0},metrics:[],solicitudes:[],dispersiones:[],movements:[]};
    const common={
     '@/lib/auth':{useAuth:()=>({user:noAuth?null:{uid:matches?'canonical-user':'different-user'}})},
     '@/components/GlobalLoading':loading,'@/components/Modal':modalExports,
     '@/components/NuevaSolicitudModal':{__esModule:true,default:({open,onClose})=>open?React.createElement('div',{role:'dialog','aria-label':'Solicitud existente'},React.createElement('button',{onClick:onClose},'Cerrar solicitud')):null},
     'next/dynamic':()=>DynamicWallet,
     '@/components/mat/MatShell':{MatShell:({children})=>React.createElement('main',null,children)},
     '@/components/mat/MatBalanceCard':{MatBalanceCard:()=>null},
     '@/components/mat/MatCarousel2D':{MatCarousel2D:({slides})=>React.createElement('div',null,...slides.map(s=>React.createElement('section',{key:s.id},s.children)))},
     '@/components/mat/useMatHome':{useMatUserHome:()=>({home,loading:false,error:''}),useMatClientHome:()=>({home,loading:false,error:''})},
     '@/lib/matSecurityPolicy':{formatMatTrustWindow:()=>''},
    };
    const component=load(code,common).default;ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(component));
   },{code:compile(path.join(sourceRoot,`src/app/mat/${scope}/page.tsx`),variant==='root-negative'),provider:compile(path.join(candidate,'src/components/GlobalLoading.tsx')),modal:compile(path.join(candidate,'src/components/Modal.tsx')),matches:variant!=='candidate-mismatch',noAuth:variant==='candidate-no-auth'});
   if(variant==='candidate-client'||variant==='candidate-mismatch'||variant==='candidate-no-auth'){
    await page.getByRole('button',{name:/Nueva solicitud/}).click();await page.waitForURL('**/solicitudes');
    assert.deepEqual(errors,[]);results.push({variant,status:'PASS',behavior:'guarded-web-navigation'});
   }else if(variant==='root-negative'){
    await page.getByRole('button',{name:/Solicitar retorno/}).click();
    await expect.poll(()=>errors.some(x=>x.includes('useGlobalLoading debe usarse dentro de GlobalLoadingProvider'))).toBe(true);
    results.push({variant,status:'EXPECTED_FAILURE',behavior:'missing-provider-reproduced'});
   }else{
    await page.getByRole('button',{name:/Nueva solicitud/}).click();await expect(page.getByRole('dialog',{name:'Solicitud existente'})).toBeVisible();
    await page.getByRole('button',{name:'Cerrar solicitud'}).click();
    await page.getByRole('button',{name:/Solicitar retorno/}).click();await expect(page.getByTestId('real-provider-ready')).toBeVisible();
    assert.deepEqual(errors,[]);results.push({variant,status:'PASS',behavior:'existing-form-and-real-provider-wiring'});
   }
   await page.close();
  }
 }finally{await browser.close();}
 const proof={status:'PASS',results,scope:'Real MAT pages, Modal and GlobalLoadingProvider; presentation, session and form bodies use synthetic fixtures',financialWrites:0,externalRequests:0};
 const proofFile=path.resolve(process.env.PAY0_MAT_UI_PROOF||'output/mat-ui-candidate/ui-verification.json');
 fs.mkdirSync(path.dirname(proofFile),{recursive:true});fs.writeFileSync(proofFile,JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
})().catch(e=>{console.error(e);process.exitCode=1;});
