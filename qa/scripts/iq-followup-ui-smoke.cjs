const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'')||process.env.GCLOUD_PROJECT!=='demo-pay0') throw Error('Local demo emulator required');
const {chromium,expect}=require('@playwright/test'),ts=require('typescript'),admin=require('../../functions/node_modules/firebase-admin');
admin.initializeApp({projectId:'demo-pay0'});
const api=require('../../functions/lib/modules/paymentApplications/complementFollowup.js'),db=admin.firestore(),root=`iq-ui-${Date.now()}`,auth={uid:root,token:{}};
const automationApi=require('../../functions/lib/modules/paymentApplications/complementAutomation.js');
async function run(){
  await db.doc(`users/${root}`).set({rootId:root,role:'superadmin',active:true});
  await db.doc(`solicitudes/${root}`).set({rootId:root,folio:'S1C1U1E1',iqFolio:'100',facturaUuid:'11111111-1111-4111-8111-111111111111'});
  await db.doc(`pagos/${root}`).set({rootId:root,folio:'P1C1U1E1'});
  await db.doc(`pagoAplicaciones/${root}`).set({rootId:root,solicitudId:root,pagoId:root,folio:'AP1',invoiceType:'PPD',status:'APLICADA',montoAplicado:58,numeroParcialidad:1,iqApplicationStatus:'IQ_APPLIED',iqActionExecuted:true});
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:700}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.exposeFunction('qaCall',(name,data)=>(api[name]||automationApi[name]).run({auth,data:data||{}}));
    await page.setContent('<html><body style="background:#0b1220;color:white;font-family:Arial;padding:24px"><div id="root"></div></body></html>');
    for(const name of ['react','react-dom'])await page.addScriptTag({path:path.join(path.dirname(require.resolve(name)),`umd/${name}.development.js`)});
    for(const file of fs.readdirSync('.next/static/css').filter(f=>f.endsWith('.css')))await page.addStyleTag({path:path.resolve('.next/static/css',file)});
    const compiled=ts.transpileModule('import * as React from "react";\n'+fs.readFileSync('src/components/control-center/PaymentComplementFollowup.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
    await page.evaluate(code=>{const exports={},service=Object.fromEntries(['listPaymentComplementFollowup','refreshPaymentComplementFollowup','configurePaymentComplementAutomation'].map(name=>[name,data=>window.qaCall(name,data)]));new Function('require','exports',code)(name=>name==='react'?window.React:service,exports);window.ReactDOM.createRoot(document.getElementById('root')).render(window.React.createElement(exports.default));},compiled);
    await expect(page.getByText('Sin seguimientos registrados.',{exact:false})).toBeVisible();
    await page.getByRole('button',{name:'Revisar aplicaciones e histórico'}).click();
    await expect(page.getByRole('cell',{name:'S1C1U1E1',exact:true})).toBeVisible();
    await expect(page.getByRole('cell',{name:'Pendiente de solicitud al proveedor',exact:true})).toBeVisible();
    await expect(page.getByRole('cell',{name:'$58.00',exact:true})).toBeVisible();
    await expect(page.getByText('No se envía WhatsApp ni se solicita el histórico automáticamente.',{exact:false})).toBeVisible();
    page.on('dialog',dialog=>dialog.accept());
    await page.getByRole('button',{name:'IQ: pausado · activar',exact:true}).click();
    await expect(page.getByRole('button',{name:'IQ: activo · pausar',exact:true})).toBeVisible();
    assert.equal((await db.doc(`paymentComplementConfigs/${root}`).get()).data().iqEnabled,true);
    assert.deepEqual(errors,[]);
    await page.screenshot({path:'output/iq-followup-emulator-ui.png'});
    console.log(JSON.stringify({ok:true,checks:['historical refresh','PPD amount and installment','provider request explicitly pending','no browser errors'],externalActions:0}));
  }finally{await browser.close();}
}
run().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
